/**
 * Downloads the bake-off candidate models into public/assets/bench/.
 *
 * EXPERIMENTAL — these are for the benchmark harness only. Production still
 * uses public/assets/efficientdet_lite0.tflite, which this script never touches.
 *
 * Also verifies each model's EMBEDDED labels.txt and reports the true class
 * indices, because the candidates do NOT share an indexing scheme (SSD
 * MobileNetV2 has a background class at index 0, shifting person to 1).
 *
 * Run: npm run bench:assets
 */
import { mkdir, writeFile, stat, access, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { CANDIDATES } from '../tools/benchmark/candidates.js';
import {
  verifyAsset, describeVerification,
} from '../tools/benchmark/assetIntegrity.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'assets', 'bench');
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

await mkdir(outDir, { recursive: true });

console.log(`[bench] fetching ${CANDIDATES.length} candidate models -> public/assets/bench/\n`);

for (const c of CANDIDATES) {
  const dest = join(outDir, c.file);


  // A cached file is NOT trusted on sight: existing says nothing about
  // contents. A half-written download and an upstream replacement both leave
  // a file that exists.
  let cached = await exists(dest);
  if (cached) {
    const v = await verifyAsset(dest, c);
    if (v.ok) {
      console.log(`  ✓ ${c.id.padEnd(14)} cached      `
        + `${(v.actualSize / 1e6).toFixed(2)} MB · ${describeVerification(v)}`);
    } else {
      // Re-fetch once: the usual cause is a truncated earlier download, and
      // silently keeping the bad bytes is exactly the outcome to avoid.
      console.warn(`  ! ${c.id.padEnd(14)} cached file REJECTED — `
        + `${describeVerification(v)}`);
      await rm(dest, { force: true });
      cached = false;
    }
  }

  if (!cached) {
    const declared = c.sizeBytes ? `${(c.sizeBytes / 1e6).toFixed(2)} MB` : '';
    process.stdout.write(`  … ${c.id.padEnd(14)} downloading ${declared}`);
    const res = await fetch(c.url);
    if (!res.ok) {
      console.error(`
[bench] FAILED ${c.id}: HTTP ${res.status} for ${c.url}`);
      process.exitCode = 1;
      continue;
    }
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));

    const v = await verifyAsset(dest, c);
    if (!v.ok) {
      // HARD FAILURE. The mismatched file is deleted so a later run cannot
      // mistake it for a good cache, and the bootstrap exits non-zero.
      await rm(dest, { force: true });
      console.error(`
[bench] INTEGRITY FAILURE ${c.id}: ${describeVerification(v)}`);
      console.error(`         source: ${c.url}`);
      console.error('         Asset does not match the pinned release; '
        + 'it has been deleted rather than used.');
      process.exitCode = 1;
      continue;
    }
    console.log(`  -> ${(v.actualSize / 1e6).toFixed(2)} MB · ${describeVerification(v)}`);
  }


  // Verify the label map the runner will rely on.
  if (c.task === 'object') {
    try {
      const labels = execFileSync('unzip', ['-p', dest, 'labels.txt'], { encoding: 'utf8' })
        .split('\n').map((l) => l.trim());
      const personIdx = labels.indexOf('person');
      const phoneIdx = labels.indexOf('cell phone');
      const declared = c.labelIndices;
      const ok = personIdx === declared.PERSON && phoneIdx === declared.PHONE;
      console.log(`      labels=${labels.filter(Boolean).length} `
        + `person=${personIdx} phone=${phoneIdx} `
        + `${ok ? '(matches candidates.js)' : `!! MISMATCH vs declared ${declared.PERSON}/${declared.PHONE}`}`);
      if (!ok) process.exitCode = 1;
    } catch {
      // The official YOLO LiteRT asset embeds no labels.txt. That is not a
      // fault: the browser runtime supplies the class map at load, and
      // resolveClassIds re-reads it from the loaded model and reports any
      // disagreement with candidates.js.
      console.log('      (no embedded labels.txt; class map is verified at '
        + 'load time by resolveClassIds)');
    }
  }
}

console.log('\n[bench] done. Open the harness and use the Benchmark panel.');
