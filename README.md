# haunted_merge_update

Serves content hot updates to the release game over HTTPS, port 5300 by default, on the same machine and with the same TLS files as the lobby. The game asks here **before** it talks to the lobby.

The full design is in [docs/infrastructure/CONTENT_HOT_UPDATE.md](../../docs/infrastructure/CONTENT_HOT_UPDATE.md).

## Run

```bash
npm ci
cp config/.env.example config/.env.production    # then edit
npm run build
pm2 start npm --name hm-update -- start && pm2 save
```

Open TCP 5300 in the firewall. Check it from a PC with the client certificate:

```bash
curl -k --cert-type P12 --cert client.p12:<password> -I https://<ReleaseHost>:5300/android/<versionCode>/manifest.json
```

You should get 404 before anything is published and 200 after. Without `--cert`, the TLS handshake must fail.

## Publish

In Unity, run **Tools > Haunted Merge > Android > Publish Content Update**. Then copy `Builds/HotUpdate/android/<versionCode>/` into `UPDATE_ROOT/android/<versionCode>/`:

1. **`files/` first.**
2. **`manifest.json` and `manifest.sig` last.** The manifest is the switch: phones pick the update up on their next launch.

## Test

`npm run smoke` starts the server on a scratch folder and checks:
- the 404 / manifest / whole and resumed downloads;
- that nothing outside the allowed paths is served.
