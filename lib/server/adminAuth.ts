/**
 * Shared-secret gate for /admin and /api/admin.
 *
 * v1 has no user accounts and does not need them: there is one operator and
 * the admin surfaces are annotation tools, not a product. What they are not
 * is safe to leave open — /api/admin/hole writes content, and
 * /api/admin/import will spend the host's CPU on Overpass queries for
 * anyone who finds it.
 *
 * Kept as a pure function so the decision is unit-testable without a
 * request, a server, or a browser. The middleware is a thin adapter.
 */

/** Below this a secret is guessable, and nothing here rate-limits. */
export const MIN_SECRET_LENGTH = 16;

export type AdminAuthResult =
  | { ok: true }
  | { ok: false; status: 401; message: string }
  | { ok: false; status: 503; message: string };

export interface AdminAuthInput {
  /** The request's Authorization header, if any. */
  authorization?: string | null;
  /** An x-admin-secret header, for scripts that would rather not use Basic. */
  headerSecret?: string | null;
  /** SG_ADMIN_SECRET as configured. */
  secret?: string | undefined;
  /** Production fails closed; development does not, so `npm run dev` works. */
  isProduction: boolean;
}

/** SHA-256 hex, via Web Crypto so this runs on the Edge runtime too. */
async function sha256(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/**
 * Compare by digest rather than by string. Digests are always the same
 * length, so the loop below leaks nothing about how much of the secret a
 * guess got right — and nothing about the secret's length either.
 */
async function secretEquals(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i]! ^ db[i]!;
  return diff === 0;
}

/**
 * Every credential the request offers, in no particular order. Basic auth
 * is accepted with the secret as either the username or the password, so
 * `curl -u :SECRET`, `curl -u SECRET:` and a browser prompt all work.
 */
function presentedSecrets(input: AdminAuthInput): string[] {
  const out: string[] = [];
  if (input.headerSecret) out.push(input.headerSecret);

  const header = input.authorization?.trim() ?? '';
  const [scheme, ...rest] = header.split(/\s+/);
  const value = rest.join(' ');
  if (!scheme || !value) return out;

  if (scheme.toLowerCase() === 'bearer') {
    out.push(value);
  } else if (scheme.toLowerCase() === 'basic') {
    let decoded = '';
    try {
      decoded = atob(value);
    } catch {
      return out;
    }
    const idx = decoded.indexOf(':');
    if (idx === -1) {
      out.push(decoded);
    } else {
      out.push(decoded.slice(0, idx), decoded.slice(idx + 1));
    }
  }
  return out;
}

export async function checkAdminAuth(input: AdminAuthInput): Promise<AdminAuthResult> {
  const secret = input.secret?.trim();

  if (!secret) {
    // Fail closed. An unset secret in production is a deployment that
    // believes it is protected and is not — the exact mistake this exists
    // to prevent, so it must be loud rather than permissive.
    if (input.isProduction) {
      return {
        ok: false,
        status: 503,
        message:
          'Admin is disabled: SG_ADMIN_SECRET is not set. Set it to a random ' +
          `string of at least ${MIN_SECRET_LENGTH} characters and restart.`,
      };
    }
    return { ok: true };
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    return {
      ok: false,
      status: 503,
      message:
        `Admin is disabled: SG_ADMIN_SECRET is shorter than ${MIN_SECRET_LENGTH} ` +
        'characters. Nothing here rate-limits, so a short secret is not a gate.',
    };
  }

  const presented = presentedSecrets(input);
  for (const candidate of presented) {
    if (await secretEquals(candidate, secret)) return { ok: true };
  }

  return {
    ok: false,
    status: 401,
    message: presented.length ? 'Wrong admin secret.' : 'Admin secret required.',
  };
}
