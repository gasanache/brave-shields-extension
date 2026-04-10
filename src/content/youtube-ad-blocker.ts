/**
 * YouTube Ad Blocker — runs in MAIN world at document_start
 * Intercepts YouTube API responses to strip ad data before the player processes it.
 */

(function () {
  'use strict';

  const AD_FIELDS = [
    'adPlacements',
    'adSlots',
    'playerAds',
    'adBreakParams',
    'adBreakHeartbeatParams',
    'adInferredBlockingStatus',
  ];

  let adsBlocked = 0;

  function notifyBlocked(count: number = 1): void {
    adsBlocked += count;
    window.postMessage({ type: '__SHIELDS_AD_BLOCKED__', count }, '*');
  }

  // --- 1. Strip ad fields from any object ---
  function stripAds(obj: any): boolean {
    if (!obj || typeof obj !== 'object') return false;
    let stripped = false;
    for (const field of AD_FIELDS) {
      if (field in obj) {
        delete obj[field];
        stripped = true;
      }
    }
    return stripped;
  }

  // --- 2. Intercept ytInitialPlayerResponse ---
  let _ytInitialPlayerResponse: any = undefined;
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get() {
        return _ytInitialPlayerResponse;
      },
      set(value) {
        if (value && typeof value === 'object') {
          if (stripAds(value)) notifyBlocked();
        }
        _ytInitialPlayerResponse = value;
      },
    });
  } catch {
    // Property might already be defined
  }

  // Also intercept ytInitialData (page-level ads like banner ads, feed ads)
  let _ytInitialData: any = undefined;
  try {
    Object.defineProperty(window, 'ytInitialData', {
      configurable: true,
      get() {
        return _ytInitialData;
      },
      set(value) {
        if (value && typeof value === 'object') {
          stripAds(value);
          // Remove ad-related renderers from the feed
          stripResponseAds(value);
        }
        _ytInitialData = value;
      },
    });
  } catch {
    // Property might already be defined
  }

  function stripResponseAds(data: any): void {
    if (!data) return;
    try {
      // Remove promoted/ad results from search and browse
      const contents =
        data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
          ?.sectionListRenderer?.contents ||
        data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
          ?.content?.richGridRenderer?.contents;
      if (Array.isArray(contents)) {
        for (let i = contents.length - 1; i >= 0; i--) {
          const item = contents[i];
          if (
            item?.promotedSparklesTextSearchRenderer ||
            item?.searchPyvRenderer ||
            item?.adSlotRenderer ||
            item?.richItemRenderer?.content?.adSlotRenderer
          ) {
            contents.splice(i, 1);
            notifyBlocked();
          }
        }
      }
    } catch {
      // Ignore structural changes
    }
  }

  // --- 3. Intercept fetch for YouTube API responses ---
  const originalFetch = window.fetch;
  window.fetch = async function (...args: any[]) {
    const response = await originalFetch.apply(this, args as any);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    if (
      url.includes('/youtubei/v1/player') ||
      url.includes('/youtubei/v1/next') ||
      url.includes('/youtubei/v1/browse') ||
      url.includes('/youtubei/v1/search')
    ) {
      try {
        const clone = response.clone();
        const json = await clone.json();
        let modified = false;

        if (stripAds(json)) modified = true;
        if (json?.playerResponse && stripAds(json.playerResponse))
          modified = true;
        stripResponseAds(json);

        if (modified) {
          notifyBlocked();
          return new Response(JSON.stringify(json), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
      } catch {
        // Not JSON or parsing error — return original
      }
    }

    return response;
  };

  // --- 4. Intercept XMLHttpRequest for older YouTube API calls ---
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: any[]
  ) {
    (this as any).__shieldsUrl = String(url);
    return originalXHROpen.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.send = function (...args: any[]) {
    const url = (this as any).__shieldsUrl || '';
    if (
      url.includes('/youtubei/v1/player') ||
      url.includes('/youtubei/v1/next')
    ) {
      this.addEventListener('readystatechange', function () {
        if (this.readyState === 4) {
          try {
            // Only intercept text-based responses
            const rt = this.responseType as string;
            if (rt && rt !== '' && rt !== 'text' && rt !== 'json') {
              return;
            }
            const text = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
            const json = JSON.parse(text);
            if (stripAds(json)) {
              notifyBlocked();
              const strippedStr = JSON.stringify(json);
              Object.defineProperty(this, 'responseText', {
                value: strippedStr,
                writable: false,
              });
              Object.defineProperty(this, 'response', {
                value: this.responseType === 'json' ? json : strippedStr,
                writable: false,
              });
            }
          } catch {
            // Not JSON
          }
        }
      });
    }
    return originalXHRSend.apply(this, args as any);
  };

  // --- 5. Catch-all JSON.parse hook ---
  // YouTube has been moving more player state to internal channels we can't
  // see (worker-side processing, batched RPC, etc.), so the fetch/XHR hooks
  // above don't catch everything. Hooking JSON.parse picks up any parse the
  // page does, regardless of how the bytes got there. stripAds is cheap (six
  // top-level field deletes), so running it on every parse is fine.
  const originalParse = JSON.parse;
  JSON.parse = function (text: string, reviver?: any) {
    const result = originalParse.call(this, text, reviver);
    try {
      if (result && typeof result === 'object') {
        if (stripAds(result)) notifyBlocked();
        // Player response is sometimes nested inside /next or /browse responses
        if (result.playerResponse && typeof result.playerResponse === 'object') {
          if (stripAds(result.playerResponse)) notifyBlocked();
        }
      }
    } catch {
      // Never break a parse — return the result as-is
    }
    return result;
  };

  // --- 6. Auto-skip ads and hide ad UI ---
  // Anything that slips past the network layer hits here. The .ad-showing
  // class on .html5-video-player is YouTube's own marker — when it's set we
  // mute, crank playbackRate, and jump to the end. State is restored when the
  // class drops so the user's volume and speed survive each ad break.
  let savedRate: number | null = null;
  let savedMuted: boolean | null = null;

  function skipAdIfPresent(): void {
    const player = document.querySelector('.html5-video-player');
    const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
    const isAdShowing =
      player?.classList.contains('ad-showing') ||
      player?.classList.contains('ad-interrupting');

    if (isAdShowing && video) {
      if (savedRate === null) {
        savedRate = video.playbackRate;
        savedMuted = video.muted;
      }
      video.muted = true;
      if (video.playbackRate !== 16) video.playbackRate = 16;
      if (video.duration && isFinite(video.duration)) {
        video.currentTime = video.duration;
      }
    } else if (savedRate !== null && video) {
      video.playbackRate = savedRate;
      if (savedMuted !== null) video.muted = savedMuted;
      savedRate = null;
      savedMuted = null;
    }

    // Click any visible skip button regardless of state
    const skipBtn =
      document.querySelector<HTMLButtonElement>('.ytp-skip-ad-button') ||
      document.querySelector<HTMLButtonElement>('.ytp-ad-skip-button-modern') ||
      document.querySelector<HTMLButtonElement>('.ytp-ad-skip-button') ||
      document.querySelector<HTMLButtonElement>('[id^="skip-button"]');
    if (skipBtn) {
      skipBtn.click();
      notifyBlocked();
    }
  }

  // Poll for ads that bypass the intercept
  setInterval(skipAdIfPresent, 500);

  // --- 7. CSS to hide ad UI elements ---
  const style = document.createElement('style');
  style.textContent = `
    .ytp-ad-overlay-container,
    .ytp-ad-module,
    .ytp-ad-image-overlay,
    .ytp-ad-text-overlay,
    .ytd-ad-slot-renderer,
    .ytd-banner-promo-renderer,
    .ytd-in-feed-ad-layout-renderer,
    .ytd-promoted-sparkles-text-search-renderer,
    .ytd-display-ad-renderer,
    .ytd-promoted-video-renderer,
    .ytd-search-pyv-renderer,
    .ytd-video-masthead-ad-v3-renderer,
    .ytd-primetime-promo-renderer,
    #masthead-ad,
    #player-ads,
    #panels > ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
    .ytd-merch-shelf-renderer,
    .ytd-statement-banner-renderer,
    tp-yt-paper-dialog.ytd-popup-container > ytd-enforcement-dialog-view-model,
    .ytp-ad-skip-button-container { display: none !important; }

    /* Hide "Ad" badge on video */
    .ytp-ad-text { display: none !important; }

    /* Hide premium upsell */
    ytd-popup-container > tp-yt-paper-dialog:has(yt-upsell-dialog-renderer) { display: none !important; }
  `;

  // Inject CSS as early as possible
  (document.head || document.documentElement).appendChild(style);

  console.log('[Shields] YouTube ad blocker active');
})();
