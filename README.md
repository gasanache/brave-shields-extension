# Brave Shields (standalone)

Brave's ad blocker without the rest of Brave. It's the `adblock-rust` engine compiled to WASM and packaged as a plain MV3 Chromium extension. No wallet, no news feed, no VPN, no AI.

Works on any Chromium browser: Chrome, Edge, Vivaldi, Opera, [Thorium](https://thorium.rocks/), [Helium](https://helium.computer/), and so on.

## What it blocks

- Ads, trackers and fingerprinting scripts: ~16k DNR rules (EasyList, EasyPrivacy, uBlock, Peter Lowe) plus the WASM engine for cosmetic element hiding.
- YouTube video ads: strips `adPlacements`/`playerAds`/`adSlots` out of the player API response before the page reads it, and skips anything that gets through.
- Twitch ads: Twitch stitches ads into the HLS video stream, so when an ad shows up the script swaps to an ad-free backup stream for the duration of the break. Based on [TwitchAdSolutions](https://github.com/pixeltris/TwitchAdSolutions). Twitch breaks this every so often, so expect the occasional miss.

## Per-site controls

Click the toolbar icon to set overrides for the current site:

- Shields on/off.
- Ad blocking: standard (filter lists) or aggressive (adds ~20 common first-party trackers like GA, Hotjar, Segment).
- Cookie blocking: cross-site (default), all, or none.

Settings are saved per hostname and enforced with dynamic DNR rules.

## Build

Needs Node, plus Rust and `wasm-pack` for the engine.

```
npm install
npm run build
```

Steps can also be run on their own: `build:wasm`, `build:lists`, `build:dnr`, `build:cosmetic`, `build:engine`, `build:extension`. `npm run dev` is watch mode.

Then go to `chrome://extensions`, turn on Developer mode, and load the `dist/` folder. For private windows, open the extension's details page and enable "Allow in Incognito".

## Filter lists

EasyList, EasyPrivacy, uBlock filters and privacy, and Peter Lowe's list, all pulled from upstream at build time. uBlock annoyances is bundled but off by default. ABP rules are converted to Chrome's DNR format (capped at 5k per list) and cosmetic selectors are extracted per domain.

## Credits

- [Brave / adblock-rust](https://github.com/brave/adblock-rust) (MPL-2.0): the engine. Used as a Cargo dependency behind a thin WASM bridge; no Brave source is copied here.
- [EasyList](https://easylist.to/), [uBlock Origin / uAssets](https://github.com/uBlockOrigin/uAssets), [Peter Lowe](https://pgl.yoyo.org/adservers/): filter lists.
- [TwitchAdSolutions](https://github.com/pixeltris/TwitchAdSolutions) (pixeltris, MIT): the Twitch stream-swap method.
- [Adblock Plus](https://adblockplus.org/): the ABP filter syntax the lists use.

## Notes

Not affiliated with Brave Software. "Brave" is their trademark. Ad blocking can violate a site's terms of service (YouTube and Twitch in particular); use it at your own risk. Provided as-is, no warranty.

The engine is MPL-2.0; filter lists keep their own licenses (usually CC BY-SA or GPLv3).
