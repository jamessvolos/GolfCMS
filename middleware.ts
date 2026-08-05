/**
 * Gate /admin and /api/admin behind a shared secret. The decision lives in
 * lib/server/adminAuth.ts; this only adapts a request to it and shapes the
 * response.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkAdminAuth } from '@/lib/server/adminAuth';

export const config = {
  matcher: ['/admin', '/admin/:path*', '/api/admin/:path*'],
};

export async function middleware(req: NextRequest) {
  const result = await checkAdminAuth({
    authorization: req.headers.get('authorization'),
    headerSecret: req.headers.get('x-admin-secret'),
    secret: process.env.SG_ADMIN_SECRET,
    isProduction: process.env.NODE_ENV === 'production',
  });

  if (result.ok) return NextResponse.next();

  const isApi = req.nextUrl.pathname.startsWith('/api/');
  const body = isApi ? JSON.stringify({ error: result.message }) : result.message;
  const headers: Record<string, string> = {
    'content-type': isApi ? 'application/json' : 'text/plain; charset=utf-8',
    // Do not let a proxy or the browser hold on to a denial.
    'cache-control': 'no-store',
  };
  // 401 asks the browser to prompt; 503 is a misconfiguration and prompting
  // for a secret the server cannot check would just loop.
  if (result.status === 401) {
    headers['www-authenticate'] = 'Basic realm="SG Trainer admin", charset="UTF-8"';
  }

  return new NextResponse(body, { status: result.status, headers });
}
