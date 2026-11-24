// Speech-to-text in a worker with Whisper (ONNX, runs locally on WebGPU or WebAssembly).
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

type Msg =
  | { type: 'load'; model: string; ortBase: string }
  | { type: 'transcribe'; id: number; audio: Float32Array; language: string };

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loadedModel = '';

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

async function load(model: string, ortBase: string) {
  if (asr && loadedModel === model) return post({ type: 'ready', device: 'cached' });
  env.allowLocalModels = false;
  // The runtime files are served from file:// in the packaged app, which the Cache API can't store.
  (env as { useWasmCache?: boolean }).useWasmCache = false;
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
  if (onnx.wasm) onnx.wasm.wasmPaths = { mjs: `${ortBase}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${ortBase}ort-wasm-simd-threaded.asyncify.wasm` };
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const hasGpu = !!(gpu && (await gpu.requestAdapter().catch(() => null)));
  const progress = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === 'progress') post({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
  };
  try {
    asr = (await pipeline('automatic-speech-recognition', model, {
      device: hasGpu ? 'webgpu' : 'wasm',
      dtype: hasGpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
      progress_callback: progress,
    })) as AutomaticSpeechRecognitionPipeline;
  } catch (err) {
    if (!hasGpu) throw err;
    // Some GPUs fail to compile the model; WebAssembly always works.
    asr = (await pipeline('automatic-speech-recognition', model, { device: 'wasm', dtype: 'q8', progress_callback: progress })) as AutomaticSpeechRecognitionPipeline;
  }
  loadedModel = model;
  post({ type: 'ready', device: hasGpu ? 'webgpu' : 'wasm' });
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === 'load') await load(m.model, m.ortBase);
    else if (m.type === 'transcribe') {
      if (!asr) throw new Error('Speech model is not loaded');
      const out = (await asr(m.audio, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        language: m.language === 'auto' ? 'english' : m.language,
        task: 'transcribe',
      })) as { text: string; chunks?: { timestamp: [number, number | null]; text: string }[] };
      const dur = m.audio.length / 16000;
      const chunks = out.chunks?.length ? out.chunks : [{ timestamp: [0, dur] as [number, number], text: out.text }];
      post({
        type: 'result',
        id: m.id,
        segments: chunks.map((c) => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? dur, text: c.text })),
      });
    }
  } catch (err) {
    post({ type: 'error', id: 'id' in m ? m.id : undefined, message: (err as Error).message });
  }
};
