export const ENGINE_DAT_PATH = 'data/engine.dat';
export const WASM_PATH = 'wasm/adblock_engine_bg.wasm';

export const DEFAULT_SITE_SETTINGS = {
  enabled: true,
  adBlockMode: 'standard' as const,
  cookieBlocking: 'cross-site' as const,
  fingerprintBlocking: true,
};

export const STORAGE_KEYS = {
  GLOBAL_ENABLED: 'globalEnabled',
  SITE_SETTINGS: 'siteSettings',
  TAB_STATES: 'tabStates',
  FILTER_LIST_METADATA: 'filterListMetadata',
};

export const UPDATE_ALARM_NAME = 'checkFilterUpdates';
export const UPDATE_INTERVAL_MINUTES = 1440; // 24 hours
