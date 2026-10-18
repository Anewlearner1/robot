// Offline render + level check for the audio module, run in headless Chromium.
//
//   node src/audio/tools/render-check.mjs [outDir]
//
// Bundles src/audio/offline.ts with esbuild (a Vite dependency), renders the music and every SFX
// in an OfflineAudioContext, prints peak / RMS, fails on clipping or silence and writes WAVs.
// Needs the `playwright` package (resolved from node_modules or the global install) and a
// Chromium at CHROMIUM_PATH (default: /opt/pw-browsers/chromium-1194/chrome-linux/chrome).
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const outDir = resolve(process.argv[2] ?? join(root, 'audio-render'));
const chromium_path = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(outDir, { recursive: true });

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const globalRoot = execSync('npm root -g').toString().trim();
    return require(join(globalRoot, 'playwright'));
  }
}
const { chromium } = loadPlaywright();
const { build } = await import(require.resolve('esbuild', { paths: [root] }));

const bundle = await build({
  entryPoints: [join(root, 'src/audio/offline.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'AudioOffline',
  write: false,
  target: 'es2020',
});
const script = bundle.outputFiles[0].text;

function wav(pcmBase64, sampleRate, channels) {
  const pcm = Buffer.from(pcmBase64, 'base64');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const browser = await chromium.launch({ executablePath: chromium_path, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR', e));
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: script });

let failed = false;
const check = (label, s, minRms) => {
  const db = (x) => (20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);
  const ok = s.peak < 1.0 && s.rms > minRms;
  if (!ok) failed = true;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(18)} peak ${s.peak.toFixed(3)} (${db(s.peak)} dBFS)  rms ${s.rms.toFixed(4)} (${db(s.rms)} dBFS)  ${s.seconds.toFixed(2)}s`,
  );
};

// 30 s sample at the default volume, with a WAV.
const music = await page.evaluate(async () => {
  const api = AudioOffline.offlineApi;
  const audio = await api.renderMusic(30);
  return { stats: api.measure(audio), pcm: api.toPcm16Base64(audio), sampleRate: audio.sampleRate };
});
writeFileSync(join(outDir, 'bgm-sample.wav'), wav(music.pcm, music.sampleRate, 2));
check('bgm 30s (default)', music.stats, 0.01);

// Full loop plus a second, varied loop (also exercises the loop boundary), max volume.
for (const [label, seconds, volume] of [['bgm 2 loops vol1.0', 215, 1.0]]) {
  const stats = await page.evaluate(
    async ([s, v]) => {
      const api = AudioOffline.offlineApi;
      return api.measure(await api.renderMusic(s, v));
    },
    [seconds, volume],
  );
  check(label, stats, 0.01);
}

// Every SFX at default and maximum volume.
const names = await page.evaluate(() => [...AudioOffline.offlineApi.SFX_NAMES]);
for (const name of names) {
  const r = await page.evaluate(async (n) => {
    const api = AudioOffline.offlineApi;
    const audio = await api.renderSfx(n);
    return { stats: api.measure(audio), pcm: api.toPcm16Base64(audio), sampleRate: audio.sampleRate };
  }, name);
  writeFileSync(join(outDir, `sfx-${name}.wav`), wav(r.pcm, r.sampleRate, 2));
  check(`sfx ${name}`, r.stats, 0.001);
  const max = await page.evaluate(async (n) => {
    const api = AudioOffline.offlineApi;
    return api.measure(await api.renderSfx(n, 1));
  }, name);
  check(`sfx ${name} @1.0`, max, 0.001);
}

await browser.close();
console.log(`WAVs written to ${outDir}`);
process.exit(failed ? 1 : 0);
