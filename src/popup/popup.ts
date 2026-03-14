async function init(): Promise<void> {
  const shieldsToggle = document.getElementById('shieldsToggle') as HTMLInputElement;
  const hostnameEl = document.getElementById('hostname')!;
  const statusText = document.getElementById('statusText')!;
  const adsBlockedEl = document.getElementById('adsBlocked')!;
  const trackersBlockedEl = document.getElementById('trackersBlocked')!;
  const fingerprintBlockedEl = document.getElementById('fingerprintBlocked')!;
  const panel = document.querySelector('.shields-panel')!;
  const adBlockMode = document.getElementById('adBlockMode') as HTMLSelectElement;
  const cookieBlocking = document.getElementById('cookieBlocking') as HTMLSelectElement;

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

  // Load persisted settings for dropdowns
  if (state?.adBlockMode) adBlockMode.value = state.adBlockMode;
  if (state?.cookieBlocking) cookieBlocking.value = state.cookieBlocking;

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

  // Ad blocking mode handler
  adBlockMode.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SITE_SETTING',
      hostname,
      key: 'adBlockMode',
      value: adBlockMode.value,
    });
    if (tab.id) chrome.tabs.reload(tab.id);
  });

  // Cookie blocking handler
  cookieBlocking.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SITE_SETTING',
      hostname,
      key: 'cookieBlocking',
      value: cookieBlocking.value,
    });
    if (tab.id) chrome.tabs.reload(tab.id);
  });
}

document.addEventListener('DOMContentLoaded', init);
