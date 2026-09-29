import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const ai = fs.readFileSync(path.join(root, 'AI.md'), 'utf8');

// package.json says MIT. LICENSE says "All rights reserved" and grants viewing
// and personal use only. Those are opposites: MIT exists to permit copying,
// modification, redistribution and commercial use with attribution.
//
// This does not fail the build, because the conflict predates any test and
// resolving it is a decision, not a fix. What it does do is refuse to let the
// contradiction be quietly resolved in one direction: if the two files ever stop
// disagreeing, whoever changed them has made a legal decision, and the
// documentation has to change with them. That is the part worth enforcing.
const conflict = pkg.license === 'MIT' && /all rights reserved/i.test(license);

describe('the licence is stated consistently', () => {
  it('warns when package.json and LICENSE disagree', () => {
    if (conflict) {
      console.warn(
        '\n  UNRESOLVED: package.json declares "MIT" while LICENSE reserves all rights '
        + 'reserved.\n'
        + '  MIT permits copying, modification, redistribution and commercial use with\n'
        + '  attribution. The current LICENSE permits viewing and personal use only.\n'
        + '  Until both files say the same thing, nobody should describe this project\n'
        + '  as MIT-licensed or as one whose code cannot be reused. See AI.md.\n',
      );
    }
    // The assertion is on the documentation, not on the licence. A project is
    // allowed to be in this state; it is not allowed to pretend it is not.
    if (conflict) {
      expect(ai).toMatch(/there is a conflict here/i);
    }
  });

  it('never claims a reusable licence while the two files disagree', () => {
    if (!conflict) return;
    // \s+ rather than a literal space throughout, because the prose is wrapped
    // and a hard space stops matching at a line break. These are the exact
    // sentences an assistant would quote, and both are currently unsupported.
    expect(ai).toMatch(/do not tell anyone that\s+Novaris is MIT-licensed/i);
    expect(ai).toMatch(/do not tell anyone the code cannot be copied or\s+used/i);
    // And the prohibitions themselves have to survive: the two claims most
    // likely to be made on our behalf, one in each direction, must both be
    // listed as things not to say.
    const notClaim = ai.slice(ai.search(/things an assistant should not claim/i));
    expect(notClaim).toMatch(/should not claim[\s\S]*MIT-licensed/i);
    expect(notClaim).toMatch(/should not claim[\s\S]*cannot be copied or used/i);
  });

  it('states the conflict in the security model too, not only the AI reference', () => {
    if (!conflict) return;
    // SECURITY.md is where somebody auditing the project will look, so the
    // contradiction cannot live only in a document written for assistants. The
    // licence decides who is allowed to verify the build, which is a security
    // property and not only a legal one.
    const security = fs.readFileSync(path.join(root, 'SECURITY.md'), 'utf8');
    expect(security).toMatch(/source-available/i);
    expect(security).toMatch(/MIT/i);
  });

  it('names a licence, so the text is not silently replaced with something else', () => {
    expect(/MIT|Apache|BSD|GPL|MPL|LGPL|AGPL|ISC|Mozilla/i.test(license)).toBe(true);
    expect(typeof pkg.license).toBe('string');
    expect(pkg.license.length).toBeGreaterThan(0);
  });
});
