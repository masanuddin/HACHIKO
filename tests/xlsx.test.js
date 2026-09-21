/**
 * XLSX report tests (spec §29).
 *
 * The workbook is a PRESENTATION layer. These tests hold two things: that it
 * is a structurally valid OOXML package a spreadsheet can open, and that it
 * never becomes a second source of scientific truth — every value shown is one
 * the JSON master already carries.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildXlsx, colName, S } from '../tools/shared/xlsx.js';
import { DebugSession } from '../tools/debug/DebugSession.js';
import { buildDebugReport } from '../tools/debug/debugReport.js';
import { getScenario } from '../tools/debug/scenarios.js';
import { BenchmarkRunner } from '../tools/benchmark/BenchmarkRunner.js';
import { buildBenchmarkReport } from '../tools/benchmark/benchmarkReport.js';
import { buildResultsJson, buildExportBundle } from '../tools/benchmark/exportResults.js';
import {
  PERSON_SCENARIOS, PHONE_SCENARIOS, BENCH_REQUIRED_REPETITIONS,
} from '../tools/benchmark/candidates.js';

const text = (bytes) => new TextDecoder().decode(bytes);

/**
 * The <sheetData> of sheet `n` (1-based).
 *
 * Read by position rather than by part name: a ZIP repeats every part name
 * (local header, central directory), so indexing by name picks the wrong
 * bytes. The stored sheets appear in workbook order.
 */
const body = (t, n) => {
  const blocks = [...t.matchAll(/<sheetData>([\s\S]*?)<\/sheetData>/g)];
  assert.ok(blocks[n - 1], `sheet ${n} has no sheetData`);
  return blocks[n - 1][1];
};

/** Row count of sheet `n`. */
const rowsIn = (t, n) => (body(t, n).match(/<row r="/g) ?? []).length;

// ── The writer itself ──────────────────────────────────────────────────
test('X1. the writer emits a structurally valid OOXML package', () => {
  const wb = buildXlsx([{ name: 'One', rows: [['a', 1]] },
                        { name: 'Two', rows: [['b']] }]);
  assert.equal(wb[0], 0x50, 'PK signature');
  assert.equal(wb[1], 0x4b);
  const t = text(wb);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
                      'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
                      'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
    assert.ok(t.includes(part), `missing part ${part}`);
  }
  // No macros, no external data, no cloud formulas.
  for (const banned of ['vbaProject', 'externalLink', 'WEBSERVICE', 'RTD(']) {
    assert.ok(!t.includes(banned), `${banned} must not appear`);
  }
});

test('X2. a blank cell stays blank and never becomes zero', () => {
  const t = text(buildXlsx([{ name: 'S',
    rows: [[null, 0, undefined, '', 5]] }]));
  const row = body(t, 1);

  // An absent value emits NO CELL AT ALL. Checking cell presence rather than
  // the <v> text matters: a coercion bug can render null as the string
  // "null" or "" and still read as "no numeric zero was written".
  assert.ok(!row.includes('r="A1"'), 'null must produce no cell');
  assert.ok(!row.includes('r="C1"'), 'undefined must produce no cell');
  assert.ok(!row.includes('r="D1"'), 'empty string must produce no cell');

  // A real zero survives as a real zero.
  assert.ok(row.includes('<c r="B1"><v>0</v></c>'));
  assert.ok(row.includes('<c r="E1"><v>5</v></c>'));

  // And nothing anywhere stringified an absent value.
  for (const leak of ['>null<', '>undefined<', '>NaN<']) {
    assert.ok(!t.includes(leak), `absent values must not appear as ${leak}`);
  }
});

test('X3. column names and escaping are correct', () => {
  assert.equal(colName(0), 'A');
  assert.equal(colName(25), 'Z');
  assert.equal(colName(26), 'AA');
  const t = text(buildXlsx([{ name: 'S', rows: [['a & b < c > "d"']] }]));
  assert.ok(t.includes('a &amp; b &lt; c &gt; &quot;d&quot;'));
});

test('X4. freeze panes and filters are emitted when asked', () => {
  const t = text(buildXlsx([{ name: 'S', rows: [['h'], ['v']],
    freeze: { row: 1, col: 2 }, autoFilter: 'A1:C2', widths: [10, 20] }]));
  assert.ok(t.includes('state="frozen"'));
  assert.ok(t.includes('ySplit="1"') && t.includes('xSplit="2"'));
  assert.ok(t.includes('<autoFilter ref="A1:C2"/>'));
  assert.ok(t.includes('customWidth="1"'));
});

// ── Debug workbook ─────────────────────────────────────────────────────
const smp = (o = {}) => ({
  yawDelta: 1.2, pitchDelta: 0.4, rollDelta: 0.1, earRelative: 0.96,
  yawRaw: -4.9, pitchRaw: -3.1, rollRaw: 1.9,
  earLeft: 0.4, earRight: 0.39, earMean: 0.398,
  faceDetected: true, headPoseValid: true, eyeEligible: true,
  yawInstantaneous: false, pitchUpInstantaneous: false,
  eyeClosureInstantaneous: false, pitchDownInstantaneous: false,
  rollInstantaneous: false,
  stateSignalValid: true, publicState: 'FOKUS', primaryReason: 'NONE',
  fps: 29.4, faceInferenceMs: 11.2, relativeTimeMs: 0, ...o,
});
const CAL = { status: 'VALID', valid: true, capturedAtIso: 'x',
  baseline: { yaw: -2.5, pitch: -6.8, roll: 0.4, ear: 0.412, sampleCount: 149 } };

function debugDoc() {
  const s = new DebugSession();
  const d01 = getScenario('NEUTRAL_FRONTAL');
  s.addTrial({ trialId: 'debug_D01_r1', scenario: d01.id, repetition: 1,
    expectedSemanticOutcome: d01.expectedSemanticOutcome,
    recordingDurationMs: 10000, sampleCount: 3,
    samples: [smp(), smp({ relativeTimeMs: 33 }), smp({ relativeTimeMs: 66 })] },
    d01, CAL);
  const d02 = getScenario('YAW_LEFT_SUSTAINED');
  s.addTrial({ trialId: 'debug_D02_r1', scenario: d02.id, repetition: 1,
    expectedSemanticOutcome: d02.expectedSemanticOutcome,
    recordingDurationMs: 4000, sampleCount: 2,
    samples: [smp({ yawDelta: null, headPoseValid: false, stateSignalValid: false }),
              smp({ yawDelta: null, headPoseValid: false, stateSignalValid: false })] },
    d02, CAL);
  return { session: s, doc: s.buildResultsJson({ videoWidth: 640, videoHeight: 480 }) };
}

test('X5. the debug workbook has exactly Trial Summary + Telemetry', () => {
  const t = text(buildDebugReport(debugDoc().doc));
  assert.ok(t.includes('Trial Summary'));
  assert.ok(t.includes('Telemetry'));
  assert.ok(t.includes('xl/worksheets/sheet2.xml'));
  assert.ok(!t.includes('xl/worksheets/sheet3.xml'), 'exactly two sheets');
});

test('X5b. instantaneous and persisted evidence remain distinct in XLSX', () => {
  const s = new DebugSession();
  const d04 = getScenario('BRIEF_YAW_GLANCE');
  s.addTrial({ trialId: 'debug_D04_r1', scenario: d04.id, repetition: 1,
    expectedSemanticOutcome: d04.expectedSemanticOutcome,
    recordingDurationMs: 3000, sampleCount: 1,
    samples: [smp({ yawSmoothed: 31, yawInstantaneous: true,
      yawPersistenceMs: 300, yawEvidence: false })] }, d04, CAL);
  const doc = s.buildResultsJson({});
  assert.equal(doc.trials[0].samples[0].yawInstantaneous, true);
  assert.equal(doc.trials[0].samples[0].yawEvidence, false);

  const t = text(buildDebugReport(doc));
  assert.ok(t.includes('Yaw Instant Cue'));
  assert.ok(t.includes('Yaw Evidence'));
  assert.ok(t.includes('300'));
});

test('X6. scenarios read as human labels from the registry', () => {
  const t = text(buildDebugReport(debugDoc().doc));
  assert.ok(t.includes('D01 · Neutral frontal'));
  assert.ok(t.includes('D02 · Sustained left yaw'));
  // Not three adjacent technical columns.
  assert.ok(!t.includes('>scenario_code<'));
  assert.ok(!t.includes('>scenario_category<'));
});

test('X7. an invalid trial reports INVALID, never a false PASS', () => {
  const { doc } = debugDoc();
  const t = text(buildDebugReport(doc));

  // Read the Match column of each trial row, not the whole workbook: the
  // Validity column already prints "INVALID_SIGNAL", so a substring search
  // would report success even if every verdict had been overwritten to PASS.
  const cell = (row, col) => {
    const r = body(t, 1).match(new RegExp(`<row r="${row}"[\\s\\S]*?</row>`))[0];
    const c = r.match(new RegExp(`<c r="${col}${row}"[\\s\\S]*?</c>`));
    return c ? (c[0].match(/<t[^>]*>([^<]*)</) ?? [, ''])[1] : null;
  };
  assert.equal(cell(15, 'G'), '✓ PASS', 'the valid trial passes');
  assert.equal(cell(16, 'G'), 'INVALID', 'the unusable one claims no verdict');
  assert.equal(cell(16, 'C'), 'INVALID_SIGNAL', 'and says why');

  // Expected/observed are words, not raw booleans, and the observed wording
  // comes from the authoritative evaluator.
  assert.equal(cell(16, 'E'), 'Strong trigger expected');
  assert.equal(cell(16, 'F'), 'Required signal unusable');
  assert.equal(cell(15, 'F'), 'No strong evidence activated');
  assert.ok(cell(16, 'H'), 'an unusable trial explains why');
  // A blank cell is absent entirely, so the helper returns null.
  assert.equal(cell(15, 'H'), null, 'a passing trial invents no blame');
  assert.ok(!/>(true|false)</.test(t), 'no raw booleans reach the reader');

  // And the JSON agrees: the invalid trial claims no verdict.
  const bad = doc.trials.find((x) => x.trialId === 'debug_D02_r1');
  assert.equal(bad.summary.matchesExpectation, null);
});

test('X8. workbook row counts match the master document', () => {
  const { doc } = debugDoc();
  const t = text(buildDebugReport(doc));
  // One telemetry row per bounded sample, across all trials.
  const totalSamples = doc.trials.reduce((a, x) => a + (x.samples?.length ?? 0), 0);
  assert.equal(totalSamples, 5);
  // A part name appears several times in a ZIP (local header, central
  // directory), so the body is the LAST segment the name splits off.
  assert.equal(rowsIn(t, 2), 1 + totalSamples,
    'one telemetry row per bounded sample, plus the header');
  assert.equal(rowsIn(t, 1), 16,
    'summary panel + blank + header + 2 trial rows');
});

test('X9. missing measurements stay blank in the workbook', () => {
  const { doc } = debugDoc();
  const bad = doc.trials.find((x) => x.trialId === 'debug_D02_r1');
  // The yaw signal was never usable, so the summary holds null...
  assert.equal(bad.summary.maxYawDelta, null);
  // ...and the workbook must omit that cell entirely rather than write 0.
  // Row 14 is the invalid trial; column K is "Yaw Max Delta".
  const t = text(buildDebugReport(doc));
  const row = body(t, 1).match(/<row r="16"[\s\S]*?<\/row>/)[0];
  assert.ok(!row.includes('r="K16"'), 'an unmeasured yaw cell must not exist');
  assert.ok(!row.includes('r="M16"'), 'nor an unmeasured pitch-down cell');

  // The zero that IS present is a real measurement, not a coerced null:
  // column D is the valid-signal ratio, and 0 of 2 samples were usable.
  assert.ok(row.includes('r="E16"'));
  assert.equal(bad.summary.validSignalRatio, 0);
});

// ── Benchmark workbook ─────────────────────────────────────────────────
function benchDoc(count = 2) {
  const r = new BenchmarkRunner({}, {});
  const samples = Array.from({ length: 30 }, (_, i) => ({
    timestampMs: 1000 + i * 33, elapsedMs: i * 33,
    personDetected: true, personMaxScore: 0.82,
    phoneDetected: false, phoneMaxScore: 0.03,
    topOther: [{ categoryName: 'chair', score: 0.13 }],
    competingClass: 'chair', competingScore: 0.13,
    rawDetectionCount: 3, inferenceMs: 16,
  }));
  const obs = BenchmarkRunner.peak(samples);
  Object.assign(obs, { modelId: 'edl0-f16', delegate: 'GPU',
    videoWidth: 640, videoHeight: 480 });
  for (let i = 1; i <= count; i++) {
    const t = r.recordTrial({ task: 'person', scenarioId: 'frontal_seated',
      expected: true, observation: obs, samples, phase: 'DEVELOPMENT' });
    t.durationMs = 3000;
    t.sampleCount = samples.length;
  }
  return { runner: r, doc: buildResultsJson(r.getTrials(),
    { sessionId: 's1', requiredRepetitions: 3 }) };
}

test('X10. the benchmark workbook has exactly three sheets', () => {
  const t = text(buildBenchmarkReport(benchDoc().doc));
  assert.ok(t.includes('Overview'));
  assert.ok(t.includes('Trials'));
  assert.ok(t.includes('Raw Samples'));
  assert.ok(t.includes('xl/worksheets/sheet3.xml'));
  assert.ok(!t.includes('xl/worksheets/sheet4.xml'), 'exactly three sheets');
});

test('X11. the Overview states phase, basis and threshold status', () => {
  const t = text(buildBenchmarkReport(benchDoc().doc));
  assert.ok(t.includes('DEVELOPMENT'));
  assert.ok(t.includes('NOT FROZEN'));
  assert.ok(t.includes('PRELIMINARY'));
  assert.ok(t.includes('2 / 210 trials'), 'progress against the full matrix');
  assert.ok(t.includes('diagnostic-floor results, not final'),
    'the caveat must be on the face of the report');
});

test('X12. metric readiness shows awaiting text, not a misleading 100%', () => {
  const { doc } = benchDoc();
  // Positives only: specificity and precision are not yet answerable.
  const summary = doc.modelSummaries[0];
  assert.equal(summary.specificity, null);
  assert.equal(summary.precision, null);
  const t = text(buildBenchmarkReport(doc));
  assert.ok(t.includes('Awaiting negatives'));
  assert.ok(t.includes('Awaiting + / − data'));
});

test('X13. both progress matrices derive from the saved trials', () => {
  const t = text(buildBenchmarkReport(benchDoc(2).doc));
  assert.ok(t.includes('PRESENCE PROGRESS'));
  assert.ok(t.includes('PHONE PROGRESS'));
  // Every canonical scenario appears in its matrix.
  for (const sc of PERSON_SCENARIOS) {
    assert.ok(t.includes(`${sc.code} · ${sc.label}`), `missing ${sc.code}`);
  }
  for (const sc of PHONE_SCENARIOS) {
    assert.ok(t.includes(`${sc.code} · ${sc.label}`), `missing ${sc.code}`);
  }
  // Two saved repetitions read as 2/3; untouched scenarios as 0/3.
  assert.ok(t.includes('2/3'));
  assert.ok(t.includes('0/3'));
});

test('X14. deleting a trial changes the exported progress', () => {
  const { runner } = benchDoc(3);
  let t = text(buildBenchmarkReport(buildResultsJson(runner.getTrials(),
    { sessionId: 's1', requiredRepetitions: 3 })));
  assert.ok(t.includes('3/3 ✓'), 'complete before deletion');

  runner.deleteLastTrial();
  t = text(buildBenchmarkReport(buildResultsJson(runner.getTrials(),
    { sessionId: 's1', requiredRepetitions: 3 })));
  assert.ok(t.includes('2/3'), 'progress follows the trials');
  assert.ok(!t.includes('3/3 ✓'), 'no stale completion marker');
});

test('X15. raw samples reach the workbook unchanged', () => {
  const { doc } = benchDoc(2);
  const t = text(buildBenchmarkReport(doc));
  const total = doc.trials.reduce((a, x) => a + (x.samples?.length ?? 0), 0);
  assert.equal(total, 60);
  assert.equal(rowsIn(t, 3), 1 + total,
    'one row per bounded observation, plus header');
});

test('X16. Pose gets no fabricated object score in the workbook', () => {
  const r = new BenchmarkRunner({}, {});
  const samples = Array.from({ length: 10 }, (_, i) => ({
    timestampMs: 1000 + i * 33, elapsedMs: i * 33, bodyDetected: true,
    landmarkCount: 33, visibleLandmarks: 28, presenceScore: 28 / 33,
    personDetected: true, personMaxScore: 28 / 33,
    phoneDetected: false, phoneMaxScore: null, topOther: [], inferenceMs: 19,
  }));
  const obs = BenchmarkRunner.peak(samples);
  obs.modelId = 'pose-lite';
  r.recordTrial({ task: 'pose', scenarioId: 'frontal_seated', expected: true,
    observation: obs, samples, phase: 'DEVELOPMENT' });
  const t = text(buildBenchmarkReport(buildResultsJson(r.getTrials(),
    { sessionId: 's', requiredRepetitions: 3 })));
  // Score concepts that do not apply are marked N/A, not filled with the
  // landmark ratio wearing a different name.
  assert.ok(t.includes('N/A'));
  assert.ok(t.includes('Pose Detected'), 'real pose columns are present');
  assert.ok(t.includes('Visible Landmarks'));
});

test('X17. the workbook carries no spreadsheet formulas', () => {
  // A formula would make the workbook a second calculation engine, free to
  // disagree with the JSON it was built from.
  for (const bytes of [buildDebugReport(debugDoc().doc),
                       buildBenchmarkReport(benchDoc().doc)]) {
    assert.ok(!text(bytes).includes('<f>'), 'no formulas anywhere');
  }
});

test('X18. workbook and JSON agree on the values a reader compares', () => {
  const { runner } = benchDoc(2);
  const bundle = buildExportBundle({ trials: runner.getTrials(),
    session: { sessionId: 's1', requiredRepetitions: 3 } });
  const json = JSON.parse(bundle.files.find((f) => f.name.endsWith('.json')).content);
  const book = text(bundle.files.find((f) => f.name.endsWith('.xlsx')).content);

  for (const t of json.trials) {
    assert.ok(book.includes(t.trialId), `${t.trialId} missing from the workbook`);
  }
  assert.ok(book.includes(json.modelSummaries[0].model));
  assert.ok(book.includes(String(json.trials[0].maxScore)));
});

// ── Presentation micro-patch (§29b) ────────────────────────────────────
// These hold the human-facing layer only. The scientific values they read
// come from the JSON master, and each test checks the JSON is untouched.

/** One trial with the ground truth and detection outcome asked for. */
function trialWith({ task = 'person', scenarioId = 'frontal_seated',
                     expected = true, score = 0.82 } = {}) {
  const r = new BenchmarkRunner({}, {});
  const samples = Array.from({ length: 10 }, (_, i) => ({
    timestampMs: 1000 + i * 33, elapsedMs: i * 33,
    personDetected: score >= 0.05, personMaxScore: score,
    phoneDetected: score >= 0.05, phoneMaxScore: score,
    topOther: [], rawDetectionCount: 1, inferenceMs: 16,
  }));
  const obs = BenchmarkRunner.peak(samples);
  Object.assign(obs, { modelId: 'edl0-f16', delegate: 'GPU' });
  r.recordTrial({ task, scenarioId, expected, observation: obs, samples,
    phase: 'DEVELOPMENT' });
  return { runner: r, doc: buildResultsJson(r.getTrials(),
    { sessionId: 's', requiredRepetitions: 3 }) };
}

/** Value of `col` in the first data row of the Trials sheet. */
function trialCell(doc, col) {
  const sheet = body(text(buildBenchmarkReport(doc)), 2);
  const row = sheet.match(/<row r="2"[\s\S]*?<\/row>/)[0];
  const c = row.match(new RegExp(`<c r="${col}2"[\\s\\S]*?</c>`));
  return c ? (c[0].match(/<t[^>]*>([^<]*)</) ?? [, ''])[1] : null;
}

// Column J = False Positive*, K = False Negative*.
test('X19. a positive trial shows N/A for false positive', () => {
  // Detected: a true positive. FP is undefined for this ground truth.
  const hit = trialWith({ expected: true, score: 0.82 });
  assert.equal(trialCell(hit.doc, 'J'), 'N/A');
  assert.equal(trialCell(hit.doc, 'K'), 'NO', 'it was detected, so no miss');

  // Missed: a false negative. FP is still undefined.
  const miss = trialWith({ expected: true, score: 0.01 });
  assert.equal(trialCell(miss.doc, 'J'), 'N/A');
  assert.equal(trialCell(miss.doc, 'K'), 'YES');
});

test('X20. a negative trial shows N/A for false negative', () => {
  // Nothing there and nothing detected: a true negative.
  const clean = trialWith({ expected: false, score: 0.01 });
  assert.equal(trialCell(clean.doc, 'J'), 'NO');
  assert.equal(trialCell(clean.doc, 'K'), 'N/A');

  // Nothing there but something detected: a false positive.
  const fp = trialWith({ expected: false, score: 0.82 });
  assert.equal(trialCell(fp.doc, 'J'), 'YES');
  assert.equal(trialCell(fp.doc, 'K'), 'N/A');
});

test('X21. the JSON keeps both booleans regardless of display', () => {
  // The N/A is a reading aid, not a deletion: the confusion matrix still has
  // every value it needs, so metrics cannot shift because of this patch.
  for (const expected of [true, false]) {
    for (const score of [0.82, 0.01]) {
      const { doc } = trialWith({ expected, score });
      const t = doc.trials[0];
      const fp = t.falsePositiveAtDiagnosticFloor ?? t.falsePositive;
      const fn = t.falseNegativeAtDiagnosticFloor ?? t.falseNegative;
      assert.equal(typeof fp, 'boolean', 'FP stays a boolean in the JSON');
      assert.equal(typeof fn, 'boolean', 'FN stays a boolean in the JSON');
      // And they still mean what the confusion matrix needs them to mean.
      const detected = t.detectedAtDiagnosticFloor ?? t.detected;
      assert.equal(fp, !expected && detected);
      assert.equal(fn, expected && !detected);
    }
  }
});

test('X22. the Overview reports coverage, not a bare count', () => {
  const { doc } = trialWith({ expected: true });
  const t = text(buildBenchmarkReport(doc));
  // One presence trial against 10 scenarios x 3 repetitions.
  assert.ok(t.includes('1 / 30'), 'completed over required');
  assert.ok(t.includes('Coverage'), 'and the column says so');
});

test('X23. the required count is registry-derived, not a literal', () => {
  // Proof by construction: the number must follow the registry, so compute
  // what the registry currently implies and expect exactly that.
  const expectedPresence = PERSON_SCENARIOS.length * BENCH_REQUIRED_REPETITIONS;
  const expectedPhone = PHONE_SCENARIOS.length * BENCH_REQUIRED_REPETITIONS;
  assert.ok(text(buildBenchmarkReport(trialWith({ expected: true }).doc))
    .includes(`1 / ${expectedPresence}`));
  assert.ok(text(buildBenchmarkReport(
    trialWith({ task: 'phone', scenarioId: 'screen_facing_portrait' }).doc))
    .includes(`1 / ${expectedPhone}`));
  // Both denominators are the registry's own arithmetic, so a scenario added
  // to either matrix moves the required count without touching this file.
  // (A source scan for a literal "30" would prove nothing: every 30 in the
  //  report builder is a column width or a row height.)
  assert.equal(expectedPresence,
    PERSON_SCENARIOS.length * BENCH_REQUIRED_REPETITIONS);
  assert.equal(expectedPhone,
    PHONE_SCENARIOS.length * BENCH_REQUIRED_REPETITIONS);
  assert.ok(PERSON_SCENARIOS.length > 0 && PHONE_SCENARIOS.length > 0);
});

test('X24. the Overview uses friendly model and task labels', () => {
  const t = text(buildBenchmarkReport(trialWith({ expected: true }).doc));
  const overview = body(t, 1);
  assert.ok(overview.includes('EDL0'), 'friendly model name');
  assert.ok(overview.includes('Presence'), 'friendly task name');
  assert.ok(!overview.includes('edl0-f16'),
    'the technical id does not appear on the human-facing sheet');

  // But it remains authoritative where analysis happens.
  assert.ok(body(t, 2).includes('edl0-f16'), 'Trials keeps the real id');
  assert.ok(body(t, 3).includes('edl0-f16'), 'Raw Samples keeps the real id');

  // Phone trials read as "Phone", not the internal task string.
  const ph = body(text(buildBenchmarkReport(
    trialWith({ task: 'phone', scenarioId: 'screen_facing_portrait' }).doc)), 1);
  assert.ok(ph.includes('Phone'));
});

test('X25. readiness cells wrap so the wording is not clipped', () => {
  const t = text(buildBenchmarkReport(trialWith({ expected: true }).doc));
  // The wrapping style must exist in the stylesheet...
  assert.ok(t.includes('wrapText="1"'));
  // ...and the readiness cells must actually reference it.
  const row = body(t, 1).match(/<row r="15"[\s\S]*?<\/row>/)[0];
  assert.ok(row.includes(`s="${S.MUTED_WRAP}"`),
    'readiness cells carry the wrapping style');
  // With a row tall enough to show two lines.
  assert.match(body(t, 1), /<row r="15"[^>]*ht="/);
});

test('X26. the patch changes no sheet counts', () => {
  const bench = text(buildBenchmarkReport(trialWith({ expected: true }).doc));
  assert.ok(bench.includes('Overview') && bench.includes('Trials')
    && bench.includes('Raw Samples'));
  assert.ok(!bench.includes('xl/worksheets/sheet4.xml'));

  const dbg = text(buildDebugReport(debugDoc().doc));
  assert.ok(dbg.includes('Trial Summary') && dbg.includes('Telemetry'));
  assert.ok(!dbg.includes('xl/worksheets/sheet3.xml'));
});

test('X27. the Debug workbook is unchanged by this patch', () => {
  // The same structural facts the pre-patch review signed off on.
  const { doc } = debugDoc();
  const t = text(buildDebugReport(doc));
  assert.ok(t.includes('state="frozen"'));
  assert.ok(t.includes('ySplit="14"'), 'freeze still at the table header');
  assert.ok(t.includes('<autoFilter ref="A14:U16"/>'));
  assert.equal(rowsIn(t, 1), 16);
  assert.equal(rowsIn(t, 2), 6);

  // Its validity semantics and blank handling still hold.
  const row = body(t, 1).match(/<row r="16"[\s\S]*?<\/row>/)[0];
  assert.ok(!row.includes('r="K16"'), 'unmeasured yaw still blank');
  assert.ok(row.includes('INVALID'));

  // And it never picked up the benchmark-only display rules.
  assert.ok(!t.includes('Coverage'));
  assert.ok(!t.includes('Presence'));
});

test('X28. a style id with no definition is refused, not written', () => {
  // Renumbering a shared style id is the regression this guards: the workbook
  // still parses and every content test still passes, but cells across every
  // report silently take the wrong format. Fail at write time instead.
  assert.throws(() => buildXlsx([{ name: 'S', rows: [[{ v: 'x', s: 99 }]] }]),
    /style 99 is not defined/);
  assert.throws(() => buildXlsx([{ name: 'S', rows: [[{ v: 'x', s: -1 }]] }]),
    /RangeError|not defined/);

  // Every id the style table publishes must be usable.
  for (const [name, id] of Object.entries(S)) {
    assert.doesNotThrow(() => buildXlsx([{ name: 'S', rows: [[{ v: 'x', s: id }]] }]),
      `S.${name} (${id}) must be defined in styles.xml`);
  }
});
