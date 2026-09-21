/**
 * Subject provenance + official export package (spec §10).
 *
 * The rule under test: attribution belongs to whoever was selected when the
 * bounded window OPENED, and nothing afterwards may rewrite it. Subject ID
 * follows the same provenance philosophy as `calibrationAtStart` — captured
 * once at Start Trial, immutable thereafter.
 *
 * No AI parameter is read or changed here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { DebugSession } from '../tools/debug/DebugSession.js';
import { DebugHarness } from '../tools/debug/DebugHarness.js';
import { buildDebugReport } from '../tools/debug/debugReport.js';
import { getScenarioByCode } from '../tools/debug/scenarios.js';

const CAL = (yaw = -2) => ({ status: 'VALID', valid: true,
  capturedAtIso: '2026-09-18T01:00:00.000Z',
  baseline: { yaw, pitch: -6, roll: 0, ear: 0.41, sampleCount: 150 } });

const smp = (i = 0) => ({ relativeTimeMs: i * 33, timestampMs: i * 33,
  yawDelta: 1, pitchDelta: 0, rollDelta: 0, earRelative: 0.98,
  faceDetected: true, headPoseValid: true, eyeEligible: true,
  stateSignalValid: true, publicState: 'FOKUS', primaryReason: 'NONE',
  fps: 30, faceInferenceMs: 11 });

/** Save a trial through the session, with an explicit subject snapshot. */
function save(session, code, subjectSnapshot, n = 3) {
  const sc = getScenarioByCode(code);
  const ref = session.nextTrialRef(sc.id);
  return session.addTrial({ trialId: ref.trialId, scenario: sc.id,
    repetition: ref.repetition, recordingDurationMs: 10000, sampleCount: n,
    samples: Array.from({ length: n }, (_, i) => smp(i)) },
    sc, CAL(), subjectSnapshot);
}

/** A harness wired to a fake clock, for the full Start Trial path. */
function harness() {
  const els = {};
  for (const k of ['video', 'status']) els[k] = { textContent: '', style: {} };
  const h = new DebugHarness({ FilesetResolver: {}, FaceLandmarker: {} }, els);
  h.ai.getCalibrationSnapshot = () => CAL();
  h.trials.cameraStarted();
  return h;
}

/**
 * Run one trial end to end. `switchTo` changes the operator's CURRENT subject
 * mid-trial, before the save lands — the mutation this guards against.
 */
function runTrial(h, code, subjectAtStart, switchTo = null) {
  const sc = getScenarioByCode(code);
  h.session.setSubjectId(subjectAtStart);
  h.trials.selectScenario(sc);
  h.startTrial();
  const t0 = h.trials.countdownStartedAt;
  h.trials.tick(t0 + sc.countdownMs + 1);          // -> RECORDING
  const rs = h.trials.recordingStartedAt;
  for (let t = rs + 33; t < rs + 700; t += 33) {
    h.trials.offerSample({ ...smp(), timestampMs: t });
  }
  if (switchTo !== null) h.session.setSubjectId(switchTo);
  h.trials.tick(rs + sc.recordingDurationMs + 50); // -> complete
  return h.lastTrialRecord;
}

// ═══════════════════════════════════════════════════════════════════════
// §3 — the snapshot must be taken at Start Trial
// ═══════════════════════════════════════════════════════════════════════
test('S1. changing the current subject mid-trial does NOT reattribute it', () => {
  // The defect: attribution was read at SAVE time, so an operator advancing to
  // the next subject before the save landed silently stole the finished trial.
  const h = harness();
  const rec = runTrial(h, 'D01', 'S01', 'S02');

  assert.equal(rec.subjectId, 'S01', 'the trial belongs to who performed it');
  assert.equal(h.session.subjectId, 'S02', 'while the UI has moved on');
});

test('S2. the snapshot is captured at Start Trial, not later', () => {
  const h = harness();
  h.session.setSubjectId('S01');
  h.trials.selectScenario(getScenarioByCode('D01'));
  assert.equal(h._pendingSubjectId, null, 'nothing captured before the start');

  h.startTrial();
  assert.equal(h._pendingSubjectId, 'S01', 'captured at the boundary');

  h.session.setSubjectId('S03');
  assert.equal(h._pendingSubjectId, 'S01', 'and immutable afterwards');
});

test('S3. the NEXT trial uses the new subject', () => {
  const h = harness();
  const first = runTrial(h, 'D01', 'S01', 'S02');
  const second = runTrial(h, 'D01', 'S02');
  assert.equal(first.subjectId, 'S01');
  assert.equal(second.subjectId, 'S02');
});

test('S4. prior trials are never rewritten by later subject changes', () => {
  const s = new DebugSession();
  save(s, 'D01', 'S01');
  save(s, 'D01', 'S02');
  const before = s.trials.map((t) => t.subjectId);

  for (const who of ['S03', 'S09', null]) s.setSubjectId(who);

  assert.deepEqual(s.trials.map((t) => t.subjectId), before,
    'history is immutable');
  assert.deepEqual(s.buildResultsJson({}).trials.map((t) => t.subjectId),
    ['S01', 'S02'], 'and the export agrees');
});

test('S5. a trial started without a subject stays blank, never guessed', () => {
  const s = new DebugSession();
  save(s, 'D01', null);              // explicitly no subject at start
  s.setSubjectId('S01');             // operator sets one afterwards

  assert.equal(s.trials[0].subjectId, null, 'no back-fill');
  const doc = s.buildResultsJson({});
  assert.equal(doc.trials[0].subjectId, null);
  // And no invented placeholder anywhere.
  const json = JSON.stringify(doc);
  for (const bad of ['UNKNOWN', 'ANONYMOUS', 'N/A', 'undefined']) {
    assert.ok(!json.includes(`"subjectId":"${bad}"`), `${bad} must not appear`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// §4 — the other Start Trial snapshots still hold
// ═══════════════════════════════════════════════════════════════════════
test('S6. calibration remains immutable across recalibration', () => {
  const s = new DebugSession();
  const sc = getScenarioByCode('D01');
  const first = s.addTrial({ trialId: 't1', scenario: sc.id, repetition: 1,
    recordingDurationMs: 10000, sampleCount: 1, samples: [smp()] },
    sc, CAL(-2.5), 'S01');
  s.calibrationSnapshot = CAL(44);
  const second = s.addTrial({ trialId: 't2', scenario: sc.id, repetition: 2,
    recordingDurationMs: 10000, sampleCount: 1, samples: [smp()] },
    sc, CAL(44), 'S01');

  assert.equal(first.calibrationAtStart.baseline.yaw, -2.5);
  assert.equal(second.calibrationAtStart.baseline.yaw, 44);
});

test('S7. the config/protocol snapshot is captured with the session', () => {
  const s = new DebugSession();
  save(s, 'D01', 'S01');
  const doc = s.buildResultsJson({});
  for (const k of ['state', 'temporal', 'calibration', 'validity', 'headPose',
                   'eyeEligibility']) {
    assert.ok(k in doc.config, `config snapshot missing ${k}`);
  }
  assert.ok(doc.protocolVersion, 'protocol version recorded');
  assert.equal(doc.scenarios.length, 11, 'the full protocol travels with it');
  // Real window boundaries, not one save-time stamp.
  assert.notEqual(doc.trials[0].recordingStartedAtIso,
    doc.trials[0].recordingEndedAtIso);
});

// ═══════════════════════════════════════════════════════════════════════
// §7 / §8 — provenance in JSON and XLSX
// ═══════════════════════════════════════════════════════════════════════
test('S8. per-trial attribution survives export, and outranks the session', () => {
  const s = new DebugSession();
  save(s, 'D01', 'S01');
  save(s, 'D01', 'S02');
  s.setSubjectId('S03');             // mutable operator context only

  const doc = s.buildResultsJson({});
  assert.deepEqual(doc.trials.map((t) => t.subjectId), ['S01', 'S02'],
    'trial-level truth is per-trial');
  assert.equal(doc.session.subjectId, 'S03',
    'session metadata reports the current selection...');
  // ...and must never be read as "all trials belong to S03".
  assert.ok(!doc.trials.every((t) => t.subjectId === doc.session.subjectId));
});

test('S9. the workbook shows each trial its own subject', () => {
  const s = new DebugSession();
  save(s, 'D01', 'S01');
  save(s, 'D01', 'S02');
  s.setSubjectId('S03');

  const xml = new TextDecoder().decode(buildDebugReport(s.buildResultsJson({})));
  const sheets = [...xml.matchAll(/<sheetData>([\s\S]*?)<\/sheetData>/g)];
  const summary = sheets[0][1];
  const telemetry = sheets[1][1];

  assert.ok(xml.includes('Subject'), 'Trial Summary has a Subject column');
  for (const who of ['S01', 'S02']) {
    assert.ok(summary.includes(`>${who}<`), `${who} must appear in the summary`);
    assert.ok(telemetry.includes(`>${who}<`), `${who} must appear in telemetry`);
  }
  // The current selection performed no trial, so it must appear nowhere.
  assert.ok(!summary.includes('>S03<'), 'the session selection is not attribution');
  assert.ok(!telemetry.includes('>S03<'));
});

test('S10. the workbook exposes no personal data', () => {
  const s = new DebugSession();
  save(s, 'D01', 'S01');
  const xml = new TextDecoder().decode(buildDebugReport(s.buildResultsJson({})));
  // A pseudonymous code is the only identity the dataset carries.
  assert.ok(!/@[a-z]+\.[a-z]{2,}/i.test(xml), 'no email addresses');
  assert.ok(!/\b\d{9,}\b/.test(xml), 'no long digit strings (phone-like)');
});

// ═══════════════════════════════════════════════════════════════════════
// §5 / §6 — the official export package
// ═══════════════════════════════════════════════════════════════════════
test('S11. the normal export is exactly JSON + XLSX', () => {
  const s = new DebugSession();
  save(s, 'D01', 'S01');
  const b = s.buildExportBundle({});

  assert.deepEqual(b.files.map((f) => f.name).sort(),
    ['debug_report.xlsx', 'debug_results.json']);
  assert.equal(b.files.length, 2);
  assert.ok(!b.files.some((f) => /\.csv$/i.test(f.name)), 'no CSV in the ZIP');
  assert.match(b.archiveName, /\.zip$/);
});

test('S12. no user-facing surface advertises a CSV export', async () => {
  // The ZIP was already correct; the page and help text still described files
  // it no longer produces, which is its own kind of false provenance claim.
  const { readFileSync } = await import('node:fs');
  for (const rel of ['../public/index.html', '../tools/debug/help.js',
                     '../tools/shared/help.js']) {
    const text = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.ok(!/\.csv\b/i.test(text), `${rel} still advertises CSV`);
  }
});

test('S13. CSV helpers may remain for internal use', () => {
  // Retained deliberately: tests and offline tooling read them. They are not
  // part of the official package and carry no authority.
  const s = new DebugSession();
  save(s, 'D01', 'S01');
  assert.ok(typeof s.buildTrialsCsv === 'function');
  assert.ok(s.buildTrialsCsv().includes('subject_id'),
    'and they carry the same attribution');
  assert.ok(s.buildTrialsCsv().split('\n')[1].includes('S01'));
});

test('S14. the JSON alone is a complete record', () => {
  const s = new DebugSession();
  save(s, 'D01', 'S01', 5);
  const doc = s.buildResultsJson({});
  for (const k of ['schemaVersion', 'protocolVersion', 'session', 'environment',
                   'calibration', 'config', 'scenarios', 'progress',
                   'perception', 'trials']) {
    assert.ok(k in doc, `results.json missing ${k}`);
  }
  // Raw evidence is in the JSON, not only in a spreadsheet.
  assert.equal(doc.trials[0].samples.length, 5);
  assert.ok(doc.trials[0].summary.trialVerdict);
  assert.ok(doc.trials[0].calibrationAtStart);
});

// ═══════════════════════════════════════════════════════════════════════
// §9 — readiness for the targeted collection
// ═══════════════════════════════════════════════════════════════════════
test('S15. the 45-trial protocol is representable end to end', () => {
  const s = new DebugSession();
  const CODES = ['D01', 'D06', 'D08', 'D09', 'D11'];
  for (const subj of ['S01', 'S02', 'S03']) {
    for (const code of CODES) for (let r = 0; r < 3; r++) save(s, code, subj);
  }

  const doc = s.buildResultsJson({});
  assert.equal(doc.trials.length, 45);
  for (const subj of ['S01', 'S02', 'S03']) {
    assert.equal(doc.trials.filter((t) => t.subjectId === subj).length, 15,
      `${subj} must own 15 trials`);
  }
  // Every trial carries what a later offline replay needs.
  for (const t of doc.trials) {
    assert.ok(t.subjectId && t.scenarioCode && t.calibrationAtStart);
    assert.ok(t.recordingStartedAtIso !== t.recordingEndedAtIso);
    assert.ok(Array.isArray(t.samples));
  }
});

test('S16. INVALID does not fill a slot; FAIL does — unchanged', () => {
  const s = new DebugSession();
  const sc = getScenarioByCode('D01');
  const shape = {
    PASS: () => Array.from({ length: 30 }, (_, i) => smp(i)),
    FAIL: () => Array.from({ length: 30 }, (_, i) =>
      ({ ...smp(i), yawEvidence: i > 10 })),
    INVALID: () => Array.from({ length: 30 }, (_, i) =>
      ({ ...smp(i), faceDetected: false, headPoseValid: false,
         stateSignalValid: false })),
  };
  for (const want of ['PASS', 'INVALID', 'FAIL', 'INVALID']) {
    const ref = s.nextTrialRef(sc.id);
    s.addTrial({ trialId: ref.trialId, scenario: sc.id,
      repetition: ref.repetition, recordingDurationMs: 10000, sampleCount: 30,
      samples: shape[want]() }, sc, CAL(), 'S01');
  }

  const t = s.scenarioTally('NEUTRAL_FRONTAL');
  // 1 PASS + 1 FAIL = 2 evaluable; the two INVALID attempts fill no slot.
  assert.deepEqual(t, { attempts: 4, evaluable: 2, pass: 1, fail: 1, invalid: 2 });
  assert.equal(s.progress([sc])[0].complete, false,
    'two evaluable repetitions is not the required three');
  // Both kinds of unwelcome result survive the export.
  assert.equal(s.buildResultsJson({}).trials.length, 4);
});
