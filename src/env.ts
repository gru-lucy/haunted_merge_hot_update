/* eslint-disable no-process-env */
import path from 'path';

/******************************************************************************
  Settings, from config/.env.<NODE_ENV> (loaded by dotenv before this runs).
  A missing or malformed value stops the server at start, not on a phone's
  first request.
******************************************************************************/

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`${name} must be a port number, not "${raw}".`);
  }
  return value;
}

const env = {
  /** BackendConfig.ReleaseUpdatePort in the game. */
  port: integer('PORT', 5300),
  /** The folder holding android/<versionCode>/{manifest.json, manifest.sig, files/}. */
  root: path.resolve((process.env.UPDATE_ROOT ?? './www').trim()),
  /** The same certificate and key as the lobby: the game trusts the key by pin. */
  tlsCertFile: (process.env.TLS_CERT_FILE ?? '').trim(),
  tlsKeyFile: (process.env.TLS_KEY_FILE ?? '').trim(),
  /** The CA that signed the app's client certificate. Set it in production: only the app may download. */
  tlsClientCaFile: (process.env.TLS_CLIENT_CA_FILE ?? '').trim(),
};

if ((env.tlsCertFile === '') !== (env.tlsKeyFile === '')) {
  throw new Error('TLS needs both TLS_CERT_FILE and TLS_KEY_FILE.');
}

export default env;
