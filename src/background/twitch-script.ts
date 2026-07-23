// MAIN-world script can't read chrome.runtime, so we (un)register it
// based on per-host settings instead. Reload required to take effect.

import { getSiteSettings } from './storage';

const TWITCH_HOSTS = ['www.twitch.tv', 'm.twitch.tv', 'player.twitch.tv', 'clips.twitch.tv'];

// vaft (HLS ad swapping) has to run in MAIN so it can hook the page's Worker
// and fetch. The stream-display-ad blocker only injects CSS and reports the
// blocked count, so it stays in ISOLATED where chrome.runtime is available.
const TWITCH_SCRIPTS = [
  { id: 'twitch-ad-blocker', file: 'twitch-ad-blocker.js', world: 'MAIN' },
  { id: 'twitch-sda-blocker', file: 'twitch-sda-blocker.js', world: 'ISOLATED' },
] as const;

export async function syncTwitchScript(): Promise<void> {
  try {
    const enabledMatches: string[] = [];
    for (const host of TWITCH_HOSTS) {
      const settings = await getSiteSettings(host);
      if (settings.enabled) enabledMatches.push(`https://${host}/*`);
    }

    for (const { id, file, world } of TWITCH_SCRIPTS) {
      const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
      const isRegistered = existing.length > 0;

      if (enabledMatches.length === 0) {
        if (isRegistered) {
          await chrome.scripting.unregisterContentScripts({ ids: [id] });
        }
        continue;
      }

      if (isRegistered) {
        await chrome.scripting.updateContentScripts([{ id, matches: enabledMatches }]);
      } else {
        await chrome.scripting.registerContentScripts([
          {
            id,
            matches: enabledMatches,
            js: [file],
            runAt: 'document_start',
            world: world as chrome.scripting.ExecutionWorld,
            allFrames: true,
            persistAcrossSessions: true,
          },
        ]);
      }
    }
  } catch (err) {
    console.error('[Shields] syncTwitchScript failed:', err);
  }
}
