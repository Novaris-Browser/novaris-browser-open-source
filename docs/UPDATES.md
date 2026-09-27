# Publishing a Novaris update

Novaris uses `electron-updater` with the `generic` provider. Three files at one
URL are all an update needs.

## The channel URL

The URL is defined once, in `package.json`:

```json
"build": { "publish": { "provider": "generic", "url": "https://updates.yladevs.com" } }
```

A build step copies that into `assets/update-channel.json`, which is the file the
running application reads. The packaged `package.json` cannot be used for this,
because electron-builder prunes the `build` section out of it.

The `NOVARIS_UPDATE_FEED` environment variable overrides the bundled value. It is
only for testing a build against a staging channel; end users never set it.

## One-time Cloudflare setup

1. Cloudflare dashboard, then **R2 → Create bucket**, for example `novaris-updates`.
2. Bucket **Settings → Public access → Connect to domain**, and attach
   `updates.yladevs.com`. Cloudflare issues the certificate automatically, so the
   feed is served over HTTPS.
3. For a quick test without touching DNS, use the `r2.dev` URL Cloudflare shows
   instead and give it to us. It is rate-limited and not meant for production.

## Publishing a release

1. Bump the version in `package.json`. This is required: an update is only offered
   when the feed version is **higher** than the installed one. Publishing the same
   version twice means nobody ever sees the update.
2. Build:

   ```powershell
   npm run dist:win
   ```

3. Upload these three files from `release/` to the **root** of the bucket, keeping
   their exact names. They must be at the same level, because `latest.yml`
   references the installer by bare filename.

   | File | Purpose |
   | --- | --- |
   | `latest.yml` | The manifest: version, filename, SHA-512, and size |
   | `Novaris-Browser-<version>-Setup.exe` | The installer |
   | `Novaris-Browser-<version>-Setup.exe.blockmap` | Differential download data |

   Older versioned files can stay in the bucket. Only `latest.yml` decides what
   is current.

4. Verify in a browser:

   ```
   https://updates.yladevs.com/latest.yml
   ```

   It must return plain text starting with `version: <your version>`. An XML error
   means the objects are not public. A 404 means the filename or path is wrong.

5. Open Novaris → Settings → General → **Check for updates**. It should report the
   new version and its download size, taken from the `size` field in `latest.yml`.

## How a user experiences it

1. Novaris checks the channel once per launch. Nothing is fetched automatically.
2. If a newer build exists, a dialog appears with the version, the release notes,
   and the download size. Nothing downloads until **Download update** is pressed.
   `autoDownload` and `autoInstallOnAppQuit` are both off.
3. After the download finishes, **Restart and start fresh** installs it. That
   performs a full profile reset, so the user is shown what happened, what was
   deleted, and what is new, and first-run setup runs again.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| "No update channel is configured" | `assets/update-channel.json` is missing or empty. Run `npm run build` to regenerate it. |
| `net::ERR_NAME_NOT_RESOLVED` | The domain has no DNS record yet. |
| `net::ERR_SSL_UNRECOGNIZED_NAME_ALERT` | The hostname has no certificate. Connect the R2 domain properly rather than pointing DNS manually. |
| "You are running the latest version" with a newer build published | The version was not bumped, or the browser cached an old `latest.yml`. |
| 404 on the installer but not on `latest.yml` | The filename does not match the `url` field inside `latest.yml`. |
