/**
 * Scenario registry tests (spec §16, §17).
 *
 * There must be exactly ONE authoritative definition per mode, and every
 * consumer — selector UI, capture card, trial metadata, progress, summaries,
 * export — must derive from it. A second hand-maintained copy in the DOM is
 * how a scenario's ground truth silently drifts from what was recorded.
 *
 * These tests select no model, tune no threshold, and rewrite no history.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEBUG_SCENARIOS, DEBUG_GROUPS, DebugCategory, DEBUG_REQUIRED_REPETITIONS,
  getScenario, getScenarioByCode, scenarioConfigSnapshot,
} from '../tools/debug/scenarios.js';
import {
  PERSON_SCENARIOS, PHONE_SCENARIOS, CANDIDATES,
  BENCH_REQUIRED_REPETITIONS, HISTORICAL_SCENARIO_IDS,
} from '../tools/benchmark/candidates.js';
import { requiredScenarios } from '../tools/benchmark/exportResults.js';
import { CONFIG } from '../src/ai/index.js';

const readDebug = () =>
  readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const readBench = () =>
  readFileSync(new URL('../public/benchmark.html', import.meta.url), 'utf8');

// ══ §16 — DEBUG VERIFICATION REGISTRY ═══════════════════════════════════
test('R1. the Debug matrix is exactly D01-D11 with unique ids', () => {
  assert.equal(DEBUG_SCENARIOS.length, 11);
  assert.deepEqual(DEBUG_SCENARIOS.map((s) => s.code),
    ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11']);
  assert.equal(new Set(DEBUG_SCENARIOS.map((s) => s.id)).size, 11, 'ids unique');
  assert.equal(new Set(DEBUG_SCENARIOS.map((s) => s.code)).size, 11, 'codes unique');
  // Every scenario states what it does and what it proves.
  for (const s of DEBUG_SCENARIOS) {
    assert.ok(s.instruction.length > 30, `${s.code} needs a real instruction`);
    assert.ok(s.purpose.length > 20, `${s.code} needs a stated purpose`);
    assert.ok(Array.isArray(s.expectedSemanticBehavior)
      && s.expectedSemanticBehavior.length >= 3, `${s.code} needs expectations`);
  }
});

test('R2. every Debug scenario requires 3 valid repetitions', () => {
  assert.equal(DEBUG_REQUIRED_REPETITIONS, 3);
  for (const s of DEBUG_SCENARIOS) assert.equal(s.requiredRepetitions, 3);
});

test('R3. left and right yaw are distinct, equally-treated scenarios', () => {
  const left = getScenario('YAW_LEFT_SUSTAINED');
  const right = getScenario('YAW_RIGHT_SUSTAINED');
  assert.ok(left && right && left.id !== right.id, 'two separate scenarios');
  assert.equal(left.category, DebugCategory.STRONG_EVIDENCE);
  assert.equal(right.category, DebugCategory.STRONG_EVIDENCE);
  assert.equal(left.triggerExpected, true);
  assert.equal(right.triggerExpected, true);
  // Same observation time, or the matrix would bias the very asymmetry it
  // exists to detect.
  assert.equal(left.recordingDurationMs, right.recordingDurationMs);
  assert.match(left.instruction, /LEFT/);
  assert.match(right.instruction, /RIGHT/);
});

test('R4. the brief glance must NOT expect evidence to latch', () => {
  const s = getScenario('BRIEF_YAW_GLANCE');
  assert.equal(s.category, DebugCategory.TEMPORAL_CONTROL);
  assert.equal(s.triggerExpected, false);
  // The window must OUTLAST the persistence rule. A shorter window cannot
  // distinguish "the glance was too brief" from "the trial ended too soon" —
  // evidence could not have latched either way, so a pass proved nothing.
  // Running past the rule makes the absence of evidence a real result.
  assert.ok(s.recordingDurationMs > CONFIG.state.YAW_PERSIST_MS,
    'the window must outlast persistence, or a pass is vacuous');
  assert.ok(s.expectedSemanticBehavior.some((x) => /must NOT latch/i.test(x)));
  // Direction-agnostic: D02/D03 own laterality, D04 owns duration.
  assert.match(s.instruction, /EITHER side/i);
});

test('R5. pitch-down and head tilt are SUPPORT-only', () => {
  for (const id of ['PITCH_DOWN_STUDY_LIKE', 'HEAD_TILT']) {
    const s = getScenario(id);
    assert.equal(s.category, DebugCategory.SUPPORT_EVIDENCE, id);
    assert.equal(s.triggerExpected, false, `${id} must not expect a trigger`);
    assert.ok(s.expectedSemanticBehavior.some(
      (x) => /must NOT independently create TERALIH/i.test(x)),
      `${id} must state support-only semantics`);
  }
  // Head Tilt is the user-facing term; roll stays internal.
  assert.match(getScenario('HEAD_TILT').expectedSemanticBehavior.join(' '),
    /roll angle; the UI says "Head Tilt"/);
});

test('R6. blinking and sustained closure are different scenarios', () => {
  const blink = getScenario('NORMAL_BLINK');
  const closed = getScenario('SUSTAINED_EYE_CLOSURE');
  assert.equal(blink.category, DebugCategory.EYE_CONTROL);
  assert.equal(blink.triggerExpected, false, 'a blink is not closure evidence');
  assert.ok(blink.expectedSemanticBehavior.some(
    (x) => /must NOT complete/i.test(x)));

  assert.equal(closed.category, DebugCategory.STRONG_EVIDENCE);
  assert.equal(closed.triggerExpected, true);
  // Closure evidence is only meaningful while the eye signal is trustworthy.
  assert.ok(closed.expectedSemanticBehavior.some((x) => /ELIGIBLE/i.test(x)),
    'closure must require a valid eye signal');
  // The instruction must be unambiguous about WHEN to close and for HOW LONG:
  // pilot failures were operators releasing early, not the rule misfiring.
  assert.match(closed.instruction, /close both eyes/i);
  assert.match(closed.instruction, /until the trial ends/i);
  assert.match(closed.instruction, /frontal/i, 'pose eligibility still matters');
});

test('R7. face dropout is not defined as physical absence', () => {
  const s = getScenario('FACE_DROPOUT_RECOVERY');
  assert.equal(s.category, DebugCategory.SIGNAL_VALIDITY);
  assert.equal(s.triggerExpected, false);
  assert.match(s.purpose, /not proof that the user physically left/i);
  assert.ok(s.expectedSemanticBehavior.some(
    (x) => /NOT treated here as physical absence/i.test(x)));
  // And it must not claim to validate the perception layer.
  assert.match(s.purpose, /does NOT validate final PresenceFusion/i);
});

test('R8. realistic study posture is not automatic distraction', () => {
  const s = getScenario('READING_WRITING');
  assert.equal(s.category, DebugCategory.REALISTIC_STUDY);
  assert.equal(s.triggerExpected, false);
  assert.ok(s.expectedSemanticBehavior.some(
    (x) => /must not automatically create TERALIH/i.test(x)));
});

test('R9. Debug scenario text holds no duplicated numeric thresholds', () => {
  // A second copy of "25°" or "1500 ms" in an instruction rots the moment the
  // engine changes. Instructions stay qualitative; the UI renders live values.
  const s = CONFIG.state;
  const numbers = [s.STRONG_YAW_DELTA_DEG, s.STRONG_UP_PITCH_DELTA_DEG,
    s.YAW_PERSIST_MS, s.PITCH_UP_PERSIST_MS, s.EYE_CLOSED_PERSIST_MS];
  const prose = DEBUG_SCENARIOS
    .map((x) => `${x.instruction} ${x.purpose} ${x.expectedSemanticBehavior.join(' ')}`)
    .join(' ');
  for (const n of numbers) {
    assert.ok(!new RegExp(`\\b${n}\\s*(°|deg|ms)`, 'i').test(prose),
      `scenario prose hard-codes the configured value ${n}`);
  }
  assert.match(prose, /configured/i, 'prose must defer to the configured rule');
});

test('R10. durations derive from CONFIG, not from literals', () => {
  const s = CONFIG.state;
  assert.ok(getScenario('YAW_LEFT_SUSTAINED').recordingDurationMs > s.YAW_PERSIST_MS);
  assert.ok(getScenario('PITCH_UP_SUSTAINED').recordingDurationMs > s.PITCH_UP_PERSIST_MS);
  assert.ok(getScenario('SUSTAINED_EYE_CLOSURE').recordingDurationMs > s.EYE_CLOSED_PERSIST_MS);
  // D04 outlasts its rule too: see R4 for why a short window is vacuous.
  assert.ok(getScenario('BRIEF_YAW_GLANCE').recordingDurationMs > s.YAW_PERSIST_MS);
});

test('R11. the Debug selector is generated from the registry', () => {
  const html = readDebug();
  const js = html.slice(html.indexOf('<script type="module">'));
  assert.match(js, /for \(const sc of DEBUG_SCENARIOS\.filter/,
    'the catalogue must iterate the registry');
  assert.match(js, /sc\.code/, 'it must render the registry code');
  assert.match(js, /sc\.purpose/, 'and the registry purpose');
  // No hand-maintained duplicate list in the markup.
  const markup = html.slice(0, html.indexOf('<script type="module">'));
  for (const s of DEBUG_SCENARIOS) {
    assert.ok(!markup.includes(s.id),
      `${s.id} is hard-coded in the DOM instead of coming from the registry`);
  }
});

test('R12. the selector signals progress compactly', () => {
  const html = readDebug();
  const js = html.slice(html.indexOf('<script type="module">'));
  const fn = js.slice(js.indexOf('function renderScenarioModal'),
                      js.indexOf('function renderProgressModal'));
  // A picker needs done/required and a colour, not a sentence per row.
  assert.match(fn, /\$\{done\}\/\$\{req\}/, 'each row shows done/required');
  assert.match(fn, /var\(--ok\)/, 'complete is colour-coded');
  assert.match(fn, /var\(--warn\)/, 'in-progress is colour-coded');
  assert.match(fn, /var\(--faint\)/, 'not-started is colour-coded');
});

test('R13. the Debug matrix carries no DEVELOPMENT/VALIDATION phase', () => {
  // Phase belongs to the Benchmark alone: Debug Verification does not select a
  // model and cannot derive an operating threshold, so the distinction would
  // be meaningless here and only invite mis-filing.
  const snapshot = scenarioConfigSnapshot();
  const blob = JSON.stringify(snapshot);
  assert.ok(!/DEVELOPMENT|VALIDATION/.test(blob));
  for (const s of DEBUG_SCENARIOS) assert.equal(s.phase, undefined);
  assert.equal(snapshot.length, 11, 'the protocol snapshot covers the matrix');
  assert.equal(getScenarioByCode('D09').id, 'SUSTAINED_EYE_CLOSURE');
  assert.deepEqual(DEBUG_GROUPS, [...new Set(DEBUG_SCENARIOS.map((s) => s.category))]);
});

// ══ §17 — BENCHMARK REGISTRY ════════════════════════════════════════════
test('R14. the presence matrix is exactly P01-P10 with correct truth', () => {
  assert.equal(PERSON_SCENARIOS.length, 10);
  assert.deepEqual(PERSON_SCENARIOS.map((s) => s.code),
    ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10']);
  for (const s of PERSON_SCENARIOS.slice(0, 8)) {
    assert.equal(s.expect, true, `${s.code} must be PRESENT`);
  }
  for (const s of PERSON_SCENARIOS.slice(8)) {
    assert.equal(s.expect, false, `${s.code} must be ABSENT`);
  }
  assert.equal(PERSON_SCENARIOS[9].id, 'empty_study_area');
  // The hard negative must describe a furnished but empty area.
  assert.match(PERSON_SCENARIOS[9].instruction, /desk, chair, books, bag/i);
});

test('R15. the phone matrix is exactly H01-H10 with correct truth', () => {
  assert.equal(PHONE_SCENARIOS.length, 10);
  assert.deepEqual(PHONE_SCENARIOS.map((s) => s.code),
    ['H01', 'H02', 'H03', 'H04', 'H05', 'H06', 'H07', 'H08', 'H09', 'H10']);
  for (const s of PHONE_SCENARIOS.slice(0, 8)) {
    assert.equal(s.expect, true, `${s.code} must be PHONE PRESENT`);
  }
  for (const s of PHONE_SCENARIOS.slice(8)) {
    assert.equal(s.expect, false, `${s.code} must be PHONE ABSENT`);
  }
  // H07 is presence only — a phone on the desk is not evidence of distraction.
  assert.match(PHONE_SCENARIOS[6].purpose, /do NOT infer distraction/i);
});

test('R16. H10 is the standardised phone-lookalike hard negative', () => {
  const h10 = PHONE_SCENARIOS[9];
  assert.equal(h10.id, 'phone_lookalike_negative');
  assert.equal(h10.expect, false);
  assert.match(h10.instruction, /PHONE ABSENT/);
  assert.match(h10.instruction, /Never use a real phone/i);
  // A fixed object sequence, or repetitions are not comparable.
  assert.match(h10.instruction, /remote control|calculator/i);
  assert.match(h10.instruction, /tissue|card|packet/i);
  assert.match(h10.instruction, /book|package/i);
  assert.match(h10.instruction, /same objects and order/i);
});

test('R17. historical ids are preserved, never silently rewritten', () => {
  // A trial recorded as `non_phone_rectangle` ran a vaguer protocol. Mapping it
  // onto H10 would fabricate comparability that was never collected.
  const hist = HISTORICAL_SCENARIO_IDS.non_phone_rectangle;
  assert.ok(hist, 'the retired id must be documented');
  assert.equal(hist.supersededBy, 'phone_lookalike_negative');
  assert.match(hist.reason, /not.*comparable|must not be pooled/i);
  // And it must not reappear as a live scenario.
  assert.ok(!PHONE_SCENARIOS.some((s) => s.id === 'non_phone_rectangle'));
  // No code anywhere rewrites the old id onto the new one.
  for (const file of ['../tools/benchmark/exportResults.js',
                      '../tools/benchmark/BenchmarkRunner.js',
                      '../public/benchmark.html']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/non_phone_rectangle['"]?\s*[:=]\s*['"]phone_lookalike/.test(src),
      `${file} must not remap the historical id`);
  }
});

test('R18. every candidate shares ONE canonical presence matrix', () => {
  // Object detectors read it as "person", Pose Lite as "presence" — but a
  // comparison across different scenarios is not a comparison.
  assert.equal(requiredScenarios('person'), PERSON_SCENARIOS);
  assert.equal(requiredScenarios('pose'), PERSON_SCENARIOS);
  assert.equal(requiredScenarios('phone'), PHONE_SCENARIOS);
  assert.equal(requiredScenarios('person').length, 10);
  assert.equal(requiredScenarios('pose').length, 10);
});

test('R19. Pose Lite cannot select PHONE scenarios', () => {
  const pose = CANDIDATES.find((c) => c.id === 'pose-lite');
  assert.equal(pose.task, 'pose', 'Pose Lite is presence-only');
  const js = readBench();
  assert.match(js, /\$\('taskPhone'\)\.disabled = isPose\(\)/,
    'the PHONE task must be disabled for pose candidates');
});

test('R20. ground truth is registry-owned, not operator-editable', () => {
  const html = readBench();
  const js = html.slice(html.indexOf('<script type="module">'));
  // The card displays truth derived from `s.expect`; there is no control to
  // flip it.
  assert.match(js, /const truthLabel = /);
  assert.match(js, /s\.expect \? 'PHONE PRESENT' : 'PHONE ABSENT'/);
  assert.match(js, /s\.expect \? 'PRESENT' : 'ABSENT'/);
  const markup = html.slice(0, html.indexOf('<script type="module">'));
  assert.match(markup, /id="trialTruth"/, 'the card must show ground truth');
  // No editable input or selector for truth.
  assert.ok(!/id="trialTruth"[^>]*<(input|select)/.test(markup));
});

test('R21. benchmark progress totals reflect P01-P10 (210 trials)', () => {
  const reps = BENCH_REQUIRED_REPETITIONS;
  assert.equal(reps, 3);
  const objectDetectors = CANDIDATES.filter((c) => c.task === 'object');
  const poseCandidates = CANDIDATES.filter((c) => c.task === 'pose');
  assert.equal(objectDetectors.length, 3);
  assert.equal(poseCandidates.length, 1);

  const perCandidatePresence = PERSON_SCENARIOS.length * reps;
  const perDetectorPhone = PHONE_SCENARIOS.length * reps;
  assert.equal(perCandidatePresence, 30, 'presence: 10 scenarios x 3');
  assert.equal(perDetectorPhone, 30, 'phone: 10 scenarios x 3');

  const presenceTotal = (objectDetectors.length + poseCandidates.length)
    * perCandidatePresence;
  const phoneTotal = objectDetectors.length * perDetectorPhone;
  assert.equal(presenceTotal, 120);
  assert.equal(phoneTotal, 90);
  assert.equal(presenceTotal + phoneTotal, 210);
});

test('R22. no stale 198 / 27 / "9 scenarios" totals remain', () => {
  for (const file of ['../public/benchmark.html', '../public/index.html',
                      '../tools/benchmark/candidates.js',
                      '../tools/benchmark/exportResults.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/\b198\s*(trials|valid)/i.test(src), `${file} has a stale 198 total`);
    assert.ok(!/\b9\s*(presence\s*)?scenarios\b/i.test(src),
      `${file} claims 9 scenarios`);
    assert.ok(!/\b27\s*trials\b/i.test(src), `${file} has a stale 27-trial count`);
  }
});

test('R23. the phase selector locks once a session holds saved trials', () => {
  const html = readBench();
  const js = html.slice(html.indexOf('<script type="module">'));
  assert.match(js, /function syncPhaseLock/);
  assert.match(js, /runner\.getValidTrials\(\)\.length > 0/,
    'the lock must key on real saved evidence');
  assert.match(js, /sel\.disabled = locked/);
  assert.match(js, /syncPhaseLock\(\)/, 'and be applied on render');
  // Visible to the operator, not just enforced.
  assert.match(html, /id="phaseLock"/);
  // Both phases are offered BEFORE the first trial.
  assert.match(html, /value="DEVELOPMENT"/);
  assert.match(html, /value="VALIDATION"/);
});

test('R24. scenario identity is consistent from registry to export', () => {
  const html = readBench();
  const js = html.slice(html.indexOf('<script type="module">'));
  // The capture card, the trial record and the export all key on the same id.
  assert.match(js, /scenarioId: trial\.scenario/);
  assert.match(js, /id: s\.id/, 'the selection carries the registry id');
  const exp = readFileSync(
    new URL('../tools/benchmark/exportResults.js', import.meta.url), 'utf8');
  assert.match(exp, /requiredScenarios\(task\)/,
    'summaries resolve scenarios through the registry');
});

// ── Catalogue readability ──────────────────────────────────────────────
test('R25. the catalogue is a picker, not a document', () => {
  // Inlining instruction + purpose + expected outcome on every entry made
  // eleven scenarios impossible to scan. The capture card already shows all
  // of that for the ONE scenario actually selected.
  for (const [name, html] of [['debug', readDebug()], ['bench', readBench()]]) {
    const js = html.slice(html.indexOf('<script type="module">'));
    const fn = js.slice(js.indexOf('function renderScenarioModal'),
                        js.indexOf('function renderProgressModal'));
    assert.match(fn, /class="srow"|'srow'/, name + ': entries are compact rows');
    assert.ok(!/class="what"|class="why"/.test(fn),
      name + ': instruction and purpose must not be inlined per row');
    // Still reachable without taking space.
    assert.match(fn, /b\.title = /, name + ': full text stays on hover');
  }
});

test('R26. rows carry code, name and progress only', () => {
  const html = readDebug();
  const js = html.slice(html.indexOf('<script type="module">'));
  const fn = js.slice(js.indexOf('function renderScenarioModal'),
                      js.indexOf('function renderProgressModal'));
  assert.match(fn, /sc\.code/);
  assert.match(fn, /sc\.name/);
  assert.ok(!/sc\.expectedSemanticOutcome/.test(fn),
    'the expected outcome belongs to the capture card, not the picker');
  assert.ok(!/EVIDENCE EXPECTED/.test(fn), 'no verbose badge per row');
});

test('R27. sections give the catalogue its structure', () => {
  // Grouping is what makes a long list readable, so both pages keep it.
  const debugJs = readDebug();
  const dfn = debugJs.slice(debugJs.indexOf('function renderScenarioModal'),
                            debugJs.indexOf('function renderProgressModal'));
  assert.match(dfn, /catbar/, 'debug groups by category');
  assert.match(dfn, /for \(const g of DEBUG_GROUPS\)/);

  const benchJs = readBench();
  const bfn = benchJs.slice(benchJs.indexOf('function renderScenarioModal'),
                            benchJs.indexOf('function renderProgressModal'));
  assert.match(bfn, /catbar/, 'benchmark groups too');
  // Benchmark groups by GROUND TRUTH — the distinction that must not be misread.
  assert.match(bfn, /USER PRESENT|PHONE PRESENT/);
  assert.match(bfn, /USER ABSENT|PHONE ABSENT/);
  assert.match(bfn, /x\.expect/, 'sections derive from registry truth');
});
