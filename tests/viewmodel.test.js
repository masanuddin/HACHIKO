/**
 * Center ↔ Signal Inspector integration (spec §C, §H, §Q, §R).
 *
 * The defect these guard against was NOT cosmetic. The page ran a second
 * `ai.onFrame` subscriber for the right panel, and `HachikoAI` deliberately
 * isolates a throwing listener so one bad consumer cannot kill inference. A
 * single `ReferenceError: fmt is not defined` in that handler therefore blanked
 * the ENTIRE Signal Inspector on every frame — silently, with the centre panel
 * still updating perfectly. Nothing surfaced except a console warning.
 *
 * The fix is structural: one subscriber, one canonical view model, both panels
 * reading the same object. These tests assert that structure holds, and that
 * every field resolves to a real value or an explicit reason — never a dash.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildDebugViewModel, Absent } from '../tools/debug/debugViewModel.js';
import { CONFIG } from '../src/ai/index.js';

const readPage = () =>
  readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

const CAL_VALID = {
  status: 'VALID',
  baseline: { yaw: -2.0, pitch: -6.8, roll: 0.4, ear: 0.412, sampleCount: 149 },
  validSamples: 149, totalFrames: 150,
};

const frame = (over = {}) => ({
  timestampMs: 1000,
  measurement: {
    facePresent: true, poseValid: true, poseInvalidReason: null,
    yawRaw: -4.9, pitchRaw: -3.1, rollRaw: 1.9,
    earLeft: 0.401, earRight: 0.395, earMean: 0.398,
    ...(over.measurement ?? {}),
  },
  calibrated: {
    yawDelta: -2.9, pitchDelta: 3.7, rollDelta: 1.5, earRelative: 0.966,
    ...(over.calibrated ?? {}),
  },
  temporal: {
    yawSmoothed: -2.9, pitchSmoothed: 3.2, rollSmoothed: 1.4,
    earSmoothed: 0.964, faceMissingMs: 0, facePresentMs: 8000,
    ...(over.temporal ?? {}),
  },
  evidence: {
    active: {
      yawStrong: false, pitchUpStrong: false, eyeClosureStrong: false,
      pitchDownSupport: false, rollSupport: false, ...(over.active ?? {}),
    },
    accumulated: {
      yawStrong: 0, pitchUpStrong: 0, eyeClosureStrong: 0,
      pitchDownSupport: 0, rollSupport: 0, ...(over.accumulated ?? {}),
    },
    eyeEligible: over.eyeEligible ?? true,
    eyeIneligibleReason: over.eyeIneligibleReason ?? null,
  },
  classification: {
    state: 'FOKUS', primaryReason: 'NONE', stateDurationMs: 8000,
    holding: false, ...(over.classification ?? {}),
  },
  performance: { fps: 29.1, inferenceMs: 11.2, ...(over.performance ?? {}) },
  validity: { stateSignalValid: true },
});

const vmOf = (f = frame(), over = {}) => buildDebugViewModel(f, {
  cameraOn: true, calibration: CAL_VALID, config: CONFIG,
  extremes: { yawRaw: { min: -10, max: 12 }, pitchRaw: { min: -8, max: 4 },
              rollRaw: { min: -3, max: 5 }, earMean: { min: 0.12, max: 0.42 },
              nonFinite: 0, wrapSuspect: 0 },
  latency: { p50: 11, p95: 14, count: 60 },
  delegate: 'GPU', video: { width: 640, height: 480 },
  ...over,
});

// ── §H: centre and right are the SAME object, so they cannot disagree ──
test('V1. yaw status is one value shared by both panels', () => {
  const off = vmOf(frame({ active: { yawStrong: false } }));
  assert.equal(off.signals.yaw.active, false);
  assert.equal(off.signals.yaw.status, 'inactive');

  const on = vmOf(frame({ active: { yawStrong: true }, accumulated: { yawStrong: 1600 } }));
  assert.equal(on.signals.yaw.active, true);
  assert.equal(on.signals.yaw.status, 'ACTIVE');
  // Persistence reflects the real temporal timer, not a constant.
  assert.equal(on.signals.yaw.persistence.text,
    `1600 / ${CONFIG.state.YAW_PERSIST_MS} ms`);
});

test('V2. pitch up and pitch down stay independently synchronised', () => {
  const vm = vmOf(frame({
    active: { pitchUpStrong: true, pitchDownSupport: false },
    accumulated: { pitchUpStrong: 900 },
  }));
  assert.equal(vm.signals.pitchUp.status, 'ACTIVE');
  assert.equal(vm.signals.pitchDown.status, 'inactive');
  assert.equal(vm.signals.pitchUp.persistence.text,
    `900 / ${CONFIG.state.PITCH_UP_PERSIST_MS} ms`);
  // Opposite rules read off ONE measurement.
  assert.equal(vm.signals.pitchUp.role, 'STRONG');
  assert.equal(vm.signals.pitchDown.role, 'SUPPORT');
  assert.equal(vm.signals.pitch.role, 'Measurement');
});

test('V3. head tilt maps to the internal roll values', () => {
  const vm = vmOf(frame({ active: { rollSupport: true } }));
  // UI term is Head Tilt; the numbers come from roll.
  assert.equal(vm.signals.headTilt.raw, '1.9°');
  assert.equal(vm.signals.headTilt.delta, '1.5°');
  assert.equal(vm.signals.headTilt.smoothed, '1.4°');
  assert.equal(vm.signals.headTilt.role, 'SUPPORT');
  assert.equal(vm.signals.headTilt.status, 'ACTIVE');
});

test('V4. eye eligibility is one decision, not two', () => {
  const yes = vmOf();
  assert.equal(yes.face.eyeEligible, true);
  assert.equal(yes.signals.eye.eligible, 'YES');
  assert.equal(yes.signals.eye.rejectReason, Absent.NONE);

  const no = vmOf(frame({
    eyeEligible: false, eyeIneligibleReason: 'YAW_OUT_OF_RANGE',
  }));
  assert.equal(no.face.eyeEligible, false);
  assert.equal(no.signals.eye.eligible, 'NO');
  // The real gating reason, surfaced verbatim.
  assert.equal(no.signals.eye.rejectReason, 'YAW_OUT_OF_RANGE');
});

test('V5. thresholds are READ from config, never re-implemented', () => {
  const vm = vmOf();
  assert.equal(vm.signals.yaw.rule, `|Δ| > ${CONFIG.state.STRONG_YAW_DELTA_DEG}°`);
  assert.equal(vm.signals.pitchUp.rule, `Δ > +${CONFIG.state.STRONG_UP_PITCH_DELTA_DEG}°`);
  assert.equal(vm.signals.eye.threshold, `${CONFIG.state.EAR_RELATIVE_THRESHOLD} relative`);
  assert.equal(vm.signals.eye.persistence.text,
    `0 / ${CONFIG.state.EYE_CLOSED_PERSIST_MS} ms`);
});

// ── §A/§B: explicit absence, never a dash ──────────────────────────────
test('V6. camera off states what it is waiting for', () => {
  const vm = vmOf(frame(), { cameraOn: false, extremes: null, latency: null,
                             delegate: null, video: null });
  assert.equal(vm.signals.yaw.raw, Absent.NO_CAMERA);
  assert.equal(vm.runtime.p50, Absent.NO_CAMERA);
  assert.equal(vm.runtime.ranges.empty, Absent.NO_CAMERA);
  assert.equal(vm.runtime.anomalies.summary, Absent.NO_CAMERA);
});

test('V7. camera ON never reports "Waiting for camera" in runtime', () => {
  // The reported contradiction: camera live, runtime claiming it was not.
  const live = vmOf(frame(), { extremes: { yawRaw: { min: -1, max: 1 },
    nonFinite: 0, wrapSuspect: 0 } });
  assert.notEqual(live.runtime.anomalies.summary, Absent.NO_CAMERA);
  assert.equal(live.runtime.anomalies.summary, '✓ No runtime anomalies');
  assert.notEqual(live.runtime.fps, Absent.NO_CAMERA);
});

test('V8. an uncalibrated session distinguishes raw from relative', () => {
  const vm = vmOf(frame(), {
    calibration: { status: 'NONE', baseline: null, validSamples: 0, totalFrames: 0 },
  });
  assert.equal(vm.signals.yaw.raw, '-4.9°', 'raw needs no baseline');
  assert.equal(vm.signals.yaw.delta, Absent.NEEDS_CALIBRATION);
  assert.equal(vm.signals.eye.relative, Absent.NEEDS_CALIBRATION);
  // A rule that cannot be evaluated must not imply a running timer.
  assert.equal(vm.signals.yaw.persistence.text, Absent.NOT_APPLICABLE);
  assert.equal(vm.signals.yaw.persistence.ok, false);
});

test('V9. a broken value reads Unavailable, not a dash', () => {
  const vm = vmOf(frame({ measurement: { yawRaw: NaN } }));
  assert.equal(vm.signals.yaw.raw, Absent.UNAVAILABLE);
});

test('V10. live session range renders rows only once data exists', () => {
  const empty = vmOf(frame(), { extremes: { nonFinite: 0, wrapSuspect: 0 } });
  assert.equal(empty.runtime.ranges.rows.length, 0);
  assert.equal(empty.runtime.ranges.empty, Absent.COLLECTING);

  const full = vmOf();
  assert.equal(full.runtime.ranges.rows.length, 4);
  assert.deepEqual(full.runtime.ranges.rows.map((r) => r.label),
    ['Yaw', 'Pitch', 'Head Tilt', 'EAR relative']);
  assert.equal(full.runtime.ranges.rows[0].min, '-10.0°');
});

test('V11. no view-model field is ever a bare dash', () => {
  const cases = [
    vmOf(),
    vmOf(frame(), { cameraOn: false, extremes: null, latency: null,
                    delegate: null, video: null }),
    vmOf(frame(), { calibration: { status: 'NONE', baseline: null,
                                   validSamples: 0, totalFrames: 0 } }),
    vmOf(frame({ measurement: { facePresent: false, poseValid: false } })),
    vmOf(frame({ measurement: { yawRaw: NaN, pitchRaw: NaN, rollRaw: NaN } })),
    vmOf(frame({ eyeEligible: false, eyeIneligibleReason: 'PITCH_OUT_OF_RANGE' })),
  ];
  const walk = (node, path) => {
    if (typeof node === 'string') {
      assert.ok(!/^\s*[—–-]\s*$/.test(node),
        `${path} rendered a bare dash: ${JSON.stringify(node)}`);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    }
  };
  cases.forEach((vm, i) => walk(vm, `case${i}`));
});

// ── §C: structural guarantee — one subscriber ──────────────────────────
test('V12. the page does not run a second ai.onFrame subscriber', () => {
  const html = readPage();
  const js = html.slice(html.indexOf('<script type="module">'));
  // Two subscribers is how the right panel died silently: HachikoAI isolates a
  // throwing listener, so an error in one blanks its panel and nothing else.
  assert.ok(!/harness\.ai\.onFrame\(/.test(js),
    'the page must not attach its own frame listener');
  assert.match(js, /harness\.onViewModel = /,
    'the page renders from the canonical view model');
});

test('V13. the page markup contains no placeholder dashes', () => {
  const html = readPage();
  const markup = html.slice(0, html.indexOf('<script type="module">'));
  // A dash that is an element's ENTIRE content is a placeholder. Dashes inside
  // prose (titles, tooltips, headings) are legitimate punctuation.
  const holders = [...markup.matchAll(
    /<(?:span|td|b|div)[^>]*id="([A-Za-z0-9_]+)"[^>]*>\s*—\s*<\/(?:span|td|b|div)>/g)];
  assert.deepEqual(holders.map((m) => m[1]), [],
    'these elements still render a bare dash placeholder');
});

test('V14. the Signal Inspector does not repeat the AI Result', () => {
  const vm = vmOf();
  // State, reason and time-in-state have ONE home: the centre panel.
  assert.ok(vm.state.publicState, 'the view model carries state for AI Result');
  const html = readPage();
  const right = html.slice(html.indexOf('Developer detail'));
  for (const dup of ['id="dgReason"', 'id="dgStateDur"', 'id="dgSignal"']) {
    assert.ok(!right.includes(dup), `${dup} duplicates the AI Result panel`);
  }
});

// ── Conditional tables: one reason, stated once ────────────────────────
test('V15. a shared blocking reason collapses the whole table', () => {
  // Repeating "Waiting for camera" through twenty cells is noise, and in a
  // narrow column every one of those cells wrapped onto three lines.
  const off = vmOf(frame(), { cameraOn: false, extremes: null, latency: null,
                              delegate: null, video: null });
  assert.equal(off.blocked.headPose, Absent.NO_CAMERA);
  assert.equal(off.blocked.pitchInterpretation, Absent.NO_CAMERA);
  assert.equal(off.blocked.eyeMeasurements, Absent.NO_CAMERA);
  assert.equal(off.blocked.eyeDecision, Absent.NO_CAMERA);
  assert.equal(off.blocked.runtime, Absent.NO_CAMERA);
});

test('V16. blocking is per-table, not global', () => {
  // A missing face stops head pose and EAR, but runtime health is still real.
  const noFace = vmOf(frame({ measurement: { facePresent: false, poseValid: false } }));
  assert.equal(noFace.blocked.headPose, Absent.NO_FACE);
  assert.equal(noFace.blocked.runtime, null, 'runtime does not need a face');

  // A pose failure is not the same as a missing face, and EAR survives it.
  const badPose = vmOf(frame({ measurement: { facePresent: true, poseValid: false } }));
  assert.equal(badPose.blocked.headPose, Absent.SIGNAL_INVALID);
  assert.equal(badPose.blocked.eyeMeasurements, null,
    'EAR is measurable without a valid head pose');

  // Raw angles need no baseline; the threshold interpretation does.
  const uncal = vmOf(frame(), {
    calibration: { status: 'NONE', baseline: null, validSamples: 0, totalFrames: 0 },
  });
  assert.equal(uncal.blocked.headPose, null, 'raw angles render uncalibrated');
  assert.equal(uncal.blocked.pitchInterpretation, Absent.NEEDS_CALIBRATION);
});

test('V17. a live session blocks nothing', () => {
  const live = vmOf();
  for (const [k, v] of Object.entries(live.blocked)) {
    assert.equal(v, null, `${k} must not be blocked during a live session`);
  }
});

test('V18. the page collapses tables instead of filling cells', () => {
  const html = readPage();
  const js = html.slice(html.indexOf('<script type="module">'));
  // Each table has a state line and a wrapper that can be hidden wholesale.
  for (const [state, table] of [['stHead', 'tblHead'], ['stPitch', 'tblPitch'],
                                ['stEyeM', 'tblEyeM'], ['stEyeD', 'tblEyeD']]) {
    assert.match(html, new RegExp(`id="${state}"`), `missing state line ${state}`);
    assert.match(html, new RegExp(`id="${table}"`), `missing wrapper ${table}`);
  }
  assert.match(js, /const gate = \(stateId, tableId, reason\)/,
    'a single gate helper drives all four tables');
  assert.match(js, /id\(tableId\)\.hidden = !!reason/,
    'a blocked table must be hidden, not filled with repeated text');
  // And the rows are not written while hidden.
  assert.match(js, /if \(showHead\) \{/);
  assert.match(js, /if \(showPitch\) \{/);
  assert.match(js, /if \(showEyeM\) \{/);
  assert.match(js, /if \(showEyeD\) \{/);
});
