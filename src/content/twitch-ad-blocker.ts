/**
 * Twitch Ad Blocker — runs in MAIN world at document_start
 * Intercepts Twitch's ad delivery by patching fetch and stripping ad segments from HLS playlists.
 */

(function () {
  'use strict';

  function notifyBlocked(count: number = 1): void {
    window.postMessage({ type: '__SHIELDS_AD_BLOCKED__', count }, '*');
  }

  // --- 1. Intercept fetch to strip ads from GraphQL and HLS responses ---
  const originalFetch = window.fetch;
  window.fetch = async function (...args: any[]) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const init = args[1] || {};

    // Handle GraphQL requests — strip ad-related fields
    if (url.includes('gql.twitch.tv/gql')) {
      try {
        const body = typeof init.body === 'string' ? init.body : null;
        if (body) {
          const parsed = JSON.parse(body);
          const ops = Array.isArray(parsed) ? parsed : [parsed];
          let hasAdOp = false;

          for (const op of ops) {
            const opName = op?.operationName || '';
            // Skip ad-related GraphQL operations entirely
            if (
              opName === 'AdRequestHandling' ||
              opName === 'ClientSideAdEventHandling' ||
              opName === 'VideoAdRequestDecline'
            ) {
              hasAdOp = true;
            }
          }

          // If it's purely an ad request, return empty success
          if (hasAdOp && ops.length === 1) {
            notifyBlocked();
            return new Response(JSON.stringify({ data: {} }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
      } catch {
        // Not parseable, pass through
      }

      // For non-ad GraphQL, still check the response for ad data
      const response = await originalFetch.apply(this, args as any);
      try {
        const clone = response.clone();
        const json = await clone.json();
        let modified = false;

        const items = Array.isArray(json) ? json : [json];
        for (const item of items) {
          if (item?.extensions?.operationName?.includes('Ad')) {
            // Strip ad extension data
            delete item.extensions;
            modified = true;
          }
          // Remove ad-related data from stream access responses
          if (item?.data?.streamPlaybackAccessToken?.value) {
            try {
              const tokenData = JSON.parse(
                item.data.streamPlaybackAccessToken.value
              );
              if (tokenData.adblock) {
                delete tokenData.adblock;
                item.data.streamPlaybackAccessToken.value =
                  JSON.stringify(tokenData);
                modified = true;
              }
            } catch {
              // Not parseable
            }
          }
        }

        if (modified) {
          notifyBlocked();
          return new Response(JSON.stringify(Array.isArray(json) ? items : items[0]), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
        return response;
      } catch {
        return response;
      }
    }

    // Handle HLS playlist requests — strip ad segments
    if (url.includes('.m3u8') || url.includes('usher.ttvnw.net')) {
      const response = await originalFetch.apply(this, args as any);
      try {
        const text = await response.clone().text();
        if (text.includes('stitched-ad') || text.includes('twitch-stitched-ad')) {
          const cleaned = stripAdSegments(text);
          if (cleaned !== text) {
            notifyBlocked();
            return new Response(cleaned, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          }
        }
      } catch {
        // Return original on error
      }
      return response;
    }

    return originalFetch.apply(this, args as any);
  };

  // --- 2. Strip ad segments from M3U8 playlists ---
  function stripAdSegments(playlist: string): string {
    const lines = playlist.split('\n');
    const result: string[] = [];
    let skipUntilSegment = false;
    let inAdSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect ad date ranges
      if (
        line.includes('#EXT-X-DATERANGE') &&
        (line.includes('stitched-ad') ||
          line.includes('twitch-stitched-ad') ||
          line.includes('CLASS="twitch-ad"'))
      ) {
        // Skip this ad marker
        inAdSection = true;
        continue;
      }

      // Detect ad discontinuity markers
      if (line.includes('#EXT-X-DISCONTINUITY') && inAdSection) {
        // End of ad section
        inAdSection = false;
        skipUntilSegment = false;
        continue;
      }

      // Skip ad segment lines
      if (inAdSection) {
        if (line.startsWith('#EXTINF:')) {
          // Next line is the ad segment URL — skip both
          skipUntilSegment = true;
          continue;
        }
        if (skipUntilSegment && !line.startsWith('#')) {
          skipUntilSegment = false;
          continue;
        }
        // Skip other ad-related tags
        if (
          line.includes('X-TV-TWITCH-AD') ||
          line.includes('AD-INSERTION') ||
          line.includes('SCTE35')
        ) {
          continue;
        }
      }

      result.push(line);
    }

    return result.join('\n');
  }

  // --- 3. Patch Worker constructor to intercept worker-based ad loading ---
  const OriginalWorker = window.Worker;
  (window as any).Worker = function (url: string | URL, options?: WorkerOptions) {
    const worker = new OriginalWorker(url, options);

    // Intercept messages from the worker that contain ad data
    const originalPostMessage = worker.postMessage.bind(worker);
    const originalAddEventListener = worker.addEventListener.bind(worker);

    worker.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) {
      if (type === 'message') {
        const wrappedListener = function (event: MessageEvent) {
          // Check if the message contains ad-related data
          if (event.data?.type === 'ad-request' || event.data?.type === 'ad-response') {
            notifyBlocked();
            return; // Drop the message
          }
          if (typeof listener === 'function') {
            listener(event);
          } else {
            listener.handleEvent(event);
          }
        };
        return originalAddEventListener(type, wrappedListener as EventListener, options);
      }
      return originalAddEventListener(type, listener, options);
    };

    // Also intercept onmessage property setter
    let _onmessage: ((ev: MessageEvent) => any) | null = null;
    Object.defineProperty(worker, 'onmessage', {
      get() { return _onmessage; },
      set(handler: ((ev: MessageEvent) => any) | null) {
        if (handler) {
          _onmessage = handler;
          originalAddEventListener('message', function (event: Event) {
            const msgEvent = event as MessageEvent;
            if (msgEvent.data?.type === 'ad-request' || msgEvent.data?.type === 'ad-response') {
              notifyBlocked();
              return;
            }
            handler(msgEvent);
          });
        } else {
          _onmessage = null;
        }
      },
    });

    return worker;
  } as any;
  // Copy static properties
  Object.setPrototypeOf((window as any).Worker, OriginalWorker);
  (window as any).Worker.prototype = OriginalWorker.prototype;

  // --- 4. CSS to hide ad UI elements ---
  const style = document.createElement('style');
  style.textContent = `
    /* Hide ad overlays */
    .player-ad-overlay,
    .player-ad-notice,
    [data-a-target="player-overlay-click-handler"],
    [data-a-target="video-ad-label"],
    [data-a-target="video-ad-countdown"],
    .stream-display-ad__container,
    .tw-c-background-overlay,
    div[data-test-selector="ad-banner-default-container"],
    .video-player__ad-overlay,
    .twilight-minimal-root > div:has(.stream-display-ad),
    [class*="ScAdContainer"],
    [class*="AdBanner"] { display: none !important; }

    /* Prevent purple screen during ads */
    .video-player--ad-animating .video-player__container { opacity: 1 !important; }
  `;

  (document.head || document.documentElement).appendChild(style);

  // --- 5. Monitor for mid-roll ad breaks and auto-dismiss ---
  setInterval(() => {
    // Check for ad overlay and try to close it
    const adOverlay = document.querySelector<HTMLElement>(
      '[data-a-target="player-overlay-click-handler"]'
    );
    if (adOverlay) {
      adOverlay.remove();
      notifyBlocked();
    }

    // Check for "ad playing" state and try to skip
    const adLabel = document.querySelector('[data-a-target="video-ad-label"]');
    if (adLabel) {
      // Try to find and click any close/skip buttons
      const closeBtn = document.querySelector<HTMLButtonElement>(
        '[data-a-target="player-overlay-close-btn"]'
      );
      if (closeBtn) closeBtn.click();
    }
  }, 1000);

  console.log('[Shields] Twitch ad blocker active');
})();
