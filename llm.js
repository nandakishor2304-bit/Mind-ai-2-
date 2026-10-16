import * as FS from 'expo-file-system';
import { initLlama } from 'llama.rn';
import { FILES, CTX } from './config';

const DIR = FS.documentDirectory + 'ai/';
const P = { core: DIR + 'core.bin', vision: DIR + 'vision.bin' };
let ctx = null;

export async function isInstalled() {
  const a = await FS.getInfoAsync(P.core), b = await FS.getInfoAsync(P.vision);
  return a.exists && b.exists;
}

export async function install(onProgress) {
  await FS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  const keys = Object.keys(FILES);
  const total = keys.reduce((s, k) => s + FILES[k].approx, 0);
  let done = 0;
  for (const k of keys) {
    const info = await FS.getInfoAsync(P[k]);
    if (info.exists) { done += FILES[k].approx; continue; }
    await FS.deleteAsync(P[k] + '.part', { idempotent: true });
    const dl = FS.createDownloadResumable(FILES[k].url, P[k] + '.part', {}, (p) =>
      onProgress(Math.min(0.99, (done + p.totalBytesWritten) / total)));
    const res = await dl.downloadAsync();
    if (!res || res.status !== 200) throw new Error('Download failed. Check your connection and retry.');
    await FS.moveAsync({ from: P[k] + '.part', to: P[k] });
    done += FILES[k].approx;
  }
  onProgress(1);
}

export async function load() {
  if (ctx) return ctx;
  ctx = await initLlama({
    model: P.core, n_ctx: CTX, n_batch: 256, n_threads: 4,
    n_gpu_layers: 0, use_mlock: false,
  });
  await ctx.initMultimodal({ path: P.vision, use_gpu: false });
  return ctx;
}

export async function generate(messages, onToken) {
  const c = await load();
  const out = await c.completion({
    messages, n_predict: 1400, temperature: 0.5, top_p: 0.9, top_k: 40,
    penalty_repeat: 1.1, stop: ['<|im_end|>', '<|endoftext|>'],
  }, (d) => onToken(d.token));
  return out.text;
}

export async function stop() { if (ctx) await ctx.stopCompletion(); }
