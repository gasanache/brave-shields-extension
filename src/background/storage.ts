import { TabState, SiteSettings } from '../shared/types';
import { STORAGE_KEYS, DEFAULT_SITE_SETTINGS } from '../shared/constants';

// In-memory cache — synced to chrome.storage.session so stats survive worker suspension
let tabStates = new Map<number, TabState>();
let sessionLoadPromise: Promise<void> | null = null;

// Load tab states from session storage on worker wake-up
function ensureSessionLoaded(): Promise<void> {
  if (!sessionLoadPromise) {
    sessionLoadPromise = (async () => {
      try {
        const result = await chrome.storage.session.get(STORAGE_KEYS.TAB_STATES);
        const stored = result[STORAGE_KEYS.TAB_STATES];
        if (stored && typeof stored === 'object') {
          for (const [key, value] of Object.entries(stored)) {
            // Only set if not already in memory (in-memory is newer)
            if (!tabStates.has(Number(key))) {
              tabStates.set(Number(key), value as TabState);
            }
          }
        }
      } catch {
        // session storage not available or empty
      }
    })();
  }
  return sessionLoadPromise;
}

// Debounced persist to avoid excessive writes
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistTabStates(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const obj: Record<number, TabState> = {};
    for (const [key, value] of tabStates.entries()) {
      obj[key] = value;
    }
    chrome.storage.session.set({ [STORAGE_KEYS.TAB_STATES]: obj }).catch(() => {});
  }, 200);
}

// Eagerly load on module init
ensureSessionLoaded();

export async function getSiteSettings(hostname: string): Promise<SiteSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SITE_SETTINGS);
  const all = result[STORAGE_KEYS.SITE_SETTINGS] ?? {};
  return all[hostname] ?? { ...DEFAULT_SITE_SETTINGS };
}

export async function getAllSiteSettings(): Promise<Record<string, SiteSettings>> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SITE_SETTINGS);
  return result[STORAGE_KEYS.SITE_SETTINGS] ?? {};
}

export async function setSiteSettings(hostname: string, settings: SiteSettings): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SITE_SETTINGS);
  const all = result[STORAGE_KEYS.SITE_SETTINGS] ?? {};
  all[hostname] = settings;
  await chrome.storage.local.set({ [STORAGE_KEYS.SITE_SETTINGS]: all });
}

export async function getTabState(tabId: number): Promise<TabState | undefined> {
  await ensureSessionLoaded();
  return tabStates.get(tabId);
}

export function getTabStateSync(tabId: number): TabState | undefined {
  return tabStates.get(tabId);
}

export function incrementTabStat(
  tabId: number,
  stat: 'adsBlocked' | 'trackersBlocked' | 'fingerprintBlocked',
  count: number = 1
): void {
  const state = tabStates.get(tabId);
  if (state) {
    state[stat] += count;
    persistTabStates();
  }
}

export function resetTabState(tabId: number, hostname: string, enabled: boolean = true): void {
  tabStates.set(tabId, {
    tabId,
    hostname,
    enabled,
    adsBlocked: 0,
    trackersBlocked: 0,
    fingerprintBlocked: 0,
  });
  persistTabStates();
}

export function setTabEnabled(tabId: number, enabled: boolean): void {
  const state = tabStates.get(tabId);
  if (state) {
    state.enabled = enabled;
    persistTabStates();
  }
}

export function removeTabState(tabId: number): void {
  tabStates.delete(tabId);
  persistTabStates();
}
