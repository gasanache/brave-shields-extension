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

export type MessageType =
  | { type: 'GET_HIDDEN_SELECTORS'; classes: string[]; ids: string[]; exceptions: string[] }
  | { type: 'GET_SHIELDS_STATUS'; tabId?: number; hostname?: string }
  | { type: 'TOGGLE_SHIELDS'; tabId: number; hostname: string; enabled: boolean }
  | { type: 'GET_STATS'; tabId?: number }
  | { type: 'UPDATE_SITE_SETTING'; hostname: string; key: string; value: string | boolean }
  | { type: 'GET_COSMETIC_RESOURCES'; url: string }
  | { type: 'SITE_AD_BLOCKED'; count?: number };
