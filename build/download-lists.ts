import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

interface FilterListConfig {
  id: string;
  name: string;
  url: string;
}

const FILTER_LISTS: FilterListConfig[] = [
  {
    id: 'easylist',
    name: 'EasyList',
    url: 'https://easylist.to/easylist/easylist.txt',
  },
  {
    id: 'easyprivacy',
    name: 'EasyPrivacy',
    url: 'https://easylist.to/easylist/easyprivacy.txt',
  },
  {
    id: 'ublock-filters',
    name: 'uBlock Filters',
    url: 'https://ublockorigin.github.io/uAssets/filters/filters.txt',
  },
  {
    id: 'peter-lowe',
    name: "Peter Lowe's List",
    url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0',
  },
];

const LISTS_DIR = path.resolve(__dirname, '..', 'lists');
const METADATA_FILE = path.join(LISTS_DIR, 'metadata.json');

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main(): Promise<void> {
  if (!fs.existsSync(LISTS_DIR)) {
    fs.mkdirSync(LISTS_DIR, { recursive: true });
  }

  const metadata: Record<string, { id: string; downloadedAt: string; size: number }> = {};

  for (const list of FILTER_LISTS) {
    console.log(`Downloading ${list.name}...`);
    try {
      const content = await fetchUrl(list.url);
      const filePath = path.join(LISTS_DIR, `${list.id}.txt`);
      fs.writeFileSync(filePath, content, 'utf-8');
      metadata[list.id] = {
        id: list.id,
        downloadedAt: new Date().toISOString(),
        size: content.length,
      };
      console.log(`  -> ${list.id}.txt (${(content.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error(`  -> FAILED: ${err}`);
    }
  }

  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
  console.log('\nDone. Metadata saved to lists/metadata.json');
}

main().catch(console.error);
