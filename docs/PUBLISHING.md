Publish to Cloudflare R2
========================

The installers are served from R2 behind https://updates.yladevs.com, and both the
website and the in-app updater read the manifests from there. Nothing is published
until this is run, which is why an old build can sit in the bucket for a long time
while a newer one exists on disk.

One-time setup
--------------

    npx wrangler login
    $env:R2_BUCKET = "your-bucket-name"

`wrangler login` opens a browser and stores the token in your user profile, so no
secret is ever written into this repository or pasted into a chat.

Publishing
----------

    npm run publish:check      # verify the artifacts, upload nothing
    npm run publish            # verify, upload, then read every object back

The check is not a formality. `npm run publish:check` recomputes the SHA-512 of
each installer and compares it with the value in the manifest, and refuses to go
further on a mismatch, a missing file, or a manifest built for a different version
than `package.json`. The updater trusts that hash, so publishing a file that
disagrees with it means every user silently stops being able to update.

After uploading, every object is fetched back from the public URL and compared to
the local file. A 200 response that serves the wrong bytes is still a failure.

Files published per release
---------------------------

    latest.yml                                Windows update manifest
    Novaris-Browser-<version>-Setup.exe       Windows installer
    Novaris-Browser-<version>-Setup.exe.blockmap
    latest-linux.yml                          Linux update manifest
    Novaris-Browser-<version>-Linux.deb       Debian/Ubuntu package

Cache headers matter here. The manifests are sent `no-cache, no-store,
must-revalidate`, because a cached manifest is a stale manifest and the effect is
that users are told they are already up to date when they are not. The installers
are immutable, because their names contain the version and never change content.

CORS
----

The publisher sets a bucket CORS policy so the website can read the manifests
cross-origin. If you manage the bucket by hand, the origins that need access are
listed in `scripts/publish-release.mjs`. Without it, the website cannot show the
published version and the in-app updater cannot check for one.

Linux builds
------------

A Linux package must be produced on Linux; electron-builder cannot cross-compile
one from Windows. Use WSL:

    wsl -d Ubuntu -- bash ~/novaris-scripts/build-linux.sh

Then copy the artifacts back into `release/`, and `npm run publish` will pick up
both platforms.
