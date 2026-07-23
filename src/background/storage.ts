import { TabState, SiteSettings, GlobalSettings } from '../shared/types';
import { STORAGE_KEYS, DEFAULT_SITE_SETTINGS, DEFAULT_GLOBAL_SETTINGS } from '../shared/constants';

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

// Global (not per-site) settings. Spread over the defaults so newly-added keys
// pick up their default value even for installs that saved an older shape.
export async function getGlobalSettings(): Promise<GlobalSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.GLOBAL_SETTINGS);
  return { ...DEFAULT_GLOBAL_SETTINGS, ...(result[STORAGE_KEYS.GLOBAL_SETTINGS] ?? {}) };
}

// spoofTimezoneUS shipped defaulting to true through 1.0.8, and setGlobalSettings
// writes the whole merged object — so toggling *any* global setting back then
// persisted `spoofTimezoneUS: true`. Flipping the default alone would never
// reach those installs, so drop the stored value once and let the new default
// (off) apply. Guarded by its own key so it runs exactly once and a later
// deliberate opt-in sticks.
export async function migrateTimezoneDefaultOff(): Promise<void> {
  try {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.GLOBAL_SETTINGS,
      STORAGE_KEYS.TZ_DEFAULT_OFF_MIGRATED,
    ]);
    if (result[STORAGE_KEYS.TZ_DEFAULT_OFF_MIGRATED]) return;

    const stored = result[STORAGE_KEYS.GLOBAL_SETTINGS];
    if (stored && 'spoofTimezoneUS' in stored) {
      delete stored.spoofTimezoneUS;
      await chrome.storage.local.set({ [STORAGE_KEYS.GLOBAL_SETTINGS]: stored });
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.TZ_DEFAULT_OFF_MIGRATED]: true });
  } catch (err) {
    console.error('[Shields] migrateTimezoneDefaultOff failed:', err);
  }
}

export async function setGlobalSettings(patch: Partial<GlobalSettings>): Promise<void> {
  const current = await getGlobalSettings();
  await chrome.storage.local.set({
    [STORAGE_KEYS.GLOBAL_SETTINGS]: { ...current, ...patch },
  });
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
