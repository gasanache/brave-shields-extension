// Wire a segmented-control container so clicks update the active button,
// slide the indicator pill, and notify the caller. The initial value is set
// with an inline `transition: none` + forced reflow so the pill lands in the
// right spot on first paint, regardless of any CSS race conditions with the
// `.loading` class. This is the bug-proof path: relying on the CSS rule alone
// produced a visible jump on popup reopen for non-default values.
function setupSegmented(
  el: HTMLElement,
  initialValue: string,
  onChange: (value: string) => void
): void {
  const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('.seg'));
  const indicator = el.querySelector<HTMLElement>('.seg-indicator')!;

  const positionIndicator = (animated: boolean) => {
    const active = el.querySelector<HTMLElement>('.seg.active');
    if (!active) return;
    if (!animated) {
      // Inline transition: none beats any cascade source. Force a reflow
      // before clearing it so the new width/transform are committed without
      // interpolation, then drop back to the CSS-defined transition.
      indicator.style.transition = 'none';
    }
    indicator.style.width = `${active.offsetWidth}px`;
    indicator.style.transform = `translateX(${active.offsetLeft}px)`;
    if (!animated) {
      // Reading offsetHeight forces layout/style recalc — flushes the no-transition write.
      void indicator.offsetHeight;
      indicator.style.transition = '';
    }
  };

  const setValue = (value: string, animated: boolean) => {
    buttons.forEach((b) => {
      const isActive = b.dataset.value === value;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
    el.dataset.value = value;
    positionIndicator(animated);
  };

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.value!;
      if (el.dataset.value === value) return;
      setValue(value, true);
      onChange(value);
    });
  });

  // Initial set: no animation. Bug-proofs against any prior state, CSS race,
  // or future change to the loading-class behavior.
  setValue(initialValue, false);
}

async function init(): Promise<void> {
  const shieldsToggle = document.getElementById('shieldsToggle') as HTMLInputElement;
  const hostnameEl = document.getElementById('hostname')!;
  const statusText = document.getElementById('statusText')!;
  const adsBlockedEl = document.getElementById('adsBlocked')!;
  const trackersBlockedEl = document.getElementById('trackersBlocked')!;
  const fingerprintBlockedEl = document.getElementById('fingerprintBlocked')!;
  const panel = document.querySelector('.shields-panel')!;
  const adBlockMode = document.getElementById('adBlockMode') as HTMLElement;
  const cookieBlocking = document.getElementById('cookieBlocking') as HTMLElement;

  // Get active tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    // Non-standard page (e.g., chrome://, about:) — show disabled state
    hostnameEl.textContent = '—';
    statusText.textContent = 'Not available on this page';
    shieldsToggle.checked = false;
    shieldsToggle.disabled = true;
    panel.classList.add('shields-disabled');
    panel.classList.remove('loading');
    return;
  }

  let hostname = '—';
  let isHttpPage = true;
  try {
    const url = new URL(tab.url);
    hostname = url.hostname;
    isHttpPage = url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    isHttpPage = false;
  }
  hostnameEl.textContent = hostname;

  if (!isHttpPage) {
    statusText.textContent = 'Not available on this page';
    shieldsToggle.checked = false;
    shieldsToggle.disabled = true;
    panel.classList.add('shields-disabled');
    panel.classList.remove('loading');
    return;
  }

  // Get current shields status — pass hostname so service worker reads persisted settings
  const state = await chrome.runtime.sendMessage({
    type: 'GET_SHIELDS_STATUS',
    tabId: tab.id,
    hostname,
  });

  // Update UI
  const updateUI = (enabled: boolean) => {
    shieldsToggle.checked = enabled;
    statusText.textContent = enabled ? 'Shields are UP' : 'Shields are DOWN';
    if (enabled) {
      panel.classList.remove('shields-disabled');
    } else {
      panel.classList.add('shields-disabled');
    }
  };

  updateUI(state?.enabled ?? true);
  adsBlockedEl.textContent = String(state?.adsBlocked ?? 0);
  trackersBlockedEl.textContent = String(state?.trackersBlocked ?? 0);
  fingerprintBlockedEl.textContent = String(state?.fingerprintBlocked ?? 0);

  // Wire segmented controls. Initial setValue runs while .loading is still on
  // the panel, so the CSS suppresses the slide animation for first paint.
  setupSegmented(adBlockMode, state?.adBlockMode ?? 'standard', async (value) => {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SITE_SETTING',
      hostname,
      key: 'adBlockMode',
      value,
    });
    if (tab.id) chrome.tabs.reload(tab.id);
  });

  setupSegmented(cookieBlocking, state?.cookieBlocking ?? 'cross-site', async (value) => {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SITE_SETTING',
      hostname,
      key: 'cookieBlocking',
      value,
    });
    if (tab.id) chrome.tabs.reload(tab.id);
  });

  // Incognito hint — only shown if the user hasn't already enabled the
  // per-install "Allow in InCognito" toggle and hasn't dismissed the hint.
  // Chrome offers no API to flip the toggle for the user; the best we can do
  // is open chrome://extensions/?id=<id> directly so it's a single click away.
  await setupIncognitoHint();

  // State is loaded — reveal the panel
  panel.classList.remove('loading');

  // Toggle handler
  shieldsToggle.addEventListener('change', async () => {
    const enabled = shieldsToggle.checked;
    updateUI(enabled);

    await chrome.runtime.sendMessage({
      type: 'TOGGLE_SHIELDS',
      tabId: tab.id,
      hostname,
      enabled,
    });

    // Reload the tab to apply changes
    if (tab.id) {
      chrome.tabs.reload(tab.id);
    }
  });
}

async function setupIncognitoHint(): Promise<void> {
  const hint = document.getElementById('incognitoHint') as HTMLElement | null;
  const action = document.getElementById('incognitoHintAction');
  const dismiss = document.getElementById('incognitoHintDismiss');
  if (!hint || !action || !dismiss) return;

  const STORAGE_KEY = 'incognitoHintDismissed';

  let allowed = false;
  try {
    allowed = await chrome.extension.isAllowedIncognitoAccess();
  } catch {
    // API unavailable — leave hint hidden rather than nag spuriously
    return;
  }
  if (allowed) return;

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY] === true) return;

  hint.hidden = false;

  action.addEventListener('click', () => {
    // chrome://extensions/?id=<id> opens straight to this extension's details
    // page, where the "Allow in InCognito" toggle lives. One click for the user.
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  });

  dismiss.addEventListener('click', () => {
    hint.hidden = true;
    chrome.storage.local.set({ [STORAGE_KEY]: true }).catch(() => {});
  });
}

document.addEventListener('DOMContentLoaded', init);
