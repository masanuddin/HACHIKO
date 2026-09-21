/**
 * HACHIKO — Benchmark asset integrity  (tools/benchmark)
 * ======================================================
 * EXPERIMENTAL. Lives outside src/ai and is never imported by production code.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────
 * A benchmark is only reproducible if the bytes it measured are the bytes a
 * later reader can obtain. Most candidates are fetched from Google's model
 * host under a versioned path; the YOLO26n LiteRT artefact comes from a
 * pinned GitHub release, and a release asset CAN be replaced in place.
 *
 * So for any candidate that declares them, the size and the SHA-256 are
 * checked against the downloaded file. A mismatch is a hard failure, not a
 * warning: continuing would let the benchmark record numbers against a model
 * nobody can identify afterwards, which is worse than not running at all.
 *
 * A cached file is verified too. "It is already on disk" says nothing about
 * what is in it — a truncated download or an upstream replacement both leave
 * a file that exists.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

/** SHA-256 of a file, lowercase hex. */
export async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

/**
 * Check one asset against the integrity fields its candidate declares.
 *
 * Only what is DECLARED is enforced. A candidate with no `sha256` is not
 * silently treated as verified — the result says which checks ran, so a
 * caller can tell "passed" from "nothing to check".
 *
 * @param {string} path  file on disk
 * @param {{sizeBytes?:number, sha256?:string}} expected  registry entry
 * @returns {Promise<{ok:boolean, checked:string[], errors:string[],
 *                    actualSize:number|null, actualSha256:string|null}>}
 */
export async function verifyAsset(path, expected = {}) {
  const checked = [];
  const errors = [];
  let actualSize = null;
  let actualSha256 = null;

  try {
    ({ size: actualSize } = await stat(path));
  } catch {
    return { ok: false, checked, errors: [`missing: ${path}`],
      actualSize: null, actualSha256: null };
  }

  if (typeof expected.sizeBytes === 'number') {
    checked.push('size');
    if (actualSize !== expected.sizeBytes) {
      errors.push(`size ${actualSize} != expected ${expected.sizeBytes}`);
    }
  }

  // Hash only when the size already agrees: on a truncated download the size
  // is the informative error, and hashing a wrong file wastes time saying so.
  if (typeof expected.sha256 === 'string' && expected.sha256) {
    checked.push('sha256');
    if (errors.length === 0) {
      actualSha256 = await sha256File(path);
      if (actualSha256 !== expected.sha256.toLowerCase()) {
        errors.push(`sha256 ${actualSha256} != expected ${expected.sha256}`);
      }
    }
  }

  return { ok: errors.length === 0, checked, errors, actualSize, actualSha256 };
}

/** A one-line human summary of what was verified. */
export function describeVerification(result) {
  if (!result.checked.length) return 'no integrity metadata declared';
  return result.ok
    ? `verified ${result.checked.join(' + ')}`
    : result.errors.join('; ');
}

export default verifyAsset;
