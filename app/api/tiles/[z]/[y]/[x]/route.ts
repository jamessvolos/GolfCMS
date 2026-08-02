/**
 * Same-origin tile relay for sandboxed development ONLY.
 *
 * Cloud dev containers route all egress through an HTTP proxy that in-page
 * fetches can't traverse, so when NEXT_PUBLIC_TILE_PROXY=1 the map requests
 * tiles from this route and the server fetches Esri through the proxy
 * (honoring HTTPS_PROXY + NODE_EXTRA_CA_CERTS). Production builds omit the
 * flag and the browser talks to Esri directly — this route then simply
 * sits unused. Esri attribution is displayed by the map control either way.
 */

import { fetch as undiciFetch, ProxyAgent } from 'undici';

const UPSTREAM =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';

const dispatcher = process.env.HTTPS_PROXY
  ? new ProxyAgent(process.env.HTTPS_PROXY)
  : undefined;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ z: string; y: string; x: string }> },
) {
  const { z, y, x } = await params;
  if (!/^\d+$/.test(z) || !/^\d+$/.test(y) || !/^\d+$/.test(x)) {
    return new Response('bad tile coords', { status: 400 });
  }
  const upstream = await undiciFetch(`${UPSTREAM}/${z}/${y}/${x}`, { dispatcher });
  if (!upstream.ok) {
    return new Response('upstream tile error', { status: upstream.status });
  }
  const body = await upstream.arrayBuffer();
  return new Response(body, {
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'image/jpeg',
      'cache-control': 'public, max-age=86400',
    },
  });
}
