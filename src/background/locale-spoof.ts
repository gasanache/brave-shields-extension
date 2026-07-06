// "Force English (US)" — a global, opt-in setting that makes sites serve their
// U.S. English variant. Two layers:
//   1. A dynamic DNR rule that sets the Accept-Language request header (what most
//      sites use server-side to redirect to a localized variant).
//   2. A MAIN-world content script that spoofs navigator.language(s) (client-side
//      i18n). Registered/unregistered here in lockstep with the setting.
// Neither can change IP-based geolocation — that needs a VPN/proxy.

import { getGlobalSettings, getSiteSettings } from './storage';

// Dynamic rule ID for the Accept-Language header. Sits well clear of the
// per-site rule ranges in site-modes.ts (1–50, 100, 101, 200).
const ACCEPT_LANGUAGE_RULE_ID = 300;
// Above SHIELDS_OFF_PRIORITY (1000) in site-modes.ts so the language header is
// set even on sites where the user turned Shields off — "Force English" is a
// separate, global preference, and a modifyHeaders rule only applies over an
// allow/allowAllRequests rule if its priority is higher.
const ACCEPT_LANGUAGE_PRIORITY = 2000;
const ACCEPT_LANGUAGE_VALUE = 'en-US,en;q=0.9';

const LOCALE_SCRIPT_ID = 'locale-spoof';
const TZ_SCRIPT_ID = 'tz-spoof';

// Every navigable/subresource type — Accept-Language is harmless everywhere and
// we want the header consistent across the whole page load.
const LOCALE_RESOURCE_TYPES = [
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

function buildAcceptLanguageRule() {
  return {
    id: ACCEPT_LANGUAGE_RULE_ID,
    priority: ACCEPT_LANGUAGE_PRIORITY,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'accept-language', operation: 'set', value: ACCEPT_LANGUAGE_VALUE },
      ],
    },
    condition: {
      resourceTypes: LOCALE_RESOURCE_TYPES,
    },
  };
}

// Install or tear down the Accept-Language dynamic rule to match the setting.
// Idempotent — safe to call on every SW startup and on every toggle.
export async function syncLocaleRules(): Promise<void> {
  try {
    const { forceEnglishUS } = await getGlobalSettings();

    if (forceEnglishUS) {
      // removeRuleIds first makes this an upsert (removing a missing id is a no-op).
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [ACCEPT_LANGUAGE_RULE_ID],
        addRules: [buildAcceptLanguageRule() as unknown as chrome.declarativeNetRequest.Rule],
      });
    } else {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [ACCEPT_LANGUAGE_RULE_ID],
      });
    }
  } catch (err) {
    console.error('[Shields] syncLocaleRules failed:', err);
  }
}

// Google properties (YouTube, Search) pin the UI language in a first-party
// PREF cookie once one exists — set the first time the user touches a
// language/consent/location control — and from then on that cookie beats the
// Accept-Language header on every visit. Force the hl (host language) and gl
// (content region) keys to US-English values so a stale hl=de doesn't keep the
// UI German despite the spoofed header. Other PREF keys (volume, autoplay,
// theme flags…) are preserved. Signed-in accounts are the remaining exception:
// account-level language/location live server-side and win over both — the
// user has to change those in their Google/YouTube settings.
// hostKeys: the per-site settings keys (popup stores them by tab hostname) that
// cover this cookie domain — checked so we never plant a cookie on a site the
// user explicitly set to "block all cookies".
const PREF_COOKIE_DOMAINS = [
  {
    domain: '.youtube.com',
    url: 'https://www.youtube.com/',
    hostKeys: ['youtube.com', 'www.youtube.com', 'm.youtube.com'],
  },
  {
    domain: '.google.com',
    url: 'https://www.google.com/',
    hostKeys: ['google.com', 'www.google.com'],
  },
];
const PREF_FORCED: Record<string, string> = { hl: 'en', gl: 'US' };
const PREF_COOKIE_TTL_SECONDS = 2 * 365 * 24 * 60 * 60; // ~2 years, like Google's own

export async function syncLocalePrefCookies(): Promise<void> {
  try {
    const { forceEnglishUS } = await getGlobalSettings();
    // When off we deliberately leave PREF alone — deleting hl/gl would also
    // discard a language the user picked on the site themselves.
    if (!forceEnglishUS) return;

    for (const { domain, url, hostKeys } of PREF_COOKIE_DOMAINS) {
      // Respect the user's per-site cookie choice: if any hostname covering
      // this domain is set to "block all cookies", planting PREF here would
      // undo clearCookiesForHost on every SW wake-up. Skip it.
      const siteSettings = await Promise.all(hostKeys.map((h) => getSiteSettings(h)));
      if (siteSettings.some((s) => s.cookieBlocking === 'all')) continue;

      const existing = await chrome.cookies.get({ url, name: 'PREF' });

      // PREF's value is query-string-shaped: "hl=de&f6=40000&gl=DE".
      const parts = new Map<string, string>();
      if (existing?.value) {
        for (const kv of existing.value.split('&')) {
          const eq = kv.indexOf('=');
          if (eq > 0) parts.set(kv.slice(0, eq), kv.slice(eq + 1));
        }
      }

      let changed = false;
      for (const [key, val] of Object.entries(PREF_FORCED)) {
        if (parts.get(key) !== val) {
          parts.set(key, val);
          changed = true;
        }
      }
      if (!changed) continue; // already forced — don't churn the cookie

      const value = Array.from(parts.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
      await chrome.cookies.set({
        url,
        name: 'PREF',
        value,
        domain,
        path: '/',
        secure: true,
        // When rewriting, preserve the attributes Google set the cookie with
        // (and the store it lives in — matters for incognito split mode).
        ...(existing && {
          sameSite: existing.sameSite,
          httpOnly: existing.httpOnly,
          storeId: existing.storeId,
        }),
        expirationDate: Math.floor(Date.now() / 1000) + PREF_COOKIE_TTL_SECONDS,
      });
    }
  } catch (err) {
    console.error('[Shields] syncLocalePrefCookies failed:', err);
  }
}

// Register or unregister one of our MAIN-world spoof scripts to match a
// desired state. Idempotent — mirrors syncYouTubeScript's pattern.
async function syncSpoofScript(id: string, jsFile: string, wanted: boolean): Promise<void> {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  const isRegistered = existing.length > 0;

  if (!wanted) {
    if (isRegistered) {
      await chrome.scripting.unregisterContentScripts({ ids: [id] });
    }
    return;
  }

  if (isRegistered) return; // already registered with the right config

  // Upsert: clear any existing registration first so two racing syncs can't
  // both add the same id and trip a duplicate-id error (mirrors the
  // removeRuleIds upsert in syncLocaleRules). The caller's try/catch
  // backstops any residual race.
  await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
  const registration: chrome.scripting.RegisteredContentScript = {
    id,
    matches: ['<all_urls>'],
    js: [jsFile],
    runAt: 'document_start',
    world: 'MAIN' as chrome.scripting.ExecutionWorld,
    allFrames: true,
    persistAcrossSessions: true,
  };
  // Inject into about:blank / srcdoc / sandboxed iframes too — otherwise the
  // classic "clean iframe" trick (create an iframe, read its contentWindow's
  // navigator/Intl) reads the real locale and bypasses the spoof. Chrome 119+;
  // set dynamically since it's absent from older @types/chrome.
  (registration as { matchOriginAsFallback?: boolean }).matchOriginAsFallback = true;
  await chrome.scripting.registerContentScripts([registration]);
}

// navigator.language(s) + Intl default-locale spoof — active whenever the
// feature is on.
export async function syncLocaleScript(): Promise<void> {
  try {
    const { forceEnglishUS } = await getGlobalSettings();
    await syncSpoofScript(LOCALE_SCRIPT_ID, 'locale-spoof.js', forceEnglishUS);
  } catch (err) {
    console.error('[Shields] syncLocaleScript failed:', err);
  }
}

// America/New_York timezone spoof — a sub-setting, only active while the
// feature itself is also on.
export async function syncTzScript(): Promise<void> {
  try {
    const { forceEnglishUS, spoofTimezoneUS } = await getGlobalSettings();
    await syncSpoofScript(TZ_SCRIPT_ID, 'tz-spoof.js', forceEnglishUS && spoofTimezoneUS);
  } catch (err) {
    console.error('[Shields] syncTzScript failed:', err);
  }
}
