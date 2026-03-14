import * as fs from 'fs';
import * as path from 'path';

/**
 * Transforms the wasm-pack ES module glue into a classic script
 * that can be loaded via importScripts() in a service worker.
 */

const WASM_DIR = path.resolve(__dirname, '..', 'dist', 'wasm');
const glueFile = path.join(WASM_DIR, 'adblock_engine.js');
const outFile = path.join(WASM_DIR, 'adblock_engine_sw.js');

if (!fs.existsSync(glueFile)) {
  console.error('WASM glue not found. Run build:wasm first.');
  process.exit(1);
}

let code = fs.readFileSync(glueFile, 'utf-8');

// Remove ES module export statements
code = code.replace(/^export class /gm, 'class ');
code = code.replace(/^export function /gm, 'function ');
code = code.replace(/^export \{[^}]*\};?\s*$/gm, '');

// Replace import.meta.url (not available in classic scripts)
code = code.replace(
  /new URL\('adblock_engine_bg\.wasm',\s*import\.meta\.url\)/g,
  'undefined'
);

// Expose classes on self for the service worker to access
code += `
// Exposed for service worker access
self.__adblock_wasm = { WasmEngine, initSync };
`;

fs.writeFileSync(outFile, code);
console.log(`Created service-worker-compatible glue: ${outFile}`);
