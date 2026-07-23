export const DEFAULT_SITE_SETTINGS = {
  enabled: true,
  adBlockMode: 'standard' as const,
  cookieBlocking: 'cross-site' as const,
};

export const DEFAULT_GLOBAL_SETTINGS = {
  forceEnglishUS: true,
  // Off by default: forcing U.S. Eastern on the Intl layer makes every site
  // that formats a date or schedules against the resolved zone show the wrong
  // local time, which is a worse trade than the English-content benefit.
  // Still available as an opt-in sub-toggle in the popup.
  spoofTimezoneUS: false,
};

export const STORAGE_KEYS = {
  SITE_SETTINGS: 'siteSettings',
  TAB_STATES: 'tabStates',
  GLOBAL_SETTINGS: 'globalSettings',
  TZ_DEFAULT_OFF_MIGRATED: 'tzDefaultOffMigrated',
};
