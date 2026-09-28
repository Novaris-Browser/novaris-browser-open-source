# Novaris updates

Novaris uses `electron-updater` with the `generic` provider. A manifest, an
installer, and a signature are all an update needs.

## What a user is protected by

Two independent questions, and they are not the same one.

**Who built this file?** The Authenticode signature on the installer. Novaris is
currently **unsigned**, so Windows shows "Unknown publisher". The build is
configured for signing and reads the certificate from `WIN_CSC_LINK` and
`WIN_CSC_KEY_PASSWORD`; the pipeline has been proved end to end with a throwaway
certificate. It takes a certificate, not more code.

**Who published it?** A signature over the manifest itself.

A code-signing certificate says nothing about the bucket. If the feed were
writable by anyone, or the response altered in transit, a correctly signed
installer would still be replaced by a different one, and the updater would
download it because the manifest said so.

So the manifest is signed with **Ed25519** and verified against a public key
bundled in the application, *before* the updater will act on it. A substituted URL
or hash is refused rather than downloaded.

- The signature covers the whole manifest, not a chosen subset of fields.
- A **missing** signature is a failure, not a pass. Treating its absence as
  acceptable would make the whole mechanism optional.
- Signatures are decoded strictly. Node's base64 decoder silently skips
  characters it does not recognise, so junk prepended to a signature decoded to
  the same bytes and verified. It cannot forge anything, but several texts were
  accepted for one manifest.
- The publisher refuses to upload an unsigned manifest, and says so in the dry
  run that people actually run first.

### The keys

```powershell
node scripts/create-update-key.mjs
```

The **public** half is written to `assets/update-public-key.pem` and is committed,
because the application has to verify with it. The **private** half is written to
`~/.novaris/update-signing-key.pem`, outside the repository, and must be backed up
somewhere you control. Anyone holding it could offer a malicious update to every
installation, so it is never in the project and the security workflow fails if one
is ever tracked.

Losing the private key is recoverable only by changing it, and existing
installations will then refuse new feeds until they are updated by hand. That is
the correct failure: refusing is safe, trusting is not.

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
   instead. It is rate-limited and not meant for production.
4. **CORS.** The website reads the manifests cross-origin to show the published
   version, and the in-app updater does the same. The publisher sets the policy
   itself, and the origins it allows are listed in `scripts/publish-release.mjs`.
   Without it the site silently falls back to built-in numbers that go stale.

## Publishing a release

1. Bump the version in `package.json`. This is required: an update is only offered
   when the feed version is **higher** than the installed one. Publishing the same
   version twice means nobody ever sees the update.
2. Build, on the platform you are packaging for:

   ```powershell
   npm run dist:win            # Windows
   npm run dist:linux          # Linux, from WSL
   ```

3. Sign the manifests, then check and publish:

   ```powershell
   npm run publish:check       # verify only, uploads nothing
   npm run publish             # sign, verify, upload, read back
   ```

   `npm run publish` runs the signing step itself. Running it directly uploads
   nothing without a valid signature, which is the point.

4. What goes to the **root** of the bucket, keeping exact names. They must be at
   the same level, because the manifest references the installer by bare filename.

   | File | Purpose |
   | --- | --- |
   | `latest.yml` | Windows manifest: version, filename, SHA-512, size, signature |
   | `latest-linux.yml` | Linux manifest. electron-updater reads a separate one per platform |
   | `Novaris-Browser-<version>-Setup.exe` | Windows installer |
   | `Novaris-Browser-<version>-Setup.exe.blockmap` | Differential download data |
   | `Novaris-Browser-<version>-Linux.deb` | Debian package |

   Older versioned files can stay in the bucket. Only the manifests decide what is
   current.

5. Verify in a browser:

   ```
   https://updates.yladevs.com/latest.yml
   ```

   It must return plain text starting with the signature comment, then
   `version: <your version>`. An XML error means the objects are not public. A 404
   means the filename or path is wrong.

6. Open Novaris → Settings → General → **Check for updates**. It reports the new
   version and its download size, and the state includes whether the manifest
   signature verified.

## What the publisher refuses to do

Each of these has bitten a real release, and each is a test:

- an installer whose SHA-512 disagrees with its manifest
- a manifest built for a different version than `package.json`
- a manifest that is not signed, or was edited after signing
- a file the manifest names that is not present
- reporting success without reading every object back from the public URL

Cache headers are part of the contract. The manifests are uploaded `no-store`,
because a cached manifest is a stale manifest and the effect is that users are
told they are up to date when they are not. The installers are immutable, because
their names contain the version and their content never changes.

## How a user experiences it

1. Novaris checks the channel once per launch. Nothing is fetched automatically.
2. If a newer build exists, a dialog appears with the version, the release notes,
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
