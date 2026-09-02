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
import { mkdir, writeFile, stat, access, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { CANDIDATES } from '../tools/benchmark/candidates.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'assets', 'bench');
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

await mkdir(outDir, { recursive: true });

console.log(`[bench] fetching ${CANDIDATES.length} candidate models -> public/assets/bench/\n`);

for (const c of CANDIDATES) {
  const dest = join(outDir, c.file);

  if (await exists(dest)) {
    const { size } = await stat(dest);
    console.log(`  ✓ ${c.id.padEnd(14)} cached      ${(size / 1e6).toFixed(2)} MB`);
  } else {
    process.stdout.write(`  … ${c.id.padEnd(14)} downloading ${(c.sizeBytes / 1e6).toFixed(2)} MB`);
    const res = await fetch(c.url);
    if (!res.ok) {
      console.error(`\n[bench] FAILED ${c.id}: HTTP ${res.status} for ${c.url}`);
      process.exitCode = 1;
      continue;
    }
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    const { size } = await stat(dest);
    // Guard against a silently truncated or substituted asset.
    if (size !== c.sizeBytes) {
      console.warn(`\n    ! size ${size} != declared ${c.sizeBytes} — update candidates.js`);
    }
    console.log(`  -> ${(size / 1e6).toFixed(2)} MB`);
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
      console.log('      (labels.txt not readable here; runner falls back to name matching)');
    }
  }
}

console.log('\n[bench] done. Open the harness and use the Benchmark panel.');
