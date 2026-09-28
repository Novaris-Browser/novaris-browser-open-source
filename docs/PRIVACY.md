# Privacy

## What was measured

The claims on the website come from a Chromium network log of a real session
visiting three sites, not from documentation.

**Recorded:** 39 requests, to exactly 3 hosts, all of them page content. No
telemetry, no Safe Browsing, no component updater, no autofill upload.

Third-party cookie partitioning was already on by default, so it is a platform
default rather than something Novaris configured. It is listed because being
explicit about which protections are yours and which are Chromium's matters.

## What leaves the device

Nothing, from the application.

- No telemetry, no analytics, no usage reporting
- No crash reporting. There is no upload path in the code
- No Safe Browsing, no component update check, no autofill upload
- Phishing detection is evaluated on the device
- Tab transfer goes directly to another device on the local network, encrypted
  with AES-256-GCM before it moves, and only local addresses can be reached
- There is no account, and therefore no sign-in, no sync and no server

The one network destination the application ever contacts is the update feed, to
ask whether a newer release exists. Nothing about the sites you visit is in that
request.

## What is stored

In the user-data directory, and nowhere else.

| | |
|---|---|
| Bookmarks, history, reading list, downloads | plain, in the profile store |
| Cookies and site data | in the Chromium profile, partition `persist:novaris` |
| Settings | plain, in the profile store |
| Saved credentials | sealed, see below |
| Saved pages | a text and markup snapshot, no script, and sign-in pages are refused |
| Extensions | unpacked on disk, only from the user |

There is a local metadata backup. It contains settings and counts, not content.

## Credentials

Sealed with AES-256-GCM under a key derived from your master password with
Argon2id. Each record is sealed separately, with the record id bound in as
additional authenticated data, so a record cannot be moved to a different entry.
The container is additionally sealed by the operating system keyring.

A credential is only ever filled into the host it was saved for. There is no
import from another browser's password database; you export a CSV yourself and
you start the import.

**Nobody can recover a lost master password.** Not the person who built it. A
support process that can open a vault is a process that can open anyone's, so
there is no reset link and no recovery code.

## The display name

First-run setup asks what to call you, and the new tab page greets you by it.
It is used for the greeting and nothing else, stored locally, and there is no
account to attach it to.

## The website is a separate thing

The application never contacts the website. The website is separate code with
separate behaviour, and it does carry advertising.

- Nothing advertising-related is requested and no advertising cookie is set
  until a visitor accepts
- The choice is stored in local storage rather than a cookie, so the site sets no
  first-party cookie of its own
- Declining leaves everything else working
- There is a cookie policy and a privacy statement, both linked from every page

If you use the website and the application, the website's behaviour has no bearing
on the application and vice versa. Saying so plainly seemed better than letting
the shared name imply otherwise.

## What still sees you

**A site can learn your public IP address through WebRTC.** A page that
configures a STUN server can obtain it, with no permission prompt, and
`iceCandidate` will hand the address over.

Three mitigations were attempted and none worked: a preference switch, a
command-line switch, and a blackhole in the host resolver. Chromium does not offer
a switch that removes host candidates without breaking WebRTC entirely.

What is provided instead is a choice. WebRTC blocking is a setting, and the
interface is explicit that it is incomplete: it reduces exposure, it does not
eliminate it. The measurement is published rather than left for someone to find.

**Your employer, your network and your DNS provider** see the addresses you
connect to. A browser cannot prevent that.

**Sites you log into** know who you are, by definition.

## The honest summary

Novaris keeps your data on your machine and sends nothing about it anywhere. It
does not stop a site from learning your IP address, and it is not signed, so
Windows cannot tell you who built it. Both of those are stated rather than
buried, and both have mitigations you can choose — one partial, one requiring a
certificate this project does not have.
