#!/bin/bash
set -e
cd "$(dirname "$0")"
wasm-pack build --target web --out-dir ../dist/wasm -- --features "css-validation"
echo "WASM build complete"
