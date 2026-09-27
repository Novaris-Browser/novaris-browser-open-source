Blocking ads that a site serves from its own domain
==================================================

Most ad blocking is about remote hosts: the ad comes from
ads.example.net and the rule names that host. A large share of ad code is not
like that. The script sits on the site's own server, next to the site's own
code, and only the request path gives it away. Those were not blocked before,
because the browser matched on the host and the host was the site's own.

Version 0.8.2 blocks ad scripts by their path as well as by their host.


Matching on whole path segments
-------------------------------

A rule of "ads.js", matched as plain text, also matches downloads.js, uploads.js,
leads.js, threads.js, heads.js and roads.js. Blocking those would break the
download button, the upload widget and the comments section of a large part of
the web. A privacy feature that breaks the page it is meant to clean up is
worse than a missed ad.

Every rule therefore begins with a slash, which means the match has to start at
a path separator. /js/ads.js is blocked. /js/downloads.js is not.


What is matched
---------------

Scripts by name: ads.js, ad.js, adsbygoogle.js, pagead.js, pagead2.js,
adsense.js, adcode.js, advertising.js, adframe-rotator.js.

Asset directories, but only for files that can never be a page someone meant to
open: /static/ads/, /static/ad/, /adserver/, /adserver2/, /adframe/,
/ad-assets/, /ads/serve/, /ad-frames/, /advertising/. A site with a real /ads/
page keeps its page. Directory rules do not apply to navigation at all.


An exception that actually works
--------------------------------

When a rule goes too far, you need to be able to put the one file back.
@@||example.com/js/ads.js did nothing, because the filter parser read the path
as part of the domain name and could never match it. Filters of the form
||example.com/some/path now work for both blocking and allowing, so an
exception is possible.


Not changed
-----------

The host list you asked for was already blocked. Amazon advertising, AdColony,
Facebook's pixel, the Twitter, LinkedIn, Reddit, YouTube, Pinterest and TikTok
ad and telemetry hosts, Freshmarketer and Google Analytics click tracking were
all already covered, most of it since earlier versions.

One is not, by choice. Mouseflow is session replay: it records the session
itself, including movement, clicks and the text typed into forms. It is the most
privacy-sensitive host in the project, and it is still opt-in rather than
default, because a site owner can gate content behind a replay-driven flow and
whether to accept that trade is your decision, not a default worth imposing.
Turn on strict blocking to include it.


Side panel, media controls, saved pages and tab transfer
=======================================================

Side panel apps
---------------

A column of apps that stay open beside your tabs: Discord, YouTube, Spotify,
Canvas, Mail, and a Notes scratchpad. Each app runs in its own sandboxed view, so
it costs a tab's worth of memory instead of a whole tab, and switching apps never
navigates away from what you were reading.

Only the app you are looking at is loaded. Keeping eleven webviews alive to draw
eleven icons would cost more than the feature is worth.


Media controls
---------------

A control bar appears for the active page when it plays audio or video. The page
is the source of truth: it publishes what it is playing and the bar sends
commands back, so a playlist advancing on its own is followed rather than fought.

Play, pause, skip ten seconds either way, seek, mute, and picture-in-picture are
all included. Only a fixed list of commands can be sent, so a page cannot use the
bridge to run anything else.


Picture in picture
------------------

Verified working: with a real click, the browser enters picture-in-picture and
playback continues. A page cannot enter it on its own, because the browser
requires a user gesture, so Novaris drives it from its own control.


Saved pages
-----------

Save a page to read it without a connection. A saved page is a snapshot of the
text, not a full copy of a site, because a copy that looks real but works badly
is worse than one that plainly says what it is.

Three things are decided honestly:

- Saved content is placed in a sandbox with neither script execution nor
  same-origin access, so a captured page cannot read Novaris, reach a stored
  credential, or make requests as you.
- Every saved page carries the address and the time it was taken, printed on the
  page itself, so a saved copy can never be mistaken for the live site.
- Pages that would not save usefully are refused with a reason, including
  sign-in pages and pages with nothing to read. A saved copy of a signed-in page
  is a saved copy of your account, so Novaris will not quietly make one.


Tab transfer, device to device
------------------------------

Send a tab to another device on your network without any server involved. The
sending device listens and shows a pairing code; the receiving device types that
code to connect. Nothing is hosted anywhere, there is no account, and there is
no third party holding a record of when your devices talked to each other.

- Only addresses on your local network can be reached, so Novaris cannot be used
  to make an outward connection.
- Your tab is encrypted on the sending PC with AES-256-GCM under a key derived
  from a passphrase before it moves, so nothing readable crosses the network even
  on a shared one, and the passphrase never leaves the device.
- A pairing code is 100 bits of randomness, compared in constant time.
- A code stops working after ten minutes, and a transfer can be claimed three
  times. Three rather than one, because a mistyped passphrase must be correctable
  and a leaked code must still be of limited use.
- A passphrase under twelve characters is refused rather than accepted quietly.
- The sending device keeps no copy once the budget is spent.

The honest limit: this transfers between devices on the same network. Sending a
tab to a device somewhere else while you are away from home is not something this
can do, and the interface says so rather than leaving you to find out later.


Layout
------

The reading column is never allowed to become too narrow to read. When a
side-by-side view would produce two unusable slivers, the split is refused and
the interface says which panel is in the way, so the fix is a click rather than a
guess.
