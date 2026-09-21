/**
 * Benchmark asset integrity (reproducibility).
 *
 * The rule under test: a benchmark is reproducible only if the bytes it
 * measured are the bytes a later reader can obtain. The YOLO26n artefact
 * comes from a pinned GitHub release asset, and a release asset CAN be
 * replaced in place upstream — so size and SHA-256 are checked, and a
 * mismatch is a hard failure rather than a warning.
 *
 * No network and no model file: the checks run against temporary fixtures.
 *
 * No AI parameter is read or changed here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  verifyAsset, sha256File, describeVerification,
} from '../tools/benchmark/assetIntegrity.js';
import { CANDIDATES } from '../tools/benchmark/candidates.js';

const yolo26n = () => CANDIDATES.find((c) => c.id === 'yolo26n');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** A throwaway file with known bytes. */
async function fixture(bytes) {
  const dir = await mkdtemp(join(tmpdir(), 'hachiko-asset-'));
  const path = join(dir, 'asset.tflite');
  await writeFile(path, bytes);
  return { path, dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// ═══════════════════════════════════════════════════════════════════════
// The declared integrity metadata
// ═══════════════════════════════════════════════════════════════════════
test('I1. YOLO26n declares a FULL sha256 and the verified byte size', () => {
  const c = yolo26n();
  // Full 64-hex digest, lowercase. An abbreviated hash is not a checksum:
  // it narrows the space without pinning the file.
  assert.match(c.sha256, /^[0-9a-f]{64}$/,
    'the full SHA-256 must be stored, never an abbreviation');
  assert.equal(c.sha256.length, 64);
  assert.equal(c.sizeBytes, 2875553, 'the verified byte size');

  // Pinned release, never a floating tag.
  assert.match(c.url, /releases\/download\/v0\.6\.6\//);
  assert.ok(!/\/latest\//.test(c.url), 'the URL must not track "latest"');
  assert.equal(c.sourceRelease, 'v0.6.6');
  assert.equal(c.sourceAsset, 'yolo26n_w8a32.tflite');
});

test('I2. integrity metadata agrees with the exported provenance', async () => {
  const { buildResultsJson } = await import('../tools/benchmark/exportResults.js');
  const c = yolo26n();
  const exported = buildResultsJson([], { requiredRepetitions: 3 })
    .candidates.find((x) => x.id === 'yolo26n');

  // One source of truth: the registry. The export projects it unchanged, so
  // a reader of the JSON can re-verify the artefact themselves.
  assert.equal(exported.sha256, c.sha256);
  assert.equal(exported.sizeBytes, c.sizeBytes);
  assert.equal(exported.sourceRelease, c.sourceRelease);
  assert.equal(exported.sourceAsset, c.sourceAsset);
  assert.equal(exported.quantization, 'w8a32');
});

// ═══════════════════════════════════════════════════════════════════════
// Verification behaviour
// ═══════════════════════════════════════════════════════════════════════
test('I3. a matching asset passes both checks', async () => {
  const bytes = Buffer.from('TFL3 pretend model payload');
  const f = await fixture(bytes);
  try {
    const v = await verifyAsset(f.path,
      { sizeBytes: bytes.length, sha256: sha(bytes) });
    assert.equal(v.ok, true);
    assert.deepEqual(v.checked, ['size', 'sha256'], 'both checks ran');
    assert.deepEqual(v.errors, []);
    assert.equal(v.actualSize, bytes.length);
    assert.equal(v.actualSha256, sha(bytes));
    assert.match(describeVerification(v), /verified size \+ sha256/);
  } finally { await f.cleanup(); }
});

test('I4. a wrong SIZE fails, and says so', async () => {
  const bytes = Buffer.from('truncated');
  const f = await fixture(bytes);
  try {
    const v = await verifyAsset(f.path,
      { sizeBytes: bytes.length + 1000, sha256: sha(bytes) });
    assert.equal(v.ok, false);
    assert.match(v.errors[0], /size 9 != expected 1009/);
    // The hash is not computed once the size already disagrees: the size is
    // the informative error for a truncated download.
    assert.equal(v.actualSha256, null);
  } finally { await f.cleanup(); }
});

test('I5. a wrong SHA-256 fails even when the size is right', async () => {
  // The dangerous case: an upstream asset replaced with a same-length file.
  // Size alone would wave it through.
  const bytes = Buffer.from('AAAAAAAAAA');
  const other = Buffer.from('BBBBBBBBBB');
  assert.equal(bytes.length, other.length, 'same size, different bytes');

  const f = await fixture(bytes);
  try {
    const v = await verifyAsset(f.path,
      { sizeBytes: other.length, sha256: sha(other) });
    assert.equal(v.ok, false);
    assert.equal(v.checked.includes('sha256'), true);
    assert.match(v.errors[0], /^sha256 [0-9a-f]{64} != expected [0-9a-f]{64}$/);
  } finally { await f.cleanup(); }
});

test('I6. an EXISTING corrupted asset is rejected, never trusted on sight', async () => {
  // "The file is already there" says nothing about what is in it.
  const good = Buffer.from('the real model bytes');
  const corrupt = Buffer.concat([Buffer.from('the real model byt')]);
  const f = await fixture(corrupt);
  try {
    const v = await verifyAsset(f.path,
      { sizeBytes: good.length, sha256: sha(good) });
    assert.equal(v.ok, false, 'a cached-but-wrong file must not pass');
    assert.ok(v.errors.length > 0);
    assert.match(describeVerification(v), /!=/);
  } finally { await f.cleanup(); }
});

test('I7. a missing file is a failure, not a pass by omission', async () => {
  const v = await verifyAsset(join(tmpdir(), 'hachiko-not-here-12345.tflite'),
    { sizeBytes: 10, sha256: sha(Buffer.from('x')) });
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /^missing:/);
});

test('I8. a candidate with no declared hash is not reported as verified', async () => {
  // The MediaPipe candidates declare a size but no sha256. The result must
  // distinguish "passed the checks that exist" from "fully verified".
  const bytes = Buffer.from('mediapipe-ish');
  const f = await fixture(bytes);
  try {
    const v = await verifyAsset(f.path, { sizeBytes: bytes.length });
    assert.equal(v.ok, true);
    assert.deepEqual(v.checked, ['size'], 'only the declared check ran');
    assert.equal(describeVerification(v), 'verified size');

    const none = await verifyAsset(f.path, {});
    assert.equal(none.ok, true);
    assert.equal(describeVerification(none), 'no integrity metadata declared');
  } finally { await f.cleanup(); }
});

test('I9. sha256File matches the crypto digest of the same bytes', async () => {
  const bytes = Buffer.from('determinism check');
  const f = await fixture(bytes);
  try {
    assert.equal(await sha256File(f.path), sha(bytes));
    // And it reads the file rather than caching a previous answer.
    await writeFile(f.path, Buffer.from('changed'));
    assert.equal(await sha256File(f.path), sha(Buffer.from('changed')));
  } finally { await f.cleanup(); }
});

// ═══════════════════════════════════════════════════════════════════════
// The bootstrap script's contract
// ═══════════════════════════════════════════════════════════════════════
test('I10. the fetcher fails hard and deletes a mismatched asset', async () => {
  const src = await readFile(
    new URL('../scripts/fetch-bench-models.mjs', import.meta.url), 'utf8');

  // A cached file must be verified, not skipped.
  assert.match(src, /let cached = await exists\(dest\)/);
  assert.match(src, /cached file REJECTED/,
    'a bad cache must be reported and replaced');

  // A mismatch must be fatal, and must not leave the bad bytes behind.
  assert.match(src, /INTEGRITY FAILURE/);
  assert.match(src, /process\.exitCode = 1/);
  assert.match(src, /await rm\(dest, \{ force: true \}\)/,
    'the mismatched file must be deleted, not kept as a cache');

  // The old behaviour was a console.warn that carried on regardless.
  assert.ok(!/update candidates\.js/.test(src),
    'the advisory size warning must be gone');
  assert.ok(!src.includes('console.warn(`\\n    ! size'),
    'a size mismatch must not be a warning any more');
});

test('I11. the real YOLO26n asset verifies, when it has been fetched', async () => {
  // The artefact is gitignored, so this is conditional: it asserts nothing
  // when the asset has not been downloaded, and verifies it when it has.
  const c = yolo26n();
  const path = new URL(`../public/assets/bench/${c.file}`, import.meta.url);
  let present = true;
  try { await readFile(path); } catch { present = false; }
  if (!present) return;

  const v = await verifyAsset(path.pathname.replace(/^\/([A-Za-z]:)/, '$1'), c);
  assert.equal(v.ok, true, `the fetched asset must verify: ${v.errors.join('; ')}`);
  assert.equal(v.actualSize, 2875553);
  assert.equal(v.actualSha256,
    'd9cef07ce652ccfa9ce58e4ac8a4df98ff037739a9dad20a8afcae21b545df73');
});
