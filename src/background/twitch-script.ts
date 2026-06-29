// MAIN-world script can't read chrome.runtime, so we (un)register it
// based on per-host settings instead. Reload required to take effect.

import { getSiteSettings } from './storage';

const TWITCH_SCRIPT_ID = 'twitch-ad-blocker';
const TWITCH_HOSTS = ['www.twitch.tv', 'm.twitch.tv', 'player.twitch.tv', 'clips.twitch.tv'];

export async function syncTwitchScript(): Promise<void> {
  try {
    const enabledMatches: string[] = [];
    for (const host of TWITCH_HOSTS) {
      const settings = await getSiteSettings(host);
      if (settings.enabled) enabledMatches.push(`https://${host}/*`);
    }

    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [TWITCH_SCRIPT_ID],
    });
    const isRegistered = existing.length > 0;

    if (enabledMatches.length === 0) {
      if (isRegistered) {
        await chrome.scripting.unregisterContentScripts({
          ids: [TWITCH_SCRIPT_ID],
        });
      }
      return;
    }

    if (isRegistered) {
      await chrome.scripting.updateContentScripts([
        { id: TWITCH_SCRIPT_ID, matches: enabledMatches },
      ]);
    } else {
      await chrome.scripting.registerContentScripts([
        {
          id: TWITCH_SCRIPT_ID,
          matches: enabledMatches,
          js: ['twitch-ad-blocker.js'],
          runAt: 'document_start',
          world: 'MAIN' as chrome.scripting.ExecutionWorld,
          allFrames: true,
          persistAcrossSessions: true,
        },
      ]);
    }
  } catch (err) {
    console.error('[Shields] syncTwitchScript failed:', err);
  }
}
