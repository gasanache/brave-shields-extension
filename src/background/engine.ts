import { CosmeticResources } from '../shared/types';

declare const self: ServiceWorkerGlobalScope & {
  __adblock_wasm?: {
    WasmEngine: any;
    initSync: (opts: { module: WebAssembly.Module }) => void;
  };
  importScripts(...urls: string[]): void;
};

interface WasmEngineInstance {
  check_network_request(url: string, source_url: string, request_type: string): any;
  url_cosmetic_resources(url: string): any;
  hidden_class_id_selectors(classes: string[], ids: string[], exceptions: string[]): string[];
  serialize(): Uint8Array;
  use_resources(resources_json: string): void;
  free(): void;
}

let engineInstance: WasmEngineInstance | null = null;
let initPromise: Promise<void> | null = null;

export async function initEngine(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // 1. Load the pre-processed WASM glue (classic script, not ES module)
      const glueUrl = chrome.runtime.getURL('wasm/adblock_engine_sw.js');
      self.importScripts(glueUrl);

      const wasmExports = self.__adblock_wasm;
      if (!wasmExports) {
        throw new Error('WASM glue did not expose __adblock_wasm');
      }

      // 2. Fetch and compile WASM binary
      const wasmUrl = chrome.runtime.getURL('wasm/adblock_engine_bg.wasm');
      const wasmResponse = await fetch(wasmUrl);
      const wasmBytes = await wasmResponse.arrayBuffer();
      const wasmModule = new WebAssembly.Module(wasmBytes);

      // 3. Initialize WASM synchronously
      wasmExports.initSync({ module: wasmModule });
      const WasmEngine = wasmExports.WasmEngine;

      // 4. Try to load pre-serialized engine
      const datUrl = chrome.runtime.getURL('data/engine.dat');
      try {
        const response = await fetch(datUrl);
        if (response.ok) {
          const data = new Uint8Array(await response.arrayBuffer());
          if (data.length > 0) {
            engineInstance = WasmEngine.deserialize(data);
            console.log('[Shields] Engine loaded from serialized data');
            return;
          }
        }
      } catch {
        // engine.dat not available
      }

      // 5. Fallback: load raw filter rules
      try {
        const rulesUrl = chrome.runtime.getURL('data/filter-rules.txt');
        const rulesResponse = await fetch(rulesUrl);
        if (rulesResponse.ok) {
          const rulesText = await rulesResponse.text();
          engineInstance = new WasmEngine(rulesText);
          console.log(
            `[Shields] Engine built from ${rulesText.split('\n').length} filter rules`
          );
          return;
        }
      } catch {
        // filter-rules.txt not available
      }

      // 6. Last fallback: empty engine
      engineInstance = new WasmEngine('');
      console.log('[Shields] Engine initialized (empty)');
    } catch (err) {
      console.error('[Shields] Failed to initialize engine:', err);
      // Clear so next call retries instead of returning the rejected promise
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

export function getEngine(): WasmEngineInstance | null {
  return engineInstance;
}

export function getCosmeticResources(url: string): CosmeticResources | null {
  if (!engineInstance) return null;
  try {
    const result = engineInstance.url_cosmetic_resources(url);
    return {
      hide_selectors: Array.from(result.hide_selectors || []),
      injected_script: result.injected_script || null,
      generichide: result.generichide || false,
    };
  } catch (err) {
    console.error('[Shields] Cosmetic resources error:', err);
    return null;
  }
}

export function getHiddenSelectors(
  classes: string[],
  ids: string[],
  exceptions: string[]
): string[] {
  if (!engineInstance) return [];
  try {
    return engineInstance.hidden_class_id_selectors(classes, ids, exceptions);
  } catch (err) {
    console.error('[Shields] Hidden selectors error:', err);
    return [];
  }
}

export function checkNetworkRequest(
  url: string,
  sourceUrl: string,
  requestType: string
): { matched: boolean; redirect?: string; exception?: string } | null {
  if (!engineInstance) return null;
  try {
    return engineInstance.check_network_request(url, sourceUrl, requestType);
  } catch {
    return null;
  }
}
