/* eslint-disable no-process-env */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

/******************************************************************************
  npm run smoke - starts the server on a scratch folder over plain HTTP and
  checks what the game relies on: 404 when nothing is published, the manifest,
  whole and resumed (Range) downloads, and that nothing outside the allowed
  paths can be fetched.
******************************************************************************/

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-update-smoke-'));
const body = crypto.randomBytes(300_000);
const sha = crypto.createHash('sha256').update(body).digest('hex');
fs.mkdirSync(path.join(root, 'android', '7', 'files'), { recursive: true });
fs.writeFileSync(path.join(root, 'android', '7', 'files', `${sha}.lzma`), body);
fs.writeFileSync(path.join(root, 'android', '7', 'manifest.json'), '{"versionCode":7}');
fs.writeFileSync(path.join(root, 'secret.txt'), 'nope');

process.env.PORT = '5399';
process.env.UPDATE_ROOT = root;
process.env.TLS_CERT_FILE = '';
process.env.TLS_KEY_FILE = '';
process.env.TLS_CLIENT_CA_FILE = '';

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  await import('../src/main');
  await new Promise((r) => setTimeout(r, 300));
  const base = 'http://127.0.0.1:5399';

  check((await fetch(`${base}/health`)).status === 200, 'health answers');
  check((await fetch(`${base}/android/8/manifest.json`)).status === 404, 'nothing published = 404');
  const manifest = await fetch(`${base}/android/7/manifest.json`);
  check(manifest.status === 200 && manifest.headers.get('cache-control') === 'no-store', 'manifest served, not cached');

  const whole = Buffer.from(await (await fetch(`${base}/android/7/files/${sha}.lzma`)).arrayBuffer());
  check(whole.equals(body), 'pack file served whole');

  const part = await fetch(`${base}/android/7/files/${sha}.lzma`, { headers: { Range: 'bytes=100000-' } });
  const rest = Buffer.from(await part.arrayBuffer());
  check(part.status === 206 && rest.equals(body.subarray(100000)), 'resumed download returns the rest (206)');
  check(
    (await fetch(`${base}/android/7/files/${sha}.lzma`, { headers: { Range: 'bytes=300000-' } })).status === 416,
    'range past the end = 416',
  );

  for (const bad of ['/secret.txt', '/android/7/../../secret.txt', '/android/7/files/x.dat', '/android/7/', '/']) {
    check((await fetch(`${base}${bad}`)).status === 404, `refuses ${bad}`);
  }
  check((await fetch(`${base}/android/7/manifest.json`, { method: 'POST' })).status === 405, 'refuses POST');

  fs.rmSync(root, { recursive: true, force: true });
  console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
