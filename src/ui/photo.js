// Session-local photo handoff — the Thin Coat mechanism the bake-off verdict
// mandates for Wave 1: the editor bakes the aligned aerial once at world
// resolution, the arcade draws it under the tiles it already draws. IndexedDB
// because the blob must survive the editor→arcade tab boundary; never shared,
// never uploaded, never in a URL. The photo is a private luxury for whoever
// traced it — a share stays seed + patch, and absence is never an error.

const DB = 'golfcms.photo';
const STORE = 'play';

/** Stable key binding a baked photo to the exact trace: seed, biome, and a
 *  digest of the patch string. Any mismatch loads nothing — a stale photo
 *  under the wrong hole would be worse than no photo. Pure; node-testable. */
export function photoKey(seed, biome, patchStr) {
  let h = 5381;
  const s = String(patchStr ?? '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${seed >>> 0}/${biome}/${h.toString(16)}`;
}

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** One record, overwritten on each bake: the latest traced hole's ground. */
export async function savePlayPhoto(key, record) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...record, key }, 'current');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** The photo for `key`, or null. Stale, absent, or blocked storage all
 *  resolve to null — the tile-only game is the fallback, never an error. */
export async function loadPlayPhoto(key) {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get('current');
      req.onsuccess = () => {
        const rec = req.result;
        resolve(rec && rec.key === key ? rec : null);
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}
