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
  fingerprintBlocking: boolean;
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

