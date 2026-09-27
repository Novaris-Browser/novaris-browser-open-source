// A measured account of what Novaris and its Chromium actually protect.
//
// This exists because the alternative was worse. An earlier version of this file
// applied a Chromium switch called "force-webrtc-ip-handling-policy" and told the
// user it stopped WebRTC address discovery. Measurement showed it does not, so
// the switch was removed rather than shipped as a control that does nothing.
// A privacy browser that overclaims is more dangerous than one that admits a
// limit, because the user stops looking for the real fix.
//
// Everything below was verified against the packaged build on Chromium 152 /
// Electron 44.4.5. Each entry names how it was checked, so a future engine
// upgrade has something concrete to re-test rather than a claim to re-read.

// status: 'protected' means the behaviour was observed to be safe.
//         'exposed'  means a site can obtain the information, and no supported
//                     mechanism in Electron was found that stops it.
//         'partial'  means some of it is hidden and some is not.
const MEASURED = Object.freeze([
  {
    id: 'googleServices',
    status: 'protected',
    title: 'Google services',
    value: 'Not contacted',
    detail: 'Chromium normally pings Safe Browsing, the component updater, the variations service, and autofill. Electron ships with all of it disabled, so Novaris contacts no Google endpoint at all.',
    evidence: 'A Chromium network log over a session visiting three sites recorded 39 requests to exactly 3 hosts, every one of them page content.',
  },
  {
    id: 'cookiePartitioning',
    status: 'protected',
    title: 'Third-party cookie partitioning',
    value: 'On',
    detail: 'A cookie set by one site is not sent when a different site embeds it, which prevents cross-site tracking and the related cookie theft.',
    evidence: 'A cookie was set on one local origin and a subresource was requested by a second origin. The server received no cookie header.',
  },
  {
    id: 'localAddress',
    status: 'partial',
    title: 'Local network address',
    value: 'Usually hidden',
    detail: 'Novaris webviews return an anonymised .local hostname for the local network address rather than the real one, so a site cannot read it directly. This relies on Chromium mDNS obfuscation staying enabled.',
    evidence: 'Measured inside Novaris: the host candidate was a .local name. Measured in bare Electron with no Novaris layer: the candidate was the literal address 192.168.1.151, so this protection is a property of the Novaris webview configuration, not of Chromium alone.',
  },
  {
    id: 'publicAddress',
    status: 'exposed',
    title: 'Public IP address',
    value: 'Disclosed on request',
    detail: 'A site that configures a STUN server can obtain your public IP address through WebRTC, with no permission prompt. Sites that do not use WebRTC cannot. The only reliable mitigations are routing traffic through an anonymising network, or an extension that removes WebRTC per site.',
    evidence: 'A peer connection returned a server-reflexive candidate containing the real public address. This survived Chromium policy "disable_non_proxied_udp", applied both through the app and directly on the process command line, and also survived blackholing the STUN host with host-resolver-rules. No supported Electron mechanism was found that prevents it, so Novaris does not claim to stop it.',
  },
  {
    id: 'sandbox',
    status: 'protected',
    title: 'Page isolation',
    value: 'Enforced',
    detail: 'Every page runs in a sandboxed Chromium webview with context isolation, no Node.js access, and web security left on. These cannot be turned off from settings.',
    evidence: 'Verified in the packaged build, where a page could not reach any privileged API.',
  },
  {
    id: 'credentialTheft',
    status: 'protected',
    title: 'Password disclosure to impostor sites',
    value: 'Blocked',
    detail: 'A saved login is only ever filled into the host it was saved for, so a fake sign-in page cannot collect it. A page that impersonates a well-known provider raises a warning before anything is typed.',
    evidence: 'A credential saved for one host was refused on a different host, and the page fields were left empty.',
  },
]);

function engineFacts() {
  return {
    electron: process.versions.electron || '',
    chrome: process.versions.chrome || '',
    node: process.versions.node || '',
    v8: process.versions.v8 || '',
    platform: process.platform,
    arch: process.arch,
  };
}

function statusSummary() {
  const counts = { protected: 0, partial: 0, exposed: 0 };
  for (const item of MEASURED) counts[item.status] = (counts[item.status] || 0) + 1;
  return counts;
}

function describeHardening() {
  return {
    findings: MEASURED.map((item) => ({ ...item })),
    summary: statusSummary(),
    engine: engineFacts(),
    // Stated so the limit is visible without hunting for it.
    knownLimits: MEASURED.filter((item) => item.status === 'exposed').map((item) => item.title),
  };
}

module.exports = {
  MEASURED,
  describeHardening,
  engineFacts,
  statusSummary,
};
