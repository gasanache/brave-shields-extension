import { getCosmeticResources } from './engine';
import { getSiteSettings } from './storage';

export function setupCosmeticInjector(): void {
  chrome.webNavigation.onCommitted.addListener(async (details) => {
    const { tabId, url, frameId } = details;

    // Skip non-http(s) URLs
    if (!url.startsWith('http://') && !url.startsWith('https://')) return;

    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return;
    }

    // Check if shields are enabled for this site
    const settings = await getSiteSettings(hostname);
    if (!settings.enabled) return;

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
