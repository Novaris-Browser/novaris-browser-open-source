# Novaris documentation

| Document | What it covers |
|---|---|
| [SECURITY.md](../SECURITY.md) | The security model. Every boundary, how it is enforced, and where it does not hold. Read this first. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Processes, the module layout, and why the boundaries fall where they do. |
| [PRIVACY.md](PRIVACY.md) | What is stored, what leaves the device, and what was measured rather than assumed. |
| [UPDATES.md](UPDATES.md) | How the update channel works, how a release is signed, and what verification a user can do. |
| [PUBLISHING.md](PUBLISHING.md) | How to publish a release to R2, and the checks that stop a broken one going out. |
| [ENGINE-MIGRATION.md](ENGINE-MIGRATION.md) | Moving away from Chromium, and what stands in the way. |
| [TESTING.md](TESTING.md) | How the project is tested, and which claims are proved rather than asserted. |

## The short version

Novaris is a Chromium-based browser. Everything it changes sits around the
engine: which requests are allowed, what is stored on the device, and what a page
is told. The engine is not modified.

Three ideas run through the whole project and are worth knowing before reading
any of it:

**Refuse rather than fall back.** When a defence cannot be established, the
feature does not start. The password vault on Linux reports itself unavailable if
the desktop has no real keyring, rather than using Chromium's `basic_text`
backend, which encrypts with a hardcoded password and reports itself available
anyway. An update whose signature does not verify is refused, not downloaded. A
user with a broken feature and a clear message is in a better position than one
with a working feature that is not what it says it is.

**Measure, then write it down.** The privacy claims in this project come from a
Chromium network log of a real session, not from reading the documentation. Where
a claim could not be measured, it is qualified, and where a limitation was found
it is published rather than left for someone to discover.

**Say what it does not do.** There is a section in the README, a section on the
website, and a table at the end of the security model. A browser that only lists
its strengths is not telling you anything useful.
