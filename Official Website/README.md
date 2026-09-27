# Novaris Browser — official website

A static site. No build step, no framework, no third-party requests, no analytics.
Open `index.html` and it works, or upload the folder to any static host.

```
Official Website/
├── index.html          Home
├── download.html       Download page
├── css/styles.css      One stylesheet
├── js/main.js          One script
└── assets/
    ├── logo.svg        The Novaris mark, drawn as geometry
    ├── hero.svg        Vector stand-in for the artwork
    └── hero.jpg        ← put your photograph here
```

## Using your own background image

The site looks for `assets/hero.jpg`. Save your image there and it is used
automatically, with no code change. The file in `assets/hero.svg` is only a
stand-in so the page is never an empty rectangle before you add it, and it
deliberately leaves the centre clear and the horizon low so the wordmark and the
call to action sit comfortably over the real artwork.

Recommended: 2400 × 1080 or wider, JPEG, under 400 KB. The background is covered
and centre-cropped, so a wider image survives more screen sizes.

## The download link

`js/main.js` points at `https://updates.yladevs.com`. It reads `latest.yml` from
that address on load and fills in the version, size, SHA-512 and the button's
target, so the page always describes the build that is actually published.

Two things to know:

- **The bucket needs CORS enabled** for the feed to be readable by a browser. In
  the R2 bucket settings, add a CORS policy allowing `GET` on `latest.yml` from
  `https://your-domain.example`. Without it the browser blocks the read, and the
  page says "feed not confirmed" rather than showing numbers it cannot verify.
  That fallback is deliberate: a download page should never claim a hash it did
  not read.
- **The installer must actually be uploaded.** Until
  `Novaris-Browser-0.7.5-Setup.exe` is in the bucket, the button points at a file
  that is not there yet.

## Publishing

Any static host works. On Cloudflare, either Pages or R2 with a public bucket:

- **Pages** — create a project, upload the folder, done.
- **R2 + custom domain** — upload the files to the bucket root and attach
  `novaris.com` as a custom domain.

The site and the update feed are separate. The site is static files; the feed
lives in the `novaris-updates` bucket and is what the browser app checks.

## Editing content

Everything a visitor reads is in `index.html`. The sections are:

| Section | What it is for |
| --- | --- |
| Hero | Wordmark, one-line promise, download button |
| Ready when you are | The download invitation, in the familiar shape |
| Features | One card per capability |
| Security | The measurements, with how they were taken |
| Updates | Current version and the changes in it |
| **Limits** | What Novaris cannot do |
| FAQ | The questions people actually ask |
| Download | Size, platform, hash |

## On the Limits section

It is the one most worth keeping. A privacy browser that lists only its wins is
undercut the moment a user finds the gap themselves, and the WebRTC disclosure
limit in particular is something any technically curious person will discover
within a week. Stating it, with the reason, is the difference between a claim and
a product description.
