# Brave Shields — Everywhere

Brave has the best ad blocker baked into any browser. Problem is, it comes with a crypto wallet, a news feed, a VPN, video calls, an AI chatbot, and a search engine nobody asked for. I just wanted the shields.

So I took their open-source blocking engine, wrapped it in WASM, and made it a standalone Chrome extension.

Works on Chrome, Edge, Arc, Vivaldi, Opera, [Thorium](https://thorium.rocks/) — anything Chromium-based. MV3, no background page, no remote code. Just `adblock-rust` compiled to WASM, a few thousand DNR rules, and content scripts that deal with YouTube and Twitch specifically because those two can't be handled at the network level.

## What it blocks

- Ads, trackers, fingerprinting scripts — ~16k DNR rules from EasyList, EasyPrivacy, uBlock filters, and Peter Lowe's list
- Cosmetic junk (banners, sponsored slots, "around the web" garbage) — ~5,300 per-site CSS rulesets generated from the adblock-rust engine
- YouTube video ads — hooks `fetch` and `XMLHttpRequest` to strip `adPlacements`/`playerAds`/`adSlots` from API responses before the player ever sees them, auto-skips anything that slips through
- Twitch ads — intercepts GraphQL ad operations and strips stitched ad segments out of HLS playlists

## How it works

The extension runs in three layers:

**Service worker** — loads the adblock-rust WASM engine, manages the static DNR rulesets, recomputes dynamic per-site rules whenever you flip a setting (`site-modes.ts`), tracks per-tab stats, persists everything to `chrome.storage.session` (because Chrome will kill your service worker whenever it feels like it and your in-memory state goes with it).

**Content scripts (ISOLATED world)** — `cosmetic-observer.ts` watches DOM mutations, batches new class/ID values, sends them to the service worker, gets back CSS selectors to hide. Also acts as a relay for the MAIN world scripts since those can't talk to `chrome.runtime` directly.

**Content scripts (MAIN world)** — `youtube-ad-blocker.ts` patches `fetch` and `XMLHttpRequest` to strip ad data from YouTube API responses. `twitch-ad-blocker.ts` patches `fetch` and `Worker` to intercept GraphQL ad requests and HLS playlists. Both run at `document_start` and post blocked counts back via `window.postMessage` → cosmetic observer → service worker.

## Per-site controls

The popup gives you per-hostname overrides:

- **Shields toggle** — turn the whole engine off for a site you trust (or one that breaks)
- **Ad blocking** — *Standard* uses the filter lists; *Aggressive* adds an extra ~20 first-party trackers (Google Analytics, Hotjar, Segment, FullStory, Amplitude, etc.) that the standard lists tend to leave alone to avoid breakage
- **Cookie blocking** — *Cross-site* (default) strips `cookie`/`set-cookie` headers from third-party requests via DNR `modifyHeaders`; *All* strips them everywhere on the site and also wipes existing cookies via `chrome.cookies` so you don't have to wait for the next request to log out; *None* lets everything through

Settings persist in `chrome.storage.local` and are enforced by dynamic DNR rules that the service worker recomputes on every change.

## Some things that were annoying to get right

**Service worker suspension.** Chrome suspends MV3 service workers aggressively. Tab stats lived in a `Map` that got wiped on every suspension. The badge still showed the right number (Chrome persists that) but opening the popup showed 0. Fixed by syncing to `chrome.storage.session` with debounced writes (200ms) and a promise-based loader that doesn't race on concurrent reads.

**DNR rules blocking page loads.** ABP filter rules without explicit resource types get converted to DNR rules that apply to *everything*, including `main_frame`. That means they can block you from navigating to a page entirely. The converter now defaults all block rules to non-navigation resource types and strips `main_frame` from explicit type lists.

**YouTube.** You can't block YouTube video ads with network rules because ads come from the same `googlevideo.com` CDN as the actual video. The only way is to intercept the player API response and delete the ad fields before YouTube's JS reads them. This means running in MAIN world, which means no access to extension APIs, which means relaying everything through postMessage.

**Twitch.** Twitch stitches ads directly into the HLS video stream as playlist segments marked with `#EXT-X-DATERANGE:CLASS="twitch-stitched-ad"`. You have to parse the M3U8 and remove those segments before the player fetches them. They also load ads through GraphQL (`AdRequestHandling`, `ClientSideAdEventHandling`) which get intercepted and returned as empty responses.

**The +1 ghost.** Every time you opened the popup, the blocked count went up by 1. Chrome was counting the popup's own resource loads (`chrome-extension://...`) through `onRuleMatchedDebug` and attributing them to the active tab. Fixed by filtering to only `http://`/`https://` URLs.

**Chrome's DNR enums.** `@types/chrome` declares `ResourceType`, `RuleActionType`, `DomainType`, `HeaderOperation` as real TypeScript enums — but Chrome doesn't expose them at runtime. The API just accepts string literals, so importing the enums for their values throws `ReferenceError`, and the type system fights you the moment you try to build a rule object. Fix is a local `LocalRule` interface with string literal unions and a single `as unknown as chrome.declarativeNetRequest.Rule[]` cast at the `updateDynamicRules` boundary.

**The jumping pill.** The segmented controls in the popup use a sliding indicator pill driven by JS reading `offsetLeft`/`offsetWidth` of the active button. On popup reopen with a non-default value, the pill visibly jumped from the default position to the real one — the CSS rule that was supposed to suppress the transition during `.loading` was racing the async state fetch. Fix is an inline `transition: none` + forced reflow (`void indicator.offsetHeight`) in the JS itself, so the first paint commits without interpolation regardless of any CSS source.

## Build

You need Node and Rust with `wasm-pack`.

```bash
npm install
npm run build          # everything: wasm, lists, dnr, cosmetic, engine, webpack

# or one at a time:
npm run build:wasm      # rust → wasm
npm run build:lists     # download filter lists
npm run build:dnr       # abp rules → chrome dnr json
npm run build:cosmetic  # extract element hiding css
npm run build:engine    # serialize adblock-rust engine
npm run build:extension # webpack bundle

npm run build:icons     # regenerate toolbar PNGs from icons/shield.svg
                        # (opt-in — not in the main build chain since icons rarely change)

npm run dev             # watch mode
```

Then load `dist/` as an unpacked extension in `chrome://extensions`.

### Incognito

The manifest declares `"incognito": "split"` so each profile runs its own service worker, storage, and dynamic rules — no state leaks between regular and private windows. Chrome still requires you to flip the per-install toggle yourself: open the extension's details page and enable **Allow in InCognito**. The popup shows a one-click hint banner until you do.

## Filter lists

| List | Source |
|------|--------|
| EasyList | [easylist.to](https://easylist.to/easylist/easylist.txt) |
| EasyPrivacy | [easylist.to](https://easylist.to/easylist/easyprivacy.txt) |
| uBlock Filters | [ublockorigin.github.io](https://ublockorigin.github.io/uAssets/filters/filters.txt) |
| uBlock Filters – Privacy | [ublockorigin.github.io](https://ublockorigin.github.io/uAssets/filters/privacy.txt) |
| Peter Lowe's List | [pgl.yoyo.org](https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0) |
| uBlock Filters – Annoyances | [ublockorigin.github.io](https://ublockorigin.github.io/uAssets/filters/annoyances-others.txt) (off by default) |

ABP syntax rules are converted to Chrome DNR format at build time (capped at 5k per list). Cosmetic selectors get extracted to per-domain CSS files.

## Credits

This project uses code and data from:

- **[Brave / adblock-rust](https://github.com/brave/adblock-rust)** — the core engine. Brave built a seriously fast content blocker in Rust and open-sourced it under MPL-2.0. This extension imports it as a Cargo dependency and wraps it in a thin WASM bridge — no Brave source code is copied into this repo. This project wouldn't exist without it.
- **[EasyList](https://easylist.to/)** — EasyList and EasyPrivacy. The standard filter lists that basically every ad blocker uses.
- **[uBlock Origin](https://github.com/gorhill/uBlock)** / **[uAssets](https://github.com/uBlockOrigin/uAssets)** — supplementary filters. Raymond Hill's work on uBlock Origin has shaped how content blocking works on the web.
- **[Peter Lowe](https://pgl.yoyo.org/adservers/)** — curated ad/tracking server list.
- **[Adblock Plus](https://adblockplus.org/)** — the ABP filter syntax that all the lists above use. The build pipeline converts it to Chrome's DNR format.
- **[Thorium](https://thorium.rocks/)** ([macOS](https://github.com/Alex313031/Thorium-MacOS) · [Windows](https://github.com/Alex313031/Thorium-Win) · [WOA](https://github.com/Alex313031/Thorium-WOA)) — a fast, clean Chromium fork. Recommended browser to run this on.

## Why not just use Brave?

I like Brave's shields. I don't want Brave's everything else.

Switching browsers means losing your profile, your extensions, your sync, your muscle memory. And for what — a crypto wallet? A news feed? Brave keeps shipping features that dilute what made it worth using in the first place.

The ad blocking engine is genuinely good. It should be a portable extension, not leverage to get you to switch browsers.

## Browser recommendation

If you're looking for a Chromium browser to pair this with, take a look at [Thorium](https://thorium.rocks/). It's a performance-focused Chromium fork — faster than stock Chrome, no bloat, no crypto, no built-in AI. Available for [macOS](https://github.com/Alex313031/Thorium-MacOS), [Windows](https://github.com/Alex313031/Thorium-Win), and [Windows on ARM](https://github.com/Alex313031/Thorium-WOA). Thorium + this extension gives you Brave-level ad blocking without any of the baggage.

## Disclaimer

This project is not affiliated with, endorsed by, or associated with Brave Software, Inc. "Brave" is a trademark of Brave Software, Inc. This extension is an independent project that uses Brave's open-source ad-blocking engine under the MPL-2.0 license.

Ad blocking may violate the Terms of Service of certain websites, including but not limited to YouTube and Twitch. Users assume all responsibility for how they use this software. The developers make no guarantees and accept no liability for any consequences — including account restrictions, degraded service, or anything else — resulting from the use of this extension.

This software is provided as-is, without warranty of any kind.

## License

The adblock-rust engine is MPL-2.0. Filter lists carry their own licenses (generally CC BY-SA or GPLv3). Check individual list pages for details.
