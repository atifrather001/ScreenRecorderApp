// Copies the onnxruntime-web WebAssembly runtime next to the renderer so speech recognition works offline
// (by default it would be fetched from a CDN).
import { copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const src = join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist');
const dst = join(process.cwd(), 'src', 'renderer', 'public', 'ort');
mkdirSync(dst, { recursive: true });
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) copyFileSync(join(src, f), join(dst, f));
