// MAIN-world script can't read chrome.runtime, so we (un)register it
// based on per-host settings instead. Reload required to take effect.

import { getSiteSettings } from './storage';

const YOUTUBE_SCRIPT_ID = 'youtube-ad-blocker';
const YOUTUBE_HOSTS = ['www.youtube.com', 'm.youtube.com'];

export async function syncYouTubeScript(): Promise<void> {
  try {
    const enabledMatches: string[] = [];
    for (const host of YOUTUBE_HOSTS) {
      const settings = await getSiteSettings(host);
      if (settings.enabled) enabledMatches.push(`https://${host}/*`);
    }

    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [YOUTUBE_SCRIPT_ID],
    });
    const isRegistered = existing.length > 0;

    if (enabledMatches.length === 0) {
      if (isRegistered) {
        await chrome.scripting.unregisterContentScripts({
          ids: [YOUTUBE_SCRIPT_ID],
        });
      }
      return;
    }

    if (isRegistered) {
      await chrome.scripting.updateContentScripts([
        { id: YOUTUBE_SCRIPT_ID, matches: enabledMatches },
      ]);
    } else {
      await chrome.scripting.registerContentScripts([
        {
          id: YOUTUBE_SCRIPT_ID,
          matches: enabledMatches,
          js: ['youtube-ad-blocker.js'],
          runAt: 'document_start',
          world: 'MAIN' as chrome.scripting.ExecutionWorld,
          allFrames: true,
          persistAcrossSessions: true,
        },
      ]);
    }
  } catch (err) {
    console.error('[Shields] syncYouTubeScript failed:', err);
  }
}
