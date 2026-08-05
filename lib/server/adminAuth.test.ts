import { describe, expect, it } from 'vitest';
import { checkAdminAuth, MIN_SECRET_LENGTH } from './adminAuth';

const SECRET = 'a-long-enough-admin-secret';
const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

describe('checkAdminAuth', () => {
  it('fails closed in production when no secret is configured', async () => {
    // The mistake this whole gate exists to prevent: a deployment that
    // believes it is protected and is not. Silence would be the worst
    // possible behaviour here.
    const r = await checkAdminAuth({ isProduction: true, secret: undefined });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ status: 503 });
    expect((r as { message: string }).message).toMatch(/SG_ADMIN_SECRET is not set/);
  });

  it('stays open in development so npm run dev is usable', async () => {
    expect(await checkAdminAuth({ isProduction: false, secret: undefined })).toEqual({ ok: true });
    expect(await checkAdminAuth({ isProduction: false, secret: '   ' })).toEqual({ ok: true });
  });

  it('refuses a secret too short to be a gate', async () => {
    // Nothing rate-limits, so a four-character secret is theatre.
    const r = await checkAdminAuth({ isProduction: true, secret: 'hunter2' });
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect((r as { message: string }).message).toMatch(
      new RegExp(`shorter than ${MIN_SECRET_LENGTH}`),
    );
  });

  it('accepts the secret as the Basic password, the username, or bare', async () => {
    for (const authorization of [
      basic('admin', SECRET), // browser prompt
      basic('', SECRET), // curl -u :SECRET
      basic(SECRET, ''), // curl -u SECRET:
    ]) {
      expect(await checkAdminAuth({ isProduction: true, secret: SECRET, authorization })).toEqual({
        ok: true,
      });
    }
  });

  it('accepts a bearer token or an x-admin-secret header, for scripts', async () => {
    expect(
      await checkAdminAuth({
        isProduction: true,
        secret: SECRET,
        authorization: `Bearer ${SECRET}`,
      }),
    ).toEqual({ ok: true });
    expect(
      await checkAdminAuth({ isProduction: true, secret: SECRET, headerSecret: SECRET }),
    ).toEqual({ ok: true });
  });

  it('rejects a wrong, absent, or malformed credential', async () => {
    const cases: { authorization?: string; headerSecret?: string }[] = [
      {},
      { authorization: basic('admin', 'wrong-but-long-enough-value') },
      { authorization: `Bearer ${SECRET}x` },
      { headerSecret: `${SECRET} ` },
      { authorization: 'Basic !!!not-base64!!!' },
      { authorization: 'Basic' },
      { authorization: 'Digest whatever' },
      // A prefix of the real secret must not pass — the comparison is over
      // digests precisely so length and prefix leak nothing.
      { authorization: basic('admin', SECRET.slice(0, -1)) },
    ];
    for (const c of cases) {
      const r = await checkAdminAuth({ isProduction: true, secret: SECRET, ...c });
      expect(r, JSON.stringify(c)).toMatchObject({ ok: false, status: 401 });
    }
  });

  it('gates development too once a secret is configured', async () => {
    // Configuring a secret means you want it enforced, wherever you are.
    expect(
      await checkAdminAuth({ isProduction: false, secret: SECRET }),
    ).toMatchObject({ ok: false, status: 401 });
    expect(
      await checkAdminAuth({ isProduction: false, secret: SECRET, headerSecret: SECRET }),
    ).toEqual({ ok: true });
  });

  it('ignores surrounding whitespace in the configured secret', async () => {
    expect(
      await checkAdminAuth({
        isProduction: true,
        secret: `  ${SECRET}  `,
        headerSecret: SECRET,
      }),
    ).toEqual({ ok: true });
  });
});
