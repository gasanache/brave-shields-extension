import { getAllSiteSettings } from './storage';

// Dynamic rule ID ranges. Keep distinct so we can manage them independently
// from any future dynamic rules and from each other.
const AGGRESSIVE_RULE_ID_START = 1;
const AGGRESSIVE_RULE_ID_END = 50;
const COOKIE_RULE_ID_CROSS_SITE = 100;
const COOKIE_RULE_ID_ALL = 101;
const RULE_PRIORITY = 100;

// First-party trackers that the standard filter lists tend to allow on the
// site that's loading them (via ~third-party exceptions or because the lists
// are conservative about breakage). Aggressive mode blocks them regardless of
// who initiates the request — the user opted into the breakage risk.
const AGGRESSIVE_BLOCK_PATTERNS = [
  '||google-analytics.com^',
  '||googletagmanager.com^',
  '||doubleclick.net^',
  '||facebook.com/tr',
  '||facebook.net^',
  '||hotjar.com^',
  '||mixpanel.com^',
  '||segment.io^',
  '||segment.com^',
  '||fullstory.com^',
  '||amplitude.com^',
  '||heap.io^',
  '||intercom.io^',
  '||intercomcdn.com^',
  '||mouseflow.com^',
  '||crazyegg.com^',
  '||clarity.ms^',
  '||optimizely.com^',
  '||quantserve.com^',
  '||scorecardresearch.com^',
];

// Resource types covered by header-modifying cookie rules. Includes main_frame
// so that cookies are stripped on top-level navigation as well — load-bearing
// for the "all" mode (otherwise the user stays logged in via the page request).
const ALL_RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'other',
];

// Resource types for aggressive ad-blocking — main_frame is excluded so we
// don't block top-level navigation to a site that happens to match a pattern.
const SUB_RESOURCE_TYPES = [
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'media',
  'websocket',
  'other',
];

// Local rule shape that uses plain strings — chrome's @types/chrome models the
// DNR API with real enums (ResourceType, RuleActionType, etc.) which are NOT
// exposed at runtime by Chrome. Using string literals matches what the API
// actually accepts; we cast to the chrome type only at the updateDynamicRules
// boundary.
interface LocalRule {
  id: number;
  priority: number;
  action: {
    type: 'block' | 'modifyHeaders';
    requestHeaders?: Array<{ header: string; operation: 'remove' | 'set' | 'append' }>;
    responseHeaders?: Array<{ header: string; operation: 'remove' | 'set' | 'append' }>;
  };
  condition: {
    urlFilter?: string;
    initiatorDomains?: string[];
    excludedInitiatorDomains?: string[];
    domainType?: 'firstParty' | 'thirdParty';
    resourceTypes?: string[];
  };
}

interface SiteBuckets {
  aggressive: string[];
  cookieAll: string[];
  // Sites that have opted out of the default cross-site cookie blocking — either
  // by selecting "None", by selecting "All" (covered by a stricter rule), or
  // by disabling shields entirely. All go in excludedInitiatorDomains of the
  // global cross-site rule.
  cookieDefaultExempt: string[];
}

function bucketSites(allSettings: Record<string, { enabled: boolean; adBlockMode: string; cookieBlocking: string }>): SiteBuckets {
  const aggressive: string[] = [];
  const cookieAll: string[] = [];
  const cookieDefaultExempt: string[] = [];

  for (const [hostname, settings] of Object.entries(allSettings)) {
    if (!settings.enabled) {
      // Shields off — exempt from default cross-site enforcement and don't apply
      // any aggressive/all-cookie rules either (loop continues).
      cookieDefaultExempt.push(hostname);
      continue;
    }
    if (settings.adBlockMode === 'aggressive') aggressive.push(hostname);
    if (settings.cookieBlocking === 'all') {
      cookieAll.push(hostname);
      cookieDefaultExempt.push(hostname);
    } else if (settings.cookieBlocking === 'none') {
      cookieDefaultExempt.push(hostname);
    }
  }

  return { aggressive, cookieAll, cookieDefaultExempt };
}

function buildRules(buckets: SiteBuckets): LocalRule[] {
  const rules: LocalRule[] = [];

  // Aggressive ad blocking — one rule per pattern, all aggressive sites share
  // the same initiatorDomains list (much cheaper than rules-per-site).
  if (buckets.aggressive.length > 0) {
    AGGRESSIVE_BLOCK_PATTERNS.forEach((pattern, i) => {
      rules.push({
        id: AGGRESSIVE_RULE_ID_START + i,
        priority: RULE_PRIORITY,
        action: { type: 'block' },
        condition: {
          urlFilter: pattern,
          initiatorDomains: buckets.aggressive,
          resourceTypes: SUB_RESOURCE_TYPES,
        },
      });
    });
  }

  // Default cross-site cookie blocking — applies globally to third-party
  // requests, except on sites that opted out (cookieBlocking: 'all'/'none' or
  // shields disabled). 'all' is also covered by a stricter rule below; the
  // exemption here just avoids double-matching.
  const crossSiteCondition: LocalRule['condition'] = {
    domainType: 'thirdParty',
    resourceTypes: ALL_RESOURCE_TYPES,
  };
  if (buckets.cookieDefaultExempt.length > 0) {
    crossSiteCondition.excludedInitiatorDomains = buckets.cookieDefaultExempt;
  }
  rules.push({
    id: COOKIE_RULE_ID_CROSS_SITE,
    priority: RULE_PRIORITY,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'cookie', operation: 'remove' }],
      responseHeaders: [{ header: 'set-cookie', operation: 'remove' }],
    },
    condition: crossSiteCondition,
  });

  // "Block all cookies" mode — strip cookies regardless of party for the
  // sites that explicitly opted in. Includes first-party requests, so this
  // WILL log the user out of the site; that's the documented behavior.
  if (buckets.cookieAll.length > 0) {
    rules.push({
      id: COOKIE_RULE_ID_ALL,
      priority: RULE_PRIORITY,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'cookie', operation: 'remove' }],
        responseHeaders: [{ header: 'set-cookie', operation: 'remove' }],
      },
      condition: {
        initiatorDomains: buckets.cookieAll,
        resourceTypes: ALL_RESOURCE_TYPES,
      },
    });
  }

  return rules;
}

// Recompute and install the dynamic rules that implement per-site adBlockMode
// and cookieBlocking. Call after any setting change that affects either field
// (and on service-worker startup).
export async function syncDynamicRules(): Promise<void> {
  try {
    const allSettings = await getAllSiteSettings();
    const buckets = bucketSites(allSettings);
    const newRules = buildRules(buckets);

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const ourIds = existing
      .filter(
        (r) =>
          (r.id >= AGGRESSIVE_RULE_ID_START && r.id <= AGGRESSIVE_RULE_ID_END) ||
          r.id === COOKIE_RULE_ID_CROSS_SITE ||
          r.id === COOKIE_RULE_ID_ALL
      )
      .map((r) => r.id);

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ourIds,
      addRules: newRules as unknown as chrome.declarativeNetRequest.Rule[],
    });
  } catch (err) {
    console.error('[Shields] syncDynamicRules failed:', err);
  }
}

// Best-effort cleanup of existing cookies for a hostname. Called when a user
// switches a site to cookieBlocking='all' so they don't have to wait for the
// next request to see the change. chrome.cookies.getAll matches by domain
// attribute and will pick up exact-match plus subdomain (.example.com) cookies.
export async function clearCookiesForHost(hostname: string): Promise<void> {
  try {
    const cookies = await chrome.cookies.getAll({ domain: hostname });
    await Promise.all(
      cookies.map(async (cookie) => {
        const bareDomain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
        const protocol = cookie.secure ? 'https://' : 'http://';
        const url = `${protocol}${bareDomain}${cookie.path}`;
        try {
          await chrome.cookies.remove({ url, name: cookie.name, storeId: cookie.storeId });
        } catch {
          // Individual remove failures are non-fatal
        }
      })
    );
  } catch (err) {
    console.warn(`[Shields] clearCookiesForHost(${hostname}) failed:`, err);
  }
}
