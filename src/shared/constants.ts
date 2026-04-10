export const DEFAULT_SITE_SETTINGS = {
  enabled: true,
  adBlockMode: 'standard' as const,
  cookieBlocking: 'cross-site' as const,
  fingerprintBlocking: true,
};

export const STORAGE_KEYS = {
  SITE_SETTINGS: 'siteSettings',
  TAB_STATES: 'tabStates',
  FILTER_LIST_METADATA: 'filterListMetadata',
};

export const UPDATE_ALARM_NAME = 'checkFilterUpdates';
export const UPDATE_INTERVAL_MINUTES = 1440; // 24 hours
