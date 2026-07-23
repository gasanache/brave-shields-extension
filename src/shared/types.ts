export interface ShieldsState {
  enabled: boolean;
  adsBlocked: number;
  trackersBlocked: number;
  fingerprintBlocked: number;
}

export interface TabState extends ShieldsState {
  tabId: number;
  hostname: string;
}

export interface SiteSettings {
  enabled: boolean;
  adBlockMode: 'standard' | 'aggressive';
  cookieBlocking: 'cross-site' | 'all' | 'none';
}

// Settings that apply across every site (not keyed by hostname).
export interface GlobalSettings {
  // Force sites to serve their U.S. English variant by spoofing the
  // Accept-Language header, navigator.language(s), Intl default locale, and
  // the Google/YouTube PREF cookie. On by default; the user can turn it off
  // per-install from the popup (their choice is then persisted).
  forceEnglishUS: boolean;
  // Sub-setting of forceEnglishUS: report U.S. Eastern time (America/New_York)
  // to the Intl/display layer — Intl.DateTimeFormat().resolvedOptions().timeZone
  // (what modern timezone-detection libraries read) and Intl/toLocale* date
  // formatting. The raw Date object (getTimezoneOffset, getHours, toString) is
  // left native to avoid corrupting date math, so those still report the real
  // zone. Only active while forceEnglishUS is also on. Off by default — see
  // DEFAULT_GLOBAL_SETTINGS.
  spoofTimezoneUS: boolean;
}

export interface FilterListInfo {
  id: string;
  name: string;
  url: string;
  category: 'ads' | 'privacy' | 'annoyances' | 'unbreak' | 'custom';
  enabled: boolean;
}

export interface CosmeticResources {
  hide_selectors: string[];
  injected_script: string | null;
  generichide: boolean;
}

