import { describe, expect, it } from 'vitest';
import { MEASURED, describeHardening, engineFacts, statusSummary } from '../electron/privacy-posture.js';

describe('Novaris measured privacy posture', () => {
  it('reports every finding with a status the interface can render', () => {
    for (const item of MEASURED) {
      expect(['protected', 'partial', 'exposed']).toContain(item.status);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.value.length).toBeGreaterThan(0);
      expect(item.detail.length).toBeGreaterThan(30);
      // Every claim has to name how it was checked, so an engine upgrade has
      // something concrete to re-test.
      expect(item.evidence.length).toBeGreaterThan(30);
    }
  });

  // The point of this file. A panel that only lists wins is marketing.
  it('states the WebRTC public address limit instead of hiding it', () => {
    const publicAddress = MEASURED.find((item) => item.id === 'publicAddress');
    expect(publicAddress).toBeDefined();
    expect(publicAddress.status).toBe('exposed');
    expect(publicAddress.value).toMatch(/disclos/i);
    // It must record that the mitigations were tried and did not work, so
    // nobody re-adds a switch that was already disproved.
    expect(publicAddress.evidence).toMatch(/disable_non_proxied_udp/);
    expect(publicAddress.evidence).toMatch(/host-resolver-rules/);
    expect(publicAddress.evidence).toMatch(/no supported Electron mechanism/i);
    // And the user-facing text must name the real mitigations rather than
    // implying a setting exists.
    expect(publicAddress.detail).toMatch(/anonymising network|removes WebRTC per site/i);
  });

  it('does not claim Chromium alone hides the local address', () => {
    // Bare Electron returned the literal LAN address, so the protection belongs
    // to the Novaris webview configuration and must be described that way.
    const local = MEASURED.find((item) => item.id === 'localAddress');
    expect(local.status).toBe('partial');
    expect(local.evidence).toMatch(/bare electron/i);
    expect(local.evidence).toMatch(/192\.168\./);
  });

  it('records that Chromium contacts no Google endpoint', () => {
    const google = MEASURED.find((item) => item.id === 'googleServices');
    expect(google.status).toBe('protected');
    expect(google.value).toMatch(/not contacted/i);
    expect(google.evidence).toMatch(/39 requests to exactly 3 hosts/i);
  });

  it('counts each status and the counts match the findings', () => {
    const summary = statusSummary();
    const total = summary.protected + summary.partial + summary.exposed;
    expect(total).toBe(MEASURED.length);
    expect(summary.exposed).toBeGreaterThan(0);
  });

  it('surfaces known limits at the top level', () => {
    const described = describeHardening();
    expect(described.knownLimits).toContain('Public IP address');
    expect(described.findings).toHaveLength(MEASURED.length);
    // Returned as copies, so a caller cannot mutate the shared record.
    described.findings[0].title = 'tampered';
    expect(MEASURED[0].title).not.toBe('tampered');
  });

  it('records the running engine', () => {
    const facts = engineFacts();
    expect(facts.chrome).toBe(process.versions.chrome || '');
    expect(facts.electron).toBe(process.versions.electron || '');
    expect(facts.platform).toBe(process.platform);
  });
});
