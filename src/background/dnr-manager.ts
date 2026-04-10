import { FILTER_LISTS } from '../shared/filter-lists';
import { STORAGE_KEYS } from '../shared/constants';

interface FilterListMetadata {
  id: string;
  etag: string | null;
  lastUpdated: number;
}

export async function checkForUpdates(): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.FILTER_LIST_METADATA);
  const metadata: Record<string, FilterListMetadata> =
    result[STORAGE_KEYS.FILTER_LIST_METADATA] ?? {};

  for (const list of FILTER_LISTS) {
    if (!list.enabled) continue;

    const meta = metadata[list.id];
    const headers: HeadersInit = {};

    if (meta?.etag) {
      headers['If-None-Match'] = meta.etag;
    }

    try {
      const response = await fetch(list.url, { headers });
      if (response.status === 304) {
        console.log(`[Shields] ${list.name}: no updates`);
        continue;
      }

      if (!response.ok) {
        console.warn(`[Shields] Failed to fetch ${list.name}: ${response.status}`);
        continue;
      }

      const etag = response.headers.get('etag');
      metadata[list.id] = {
        id: list.id,
        etag,
        lastUpdated: Date.now(),
      };

      console.log(`[Shields] ${list.name}: updated`);
    } catch (err) {
      console.warn(`[Shields] Error checking ${list.name}:`, err);
    }
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.FILTER_LIST_METADATA]: metadata,
  });
}

