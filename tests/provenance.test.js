/**
 * Start-Trial provenance + official export package (spec §10).
 *
 * The rule under test: what a trial was interpreted against belongs to the
 * moment the bounded window OPENED, and nothing afterwards may rewrite it.
 * `calibrationAtStart` is captured once at Start Trial, immutable thereafter.
 *
 * The dataset carries no subject identity of any kind — see C13 in
 * cleanstart.test.js, which locks that removal in.
 *
 * No AI parameter is read or changed here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { DebugSession } from '../tools/debug/DebugSession.js';
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

/** Save a trial through the session. */
function save(session, code, n = 3) {
  const sc = getScenarioByCode(code);
  const ref = session.nextTrialRef(sc.id);
  return session.addTrial({ trialId: ref.trialId, scenario: sc.id,
    repetition: ref.repetition, recordingDurationMs: 10000, sampleCount: n,
    samples: Array.from({ length: n }, (_, i) => smp(i)) },
    sc, CAL());
}



// ═══════════════════════════════════════════════════════════════════════
// §3 — the snapshot must be taken at Start Trial
// ═══════════════════════════════════════════════════════════════════════





// ═══════════════════════════════════════════════════════════════════════
// §4 — the other Start Trial snapshots still hold
// ═══════════════════════════════════════════════════════════════════════
test('S6. calibration remains immutable across recalibration', () => {
  const s = new DebugSession();
  const sc = getScenarioByCode('D01');
  const first = s.addTrial({ trialId: 't1', scenario: sc.id, repetition: 1,
    recordingDurationMs: 10000, sampleCount: 1, samples: [smp()] },
    sc, CAL(-2.5));
  s.calibrationSnapshot = CAL(44);
  const second = s.addTrial({ trialId: 't2', scenario: sc.id, repetition: 2,
    recordingDurationMs: 10000, sampleCount: 1, samples: [smp()] },
    sc, CAL(44));

  assert.equal(first.calibrationAtStart.baseline.yaw, -2.5);
  assert.equal(second.calibrationAtStart.baseline.yaw, 44);
});

test('S7. the config/protocol snapshot is captured with the session', () => {
  const s = new DebugSession();
  save(s, 'D01');
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


test('S10. the workbook exposes no personal data', () => {
  const s = new DebugSession();
  save(s, 'D01');
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
  save(s, 'D01');
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
  save(s, 'D01');
  assert.ok(typeof s.buildTrialsCsv === 'function');
  assert.ok(s.buildTrialsCsv().includes('trial_id'), 'the trial still names itself');
  assert.ok(!s.buildTrialsCsv().includes('subject_id'),
    'and carries no subject identity');
});

test('S14. the JSON alone is a complete record', () => {
  const s = new DebugSession();
  save(s, 'D01', 5);
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
test('S15. the full protocol is representable end to end', () => {
  // The Behavioral DEVELOPMENT run is the registry itself, three times over:
  // 11 scenarios x 3 repetitions. The count is derived, never a literal, so
  // adding a scenario cannot leave this test asserting a stale total.
  const s = new DebugSession();
  const CODES = ['D01', 'D02', 'D03', 'D04', 'D05', 'D06',
                 'D07', 'D08', 'D09', 'D10', 'D11'];
  for (const code of CODES) for (let r = 0; r < 3; r++) save(s, code);

  const doc = s.buildResultsJson({});
  assert.equal(doc.trials.length, CODES.length * 3);
  assert.equal(doc.trials.length, 33, 'one subject, the whole registry');
  // Every trial carries what a later offline replay needs.
  for (const t of doc.trials) {
    assert.ok(t.scenarioCode && t.calibrationAtStart);
    assert.ok(t.recordingStartedAtIso !== t.recordingEndedAtIso);
    assert.ok(Array.isArray(t.samples));
  }
  assert.ok(!JSON.stringify(doc).includes('subjectId'),
    'and none of them carries a subject identity');
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
