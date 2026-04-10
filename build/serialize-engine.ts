import * as fs from 'fs';
import * as path from 'path';

/**
 * Pre-serializes the adblock-rs engine with all filter rules.
 * The serialized .dat file is loaded at runtime by the WASM engine
 * for near-instant initialization.
 *
 * Requires: adblock-rs npm package (Node.js bindings)
 */

const LISTS_DIR = path.resolve(__dirname, '..', 'lists');
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const ENGINE_DAT = path.join(DATA_DIR, 'engine.dat');

async function main(): Promise<void> {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Collect all filter rules
  const lists = ['easylist', 'easyprivacy', 'ublock-filters', 'peter-lowe', 'ublock-privacy'];
  const allRules: string[] = [];

  for (const listId of lists) {
    const listPath = path.join(LISTS_DIR, `${listId}.txt`);
    if (!fs.existsSync(listPath)) {
      console.warn(`List not found: ${listPath}`);
      continue;
    }

    const content = fs.readFileSync(listPath, 'utf-8');
    const rules = content.split('\n').filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('!') && !trimmed.startsWith('[');
    });

    allRules.push(...rules);
    console.log(`${listId}: ${rules.length} rules`);
  }

  console.log(`\nTotal rules: ${allRules.length}`);

  try {
    // Try to use adblock-rs Node bindings for serialization
    const adblock = require('adblock-rs');
    const { FilterSet, Engine } = adblock;

    console.log('Building engine...');
    const filterSet = new FilterSet(false);
    filterSet.addFilters(allRules);

    const engine = new Engine(filterSet, true);

    console.log('Serializing...');
    const serialized = engine.serialize();
    const buffer = Buffer.from(serialized);

    fs.writeFileSync(ENGINE_DAT, buffer);
    console.log(`Engine serialized to ${ENGINE_DAT} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

    // Engine.dat is the source of truth — drop the runtime fallback so it doesn't ship in dist/
    const fallbackPath = path.join(DATA_DIR, 'filter-rules.txt');
    if (fs.existsSync(fallbackPath)) {
      fs.unlinkSync(fallbackPath);
      console.log(`Removed stale ${fallbackPath} (no longer needed)`);
    }
  } catch (err) {
    console.warn('adblock-rs Node bindings not available, creating placeholder engine.dat');
    console.warn('The WASM engine will build from filter rules at runtime instead.');
    console.warn(`Error: ${err}`);

    // Write a placeholder file — the service worker will fall back to
    // building the engine from filter list text at runtime
    const allRulesText = allRules.join('\n');
    fs.writeFileSync(
      path.join(DATA_DIR, 'filter-rules.txt'),
      allRulesText
    );
    console.log(`Filter rules saved to data/filter-rules.txt (${(allRulesText.length / 1024 / 1024).toFixed(2)} MB)`);

    // Create an empty engine.dat so the manifest doesn't error
    fs.writeFileSync(ENGINE_DAT, Buffer.alloc(0));
  }

  console.log('\nDone.');
}

main().catch(console.error);
