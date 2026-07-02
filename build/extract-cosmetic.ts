import * as fs from 'fs';
import * as path from 'path';

/**
 * Extracts generic cosmetic (element-hiding) rules from the ABP filter lists
 * into a single generic.css. Site-specific hiding is handled at runtime by the
 * WASM engine (url_cosmetic_resources), so only the generic layer is emitted here.
 *
 * Element hiding uses ## syntax: `domain##selector` (specific) or `##selector`
 * (generic). Exceptions (#@#) and extended selectors (#?#, #$#) are skipped.
 */

const LISTS_DIR = path.resolve(__dirname, '..', 'lists');
const COSMETIC_DIR = path.resolve(__dirname, '..', 'cosmetic');
const MAX_GENERIC = 2000;

function parseGenericSelector(line: string): string | null {
  line = line.trim();
  if (!line || line.startsWith('!') || line.startsWith('[')) return null;
  // Skip extended selectors and exceptions.
  if (line.includes('#?#') || line.includes('#$#') || line.includes('#@$#') || line.includes('#@#')) {
    return null;
  }
  const idx = line.indexOf('##');
  if (idx === -1) return null;
  // Generic rules have no domain part before ##.
  if (idx !== 0) return null;
  const selector = line.substring(2).trim();
  return selector || null;
}

function main(): void {
  if (!fs.existsSync(COSMETIC_DIR)) {
    fs.mkdirSync(COSMETIC_DIR, { recursive: true });
  }

  const lists = ['easylist', 'easyprivacy', 'ublock-filters', 'peter-lowe', 'ublock-privacy'];
  const genericSelectors = new Set<string>();

  for (const listId of lists) {
    const listPath = path.join(LISTS_DIR, `${listId}.txt`);
    if (!fs.existsSync(listPath)) {
      console.warn(`List not found: ${listPath}`);
      continue;
    }

    let count = 0;
    for (const line of fs.readFileSync(listPath, 'utf-8').split('\n')) {
      const selector = parseGenericSelector(line);
      if (selector) {
        genericSelectors.add(selector);
        count++;
      }
    }
    console.log(`${listId}: ${count} generic cosmetic rules`);
  }

  const genericArr = [...genericSelectors];
  const genericCss = genericArr
    .slice(0, MAX_GENERIC)
    .map((s) => `${s} { display: none !important; }`)
    .join('\n');
  fs.writeFileSync(path.join(COSMETIC_DIR, 'generic.css'), genericCss);
  console.log(`\nGeneric selectors: ${genericArr.length} (using ${Math.min(genericArr.length, MAX_GENERIC)})`);
  console.log('Done.');
}

main();
