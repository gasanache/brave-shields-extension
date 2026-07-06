export const DEFAULT_SITE_SETTINGS = {
  enabled: true,
  adBlockMode: 'standard' as const,
  cookieBlocking: 'cross-site' as const,
};

export const DEFAULT_GLOBAL_SETTINGS = {
  forceEnglishUS: true,
  spoofTimezoneUS: true,
};

export const STORAGE_KEYS = {
  SITE_SETTINGS: 'siteSettings',
  TAB_STATES: 'tabStates',
  GLOBAL_SETTINGS: 'globalSettings',
};
