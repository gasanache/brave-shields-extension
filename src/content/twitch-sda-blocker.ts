/**
 * Twitch Stream Display Ad blocker — ISOLATED world, document_start.
 *
 * "Stream display ads" (SDA) are Twitch's client-rendered ad format: the live
 * stream keeps playing, but the player is squeezed to free up room for an ad
 * iframe beside or below it. vaft (twitch-ad-blocker.ts) never sees them —
 * they don't ride in the HLS stream — and upstream closed the report as out of
 * scope for that project (pixeltris/TwitchAdSolutions#345), so they're handled
 * here instead.
 *
 * Twitch renders the ad into `.stream-display-ad__*` nodes and squeezes the
 * player by adding a `.video-player--stream-display-ad_<format>` modifier plus
 * an inline width/height. Hiding just the ad leaves the stream small with a
 * black gap next to it, so we also pin the player back to the full player box.
 * An author `!important` declaration outranks a normal inline one, so the CSS
 * wins without us having to fight React over the style attribute.
 *
 * Formats in Twitch's stylesheet as of this writing: squeezeback, left-third,
 * lower-third, skyscraper, pushdown, vertical-video. The selectors match on
 * class substrings so a new format name is covered without a code change.
 * Note the double underscore: `stream-display-ad__*` is the ad's own subtree,
 * `stream-display-ad_*` (single) is the player modifier — they must not be
 * confused, one gets hidden and the other gets resized.
 */

const STYLE_ID = 'brave-shields-twitch-sda';

// How often to check whether an ad break is running. Only used for the blocked
// counter, so a coarse interval is fine — the hiding itself is pure CSS.
const POLL_MS = 2000;

const SDA_CSS = `
[class*="stream-display-ad__"],
[class*="pushdown-sda__"],
[data-test-selector="sda-wrapper"] {
  display: none !important;
}

[class*="video-player--stream-display-ad"] {
  width: 100% !important;
  height: 100% !important;
  top: 0 !important;
  inset-inline-start: 0 !important;
  transform: none !important;
  transition: none !important;
}
`;

// document_start runs before <head> exists, so fall back to documentElement.
// Re-appended on demand because Twitch replaces the head on some navigations.
function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = SDA_CSS;
  (document.head || document.documentElement).appendChild(style);
}

ensureStyle();

// Twitch flips `--visible` on the wrapper for the duration of an ad break, so
// a rising edge of that class is one blocked stream display ad.
let adVisible = false;

setInterval(() => {
  ensureStyle();

  const showing =
    document.querySelector('[class*="stream-display-ad__wrapper-visible"]') !== null;

  if (showing && !adVisible) {
    adVisible = true;
    try {
      chrome.runtime.sendMessage({ type: 'SITE_AD_BLOCKED', count: 1 });
    } catch {
      // Extension context invalidated (update/reload) — nothing to report to.
    }
  } else if (!showing) {
    adVisible = false;
  }
}, POLL_MS);
