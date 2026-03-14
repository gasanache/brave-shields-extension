// Content script: observes DOM mutations and requests cosmetic selectors from the service worker

const BATCH_DELAY_MS = 100;
const seenClasses = new Set<string>();
const seenIds = new Set<string>();
const appliedSelectors = new Set<string>();
let pendingClasses = new Set<string>();
let pendingIds = new Set<string>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let styleElement: HTMLStyleElement | null = null;

function getStyleElement(): HTMLStyleElement {
  if (!styleElement || !styleElement.parentNode) {
    styleElement = document.createElement('style');
    styleElement.id = 'brave-shields-cosmetic';
    (document.head || document.documentElement).appendChild(styleElement);
  }
  return styleElement;
}

function collectClassesAndIds(node: Element): void {
  if (node.classList) {
    for (const cls of node.classList) {
      if (!seenClasses.has(cls)) {
        seenClasses.add(cls);
        pendingClasses.add(cls);
      }
    }
  }
  if (node.id && !seenIds.has(node.id)) {
    seenIds.add(node.id);
    pendingIds.add(node.id);
  }

  // Also scan children
  const children = node.querySelectorAll('[class],[id]');
  for (const child of children) {
    if (child.classList) {
      for (const cls of child.classList) {
        if (!seenClasses.has(cls)) {
          seenClasses.add(cls);
          pendingClasses.add(cls);
        }
      }
    }
    if (child.id && !seenIds.has(child.id)) {
      seenIds.add(child.id);
      pendingIds.add(child.id);
    }
  }
}

async function flushPending(): Promise<void> {
  batchTimer = null;

  if (pendingClasses.size === 0 && pendingIds.size === 0) return;

  const classes = [...pendingClasses];
  const ids = [...pendingIds];
  pendingClasses = new Set();
  pendingIds = new Set();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_HIDDEN_SELECTORS',
      classes,
      ids,
      exceptions: [],
    });

    if (response?.selectors?.length > 0) {
      // Deduplicate to prevent unbounded style growth on SPAs
      const newSelectors = response.selectors.filter((s: string) => !appliedSelectors.has(s));
      if (newSelectors.length > 0) {
        for (const s of newSelectors) appliedSelectors.add(s);
        const style = getStyleElement();
        const css = newSelectors
          .map((s: string) => `${s} { display: none !important; }`)
          .join('\n');
        style.textContent += '\n' + css;
      }
    }
  } catch {
    // Service worker may not be ready yet
  }
}

function scheduleBatch(): void {
  if (batchTimer) return;
  batchTimer = setTimeout(flushPending, BATCH_DELAY_MS);
}

// Observe DOM mutations
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof Element) {
        collectClassesAndIds(node);
      }
    }
  }

  if (pendingClasses.size > 0 || pendingIds.size > 0) {
    scheduleBatch();
  }
});

// Relay ad-blocked messages from MAIN world scripts to service worker
window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.type !== '__SHIELDS_AD_BLOCKED__') return;
  try {
    chrome.runtime.sendMessage({
      type: 'SITE_AD_BLOCKED',
      count: event.data.count || 1,
    });
  } catch {
    // Extension context invalidated
  }
});

// Start observing once document is ready
if (document.documentElement) {
  // Collect initial classes/ids
  collectClassesAndIds(document.documentElement);
  scheduleBatch();

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    collectClassesAndIds(document.documentElement);
    scheduleBatch();

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
}
