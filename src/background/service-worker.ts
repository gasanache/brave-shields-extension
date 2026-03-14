import { initEngine, getHiddenSelectors, getCosmeticResources } from './engine';
import { setupCosmeticInjector } from './cosmetic-injector';
import { checkForUpdates } from './dnr-manager';
import {
  getTabState,
  getTabStateSync,
  resetTabState,
  removeTabState,
  getSiteSettings,
  setSiteSettings,
  incrementTabStat,
  setTabEnabled,
} from './storage';
import { UPDATE_ALARM_NAME, UPDATE_INTERVAL_MINUTES } from '../shared/constants';

// Initialize engine on service worker activation
self.addEventListener('activate', () => {
  initEngine().catch((err) => console.error('[Shields] Engine init failed:', err));
});

// Also initialize when the service worker starts (covers wake-ups)
initEngine().catch((err) => console.error('[Shields] Engine init failed:', err));

// Set up cosmetic filtering injection
setupCosmeticInjector();

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_HIDDEN_SELECTORS': {
      const selectors = getHiddenSelectors(
        message.classes || [],
        message.ids || [],
        message.exceptions || []
      );
      sendResponse({ selectors });
      return false;
    }

    case 'GET_SHIELDS_STATUS': {
      const tabId = message.tabId ?? sender.tab?.id;
      const hostname = message.hostname;

      // Read persisted site settings, not just in-memory tab state
      (async () => {
        const settings = hostname ? await getSiteSettings(hostname) : null;
        const tabState = tabId != null ? await getTabState(tabId) : null;
        sendResponse({
          enabled: settings?.enabled ?? true,
          adBlockMode: settings?.adBlockMode ?? 'standard',
          cookieBlocking: settings?.cookieBlocking ?? 'cross-site',
          adsBlocked: tabState?.adsBlocked ?? 0,
          trackersBlocked: tabState?.trackersBlocked ?? 0,
          fingerprintBlocked: tabState?.fingerprintBlocked ?? 0,
          hostname: tabState?.hostname ?? hostname ?? '',
        });
      })();
      return true; // async response
    }

    case 'TOGGLE_SHIELDS': {
      const { tabId, enabled, hostname } = message;
      (async () => {
        const settings = await getSiteSettings(hostname);
        settings.enabled = enabled;
        await setSiteSettings(hostname, settings);

        // Also update in-memory tab state
        if (tabId != null) {
          setTabEnabled(tabId, enabled);
        }

        sendResponse({ success: true });
      })();
      return true; // async response
    }

    case 'GET_STATS': {
      const tabId = message.tabId ?? sender.tab?.id;
      (async () => {
        const state = tabId != null ? await getTabState(tabId) : null;
        sendResponse(state ?? { adsBlocked: 0, trackersBlocked: 0, fingerprintBlocked: 0 });
      })();
      return true;
    }

    case 'UPDATE_SITE_SETTING': {
      const { hostname, key, value } = message;
      const VALID_KEYS = ['enabled', 'adBlockMode', 'cookieBlocking', 'fingerprintBlocking'];
      if (!VALID_KEYS.includes(key)) {
        sendResponse({ success: false, error: 'Invalid setting key' });
        return false;
      }
      (async () => {
        const settings = await getSiteSettings(hostname);
        (settings as any)[key] = value;
        await setSiteSettings(hostname, settings);
        sendResponse({ success: true });
      })();
      return true;
    }

    case 'GET_COSMETIC_RESOURCES': {
      const resources = getCosmeticResources(message.url);
      sendResponse(resources);
      return false;
    }

    case 'SITE_AD_BLOCKED': {
      const tabId = sender.tab?.id;
      const count = message.count || 1;
      if (tabId != null && tabId >= 0) {
        incrementTabStat(tabId, 'adsBlocked', count);
        const state = getTabStateSync(tabId);
        if (state) {
          chrome.action.setBadgeText({
            text: String(state.adsBlocked),
            tabId,
          });
        }
      }
      sendResponse({ success: true });
      return false;
    }

    default:
      return false;
  }
});

// Track tab navigation for stats — check persisted site settings
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (!details.url.startsWith('http://') && !details.url.startsWith('https://')) return;
  try {
    const hostname = new URL(details.url).hostname;
    const settings = await getSiteSettings(hostname);
    resetTabState(details.tabId, hostname, settings.enabled);

    // Update badge
    if (!settings.enabled) {
      chrome.action.setBadgeText({ text: 'OFF', tabId: details.tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#666', tabId: details.tabId });
    } else {
      chrome.action.setBadgeText({ text: '', tabId: details.tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#FF5500', tabId: details.tabId });
    }
  } catch {
    // Invalid URL
  }
});

// Clean up tab state when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  removeTabState(tabId);
});

// Track blocked requests via declarativeNetRequest feedback
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
  const url = info.request.url;
  if (info.request.tabId >= 0 && (url.startsWith('http://') || url.startsWith('https://'))) {
    incrementTabStat(info.request.tabId, 'adsBlocked');
    const state = getTabStateSync(info.request.tabId);
    if (state) {
      chrome.action.setBadgeText({
        text: String(state.adsBlocked),
        tabId: info.request.tabId,
      });
    }
  }
});

// Set up periodic filter list update checks
chrome.alarms.create(UPDATE_ALARM_NAME, {
  periodInMinutes: UPDATE_INTERVAL_MINUTES,
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === UPDATE_ALARM_NAME) {
    await checkForUpdates();
  }
});

console.log('[Shields] Service worker started');
