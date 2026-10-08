import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';

import env from './env';

/******************************************************************************
  Haunted Merge content update server.

  A release build asks here, before it talks to the lobby, whether its content
  has changed, and downloads the packs that did. This only serves files: the
  editor's Publish Content Update writes them and someone copies them into
  UPDATE_ROOT - pack files first, manifest.json + manifest.sig last.

    GET /android/<versionCode>/manifest.json   (404 = nothing published: the OBB is current)
    GET /android/<versionCode>/manifest.sig
    GET /android/<versionCode>/files/<sha256>.(dat|lzma)   (Range supported, for resuming)
    GET /health

  Nothing else exists: no listing, no other paths, so nothing outside the
  folder can be reached. TLS is the lobby's - same certificate, so the game's
  key pin holds, and the same client-certificate check, so only the app can
  download. See docs/infrastructure/CONTENT_HOT_UPDATE.md.
******************************************************************************/

const ALLOWED = /^\/android\/\d{1,9}\/(manifest\.json|manifest\.sig|files\/[0-9a-f]{64}\.(dat|lzma))$/;

function handler(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = (req.url ?? '/').split('?')[0];

  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (!ALLOWED.test(url)) {
    res.writeHead(404).end();
    return;
  }

  const file = path.join(env.root, url);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404).end();
      return;
    }

    // The manifest changes with every publish; a hashed file never does.
    const mutable = url.includes('/manifest.');
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': mutable ? 'no-store' : 'public, max-age=31536000, immutable',
    };

    // Resume: the phone sends "Range: bytes=<what it already has>-".
    let start = 0;
    let status = 200;
    const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
    if (range) {
      start = Number(range[1]);
      if (start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end();
        return;
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${st.size - 1}/${st.size}`;
    }
    headers['Content-Length'] = String(st.size - start);

    res.writeHead(status, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(file, { start });
    stream.on('error', () => res.destroy());
    req.on('close', () => stream.destroy());
    stream.pipe(res);
  });
}

/** HTTPS when TLS_CERT_FILE and TLS_KEY_FILE are set (read once; a new certificate takes a restart), else HTTP. */
function createServer(): http.Server {
  if (env.tlsCertFile === '') {
    return http.createServer(handler);
  }
  const clientAuth: https.ServerOptions =
    env.tlsClientCaFile === ''
      ? {}
      : { ca: fs.readFileSync(env.tlsClientCaFile), requestCert: true, rejectUnauthorized: true };
  return https.createServer(
    { cert: fs.readFileSync(env.tlsCertFile), key: fs.readFileSync(env.tlsKeyFile), ...clientAuth },
    handler,
  );
}

const server = createServer();
// Phones on poor Wi-Fi: a slow download is fine, a stalled one is dropped and resumed by the phone.
server.requestTimeout = 0;
server.headersTimeout = 30_000;
server.keepAliveTimeout = 30_000;
server.timeout = 120_000;

if (!fs.existsSync(env.root)) {
  fs.mkdirSync(path.join(env.root, 'android'), { recursive: true });
}

server.listen(env.port, () => {
  const scheme = server instanceof https.Server ? 'https' : 'http';
  const client = env.tlsClientCaFile === '' ? 'no client certificate required' : 'client certificate required';
  console.log(`[update] serving ${env.root} on ${scheme}://0.0.0.0:${env.port} (${client})`);
  if (scheme === 'http') {
    console.warn('[update] plain HTTP: release builds only speak HTTPS. Set TLS_CERT_FILE / TLS_KEY_FILE.');
  }
});

function shutdown(): void {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
