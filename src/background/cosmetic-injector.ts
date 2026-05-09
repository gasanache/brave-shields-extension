import { getCosmeticResources } from './engine';
import { getSiteSettings } from './storage';

export function setupCosmeticInjector(): void {
  chrome.webNavigation.onCommitted.addListener(async (details) => {
    const { tabId, url, frameId } = details;

    // Skip non-http(s) URLs
    if (!url.startsWith('http://') && !url.startsWith('https://')) return;

    // Use top-frame URL for the shields check so iframes inherit the tab's
    // setting. Per-site cosmetic lookup further down still uses the frame's
    // own URL — that's per-origin, not per-tab.
    let topUrl = url;
    if (frameId !== 0) {
      try {
        const topFrame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
        if (topFrame && topFrame.url) topUrl = topFrame.url;
      } catch {
        return;
      }
    }

    let topHostname: string;
    try {
      topHostname = new URL(topUrl).hostname;
    } catch {
      return;
    }

    // Check if shields are enabled for this site
    const settings = await getSiteSettings(topHostname);
    if (!settings.enabled) return;

    // generic.css used to ship as a static manifest content_script — moved here
    // so it's gated by the same enabled check as everything else.
    try {
      await chrome.scripting.insertCSS({
        target: { tabId, frameIds: [frameId] },
        files: ['cosmetic/generic.css'],
        origin: 'USER',
      });
    } catch (err) {
      console.debug('[Shields] generic.css injection failed:', err);
    }

    // Get cosmetic resources from the WASM engine
    const resources = getCosmeticResources(url);
    if (!resources) return;

    // Inject hide selectors as CSS
    if (resources.hide_selectors.length > 0) {
      const css = resources.hide_selectors
        .map((s) => `${s} { display: none !important; }`)
        .join('\n');

      try {
        await chrome.scripting.insertCSS({
          target: { tabId, frameIds: [frameId] },
          css,
          origin: 'USER',
        });
      } catch (err) {
        // Tab may have been closed or navigated away
        console.debug('[Shields] CSS injection failed:', err);
      }
    }

    // Inject scriptlets if available
    if (resources.injected_script) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frameId] },
          func: (scriptContent: string) => {
            const script = document.createElement('script');
            script.textContent = scriptContent;
            (document.head || document.documentElement).appendChild(script);
            script.remove();
          },
          args: [resources.injected_script],
          world: 'MAIN' as chrome.scripting.ExecutionWorld,
        });
      } catch (err) {
        console.debug('[Shields] Scriptlet injection failed:', err);
      }
    }
  });
}
