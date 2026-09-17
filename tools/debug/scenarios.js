/**
 * HACHIKO — Debug Verification scenario registry  (tools/debug)
 * =============================================================
 * THE authoritative definition of the Debug Verification matrix, D01–D11.
 * The selector UI, the capture card, trial metadata, progress, summaries and
 * the export all read from here. Nothing else may define a scenario.
 *
 * ── WHAT THIS MATRIX ANSWERS ─────────────────────────────────────────────
 * "Does the FACE / BEHAVIOR pipeline behave according to its intended semantic
 * rules?" — nothing more. It does NOT choose a perception model, does NOT take
 * part in DEVELOPMENT/VALIDATION model selection, and does NOT derive PERSON or
 * PHONE operating thresholds. Those belong to the Benchmark.
 *
 * ── WHY DURATIONS DIFFER PER SCENARIO ────────────────────────────────────
 * This matrix tests TEMPORAL logic, so one fixed window would make most of it
 * meaningless: a 3 s recording cannot prove a 3 s eye-closure persistence
 * fires, nor that a short glance does not.
 *
 *   "short" probes record for LESS than the persistence window
 *                     -> the rule must NOT latch
 *   "long"  probes record for persistence + observation buffer
 *                     -> the rule may latch, and the delay is measurable
 *
 * ── NUMBERS LIVE IN CONFIG, NOT HERE ─────────────────────────────────────
 * Durations are derived from `CONFIG`, and instructions stay QUALITATIVE on
 * purpose. Writing "hold past 25° for 1500 ms" into an instruction would create
 * a second copy of a threshold that silently rots the moment the engine changes.
 * A scenario says "until it clearly exceeds the configured rule"; the UI renders
 * the live numeric rule from the config-backed view model.
 *
 * This file defines NO threshold and changes NO AI behaviour.
 */

import { CONFIG } from '../../src/ai/index.js';

const S = CONFIG.state;

/** Extra time after a persistence window, so a trigger has room to be seen. */
const OBSERVE_BUFFER_MS = 2500;
/** A "short" probe: comfortably under the persistence window. */
const shortOf = (persistMs) => Math.max(600, Math.round(persistMs * 0.5));
/** A "long" probe: persistence plus observation buffer. */
const longOf = (persistMs) => persistMs + OBSERVE_BUFFER_MS;

const DEFAULT_COUNTDOWN_MS = 3000;

/** Valid repetitions each Debug scenario needs. */
export const DEBUG_REQUIRED_REPETITIONS = 3;

/**
 * Categories, in the order the selector groups them.
 * These describe what a scenario PROVES, not what the user does.
 */
export const DebugCategory = Object.freeze({
  BASELINE: 'BASELINE',
  STRONG_EVIDENCE: 'STRONG_EVIDENCE',
  SUPPORT_EVIDENCE: 'SUPPORT_EVIDENCE',
  TEMPORAL_CONTROL: 'TEMPORAL_CONTROL',
  EYE_CONTROL: 'EYE_CONTROL',
  SIGNAL_VALIDITY: 'SIGNAL_VALIDITY',
  REALISTIC_STUDY: 'REALISTIC_STUDY',
});

/**
 * @typedef {Object} DebugScenario
 * @property {string} code                 D01..D11, stable across renames
 * @property {string} id                   canonical scenario identity
 * @property {string} name                 human-readable
 * @property {string} category             DebugCategory
 * @property {string} instruction          what the operator does (qualitative)
 * @property {string} purpose              what this scenario proves
 * @property {string[]} expectedSemanticBehavior
 * @property {number} countdownMs
 * @property {number} recordingDurationMs
 * @property {string} expectedSemanticOutcome   one-line summary for the card
 * @property {boolean} triggerExpected     whether strong evidence should latch
 * @property {number} requiredRepetitions
 */

/** @type {DebugScenario[]} */
export const DEBUG_SCENARIOS = [
  {
    code: 'D01', id: 'NEUTRAL_FRONTAL', name: 'Neutral frontal',
    category: DebugCategory.BASELINE,
    instruction: 'Sit normally facing the camera in the calibrated study '
      + 'posture. Do not intentionally turn, tilt, or close the eyes for a '
      + 'prolonged period.',
    purpose: 'Verify a stable neutral baseline and false-positive resistance.',
    expectedSemanticBehavior: [
      'Face signal stays valid.',
      'Yaw strong evidence stays inactive.',
      'Pitch-up strong evidence stays inactive.',
      'Sustained eye-closure evidence stays inactive.',
      'No support cue becomes dominant; no false TERALIH evidence.',
    ],
    countdownMs: DEFAULT_COUNTDOWN_MS, recordingDurationMs: 10000,
    expectedSemanticOutcome: 'FOKUS throughout; no evidence should activate.',
    triggerExpected: false,
  },
  {
    code: 'D02', id: 'YAW_LEFT_SUSTAINED', name: 'Sustained left yaw',
    category: DebugCategory.STRONG_EVIDENCE,
    instruction: 'From neutral, turn your head to the LEFT until the '
      + 'calibrated yaw deviation clearly exceeds the configured yaw rule, '
      + 'then hold it long enough to satisfy persistence.',
    purpose: 'Verify sustained left-yaw strong evidence.',
    expectedSemanticBehavior: [
      'Yaw deviation exceeds the configured rule.',
      'Yaw persistence progresses while the turn is held.',
      'Yaw evidence becomes ACTIVE after the configured persistence.',
      'Left is treated with the same semantics as right (see D03).',
    ],
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: longOf(S.YAW_PERSIST_MS),
    expectedSemanticOutcome: 'Yaw strong evidence activates after persistence.',
    triggerExpected: true,
  },
  {
    code: 'D03', id: 'YAW_RIGHT_SUSTAINED', name: 'Sustained right yaw',
    category: DebugCategory.STRONG_EVIDENCE,
    instruction: 'From neutral, turn your head to the RIGHT until the '
      + 'calibrated yaw deviation clearly exceeds the configured yaw rule, '
      + 'then hold it long enough to satisfy persistence.',
    purpose: 'Regression guard against apparent left/right asymmetry. '
      + 'A comparable absolute deviation held for a comparable time must be '
      + 'able to produce the same outcome as D02.',
    expectedSemanticBehavior: [
      'Yaw deviation exceeds the configured rule.',
      'Yaw persistence progresses while the turn is held.',
      'Yaw evidence becomes ACTIVE after the configured persistence.',
      'Outcome is comparable to D02 at comparable deviation and duration.',
    ],
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: longOf(S.YAW_PERSIST_MS),
    expectedSemanticOutcome: 'Yaw strong evidence activates after persistence.',
    triggerExpected: true,
  },
  {
    code: 'D04', id: 'BRIEF_YAW_GLANCE', name: 'Brief yaw glance',
    category: DebugCategory.TEMPORAL_CONTROL,
    instruction: 'Briefly look away far enough to cross the yaw threshold, '
      + 'then return to neutral BEFORE the configured persistence completes.',
    purpose: 'Prove that crossing a threshold is not evidence without duration.',
    expectedSemanticBehavior: [
      'Yaw may temporarily exceed the numeric threshold.',
      'Persistence must NOT complete.',
      'Yaw strong evidence must NOT latch.',
      'No sustained-yaw TERALIH evidence.',
    ],
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: shortOf(S.YAW_PERSIST_MS),
    expectedSemanticOutcome: 'Threshold crossed briefly; evidence must not latch.',
    triggerExpected: false,
  },
  {
    code: 'D05', id: 'PITCH_UP_SUSTAINED', name: 'Sustained pitch up',
    category: DebugCategory.STRONG_EVIDENCE,
    instruction: 'Raise your head until the calibrated pitch-up deviation '
      + 'crosses the configured rule, and hold it long enough to satisfy '
      + 'persistence.',
    purpose: 'Verify sustained pitch-up strong evidence.',
    expectedSemanticBehavior: [
      'Pitch-up persistence progresses while the pose is held.',
      'Evidence becomes ACTIVE only after the configured persistence.',
      'Direction follows the configured pitch sign convention.',
    ],
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: longOf(S.PITCH_UP_PERSIST_MS),
    expectedSemanticOutcome: 'Pitch-up strong evidence activates after persistence.',
    triggerExpected: true,
  },
  {
    code: 'D06', id: 'PITCH_DOWN_STUDY_LIKE', name: 'Pitch down, study-like',
    category: DebugCategory.SUPPORT_EVIDENCE,
    instruction: 'Lower your head naturally, as if reading or looking at notes.',
    purpose: 'Verify the intentional distinction: pitch-down is SUPPORT '
      + 'evidence, not automatic distraction.',
    expectedSemanticBehavior: [
      'Pitch-down may become SUPPORT evidence.',
      'Pitch-down must NOT independently create TERALIH.',
      'No strong evidence is fabricated from a downward pose.',
    ],
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: longOf(S.DOWN_PITCH_SUPPORT_PERSIST_MS),
    expectedSemanticOutcome: 'Support evidence only; state should remain FOKUS.',
    triggerExpected: false,
  },
  {
    code: 'D07', id: 'HEAD_TILT', name: 'Head tilt',
    category: DebugCategory.SUPPORT_EVIDENCE,
    instruction: 'Tilt your head sideways while staying physically present '
      + 'and otherwise stable.',
    purpose: 'Verify support-only semantics for Head Tilt.',
    expectedSemanticBehavior: [
      'Head Tilt may become SUPPORT evidence.',
      'Head Tilt must NOT independently create TERALIH.',
      'Internally this reads the roll angle; the UI says "Head Tilt".',
    ],
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: longOf(S.ROLL_SUPPORT_PERSIST_MS),
    expectedSemanticOutcome: 'Support evidence only; state should remain FOKUS.',
    triggerExpected: false,
  },
  {
    code: 'D08', id: 'NORMAL_BLINK', name: 'Normal blinking',
    category: DebugCategory.EYE_CONTROL,
    instruction: 'Stay frontal and blink naturally several times.',
    purpose: 'Verify that a blink is not treated as prolonged eye closure.',
    expectedSemanticBehavior: [
      'Individual blinks may briefly reduce EAR.',
      'Sustained eye-closure persistence must NOT complete.',
      'Eye-closure strong evidence stays inactive.',
    ],
    countdownMs: DEFAULT_COUNTDOWN_MS, recordingDurationMs: 8000,
    expectedSemanticOutcome: 'Blinks are transient; closure evidence must not latch.',
    triggerExpected: false,
  },
  {
    code: 'D09', id: 'SUSTAINED_EYE_CLOSURE', name: 'Sustained eye closure',
    category: DebugCategory.STRONG_EVIDENCE,
    instruction: 'Stay in an eye-eligible frontal pose and close both eyes '
      + 'long enough to exceed the configured sustained-closure persistence. '
      + 'Do not trigger this from an invalid pose.',
    purpose: 'Verify prolonged eye-closure strong evidence.',
    expectedSemanticBehavior: [
      'The eye signal stays ELIGIBLE (frontal pose).',
      'Relative EAR crosses the configured closure condition.',
      'Closure persistence progresses.',
      'Eye-closure evidence becomes ACTIVE after the configured duration.',
    ],
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: longOf(S.EYE_CLOSED_PERSIST_MS),
    expectedSemanticOutcome: 'Closure evidence activates, under a valid eye signal.',
    triggerExpected: true,
  },
  {
    code: 'D10', id: 'FACE_DROPOUT_RECOVERY', name: 'Face dropout and recovery',
    category: DebugCategory.SIGNAL_VALIDITY,
    instruction: 'Begin neutral with a valid face signal. Create a realistic '
      + 'face-landmark dropout, then return to the calibrated frontal posture. '
      + 'This tests signal loss and recovery — not deliberate physical absence.',
    purpose: 'Verify validity handling and recovery. This scenario does NOT '
      + 'validate final PresenceFusion / TIDAK_HADIR behaviour; face loss is '
      + 'not proof that the user physically left.',
    expectedSemanticBehavior: [
      'Face-dependent signals become unavailable/invalid during the dropout.',
      'No yaw/pitch/eye evidence is fabricated while those signals are invalid.',
      'The signal recovers once the face is usable again.',
      'Face loss alone is NOT treated here as physical absence.',
    ],
    countdownMs: DEFAULT_COUNTDOWN_MS, recordingDurationMs: 12000,
    expectedSemanticOutcome: 'Signals go invalid, then recover; nothing is invented.',
    triggerExpected: false,
  },
  {
    code: 'D11', id: 'READING_WRITING', name: 'Reading and writing',
    category: DebugCategory.REALISTIC_STUDY,
    instruction: 'Read and write notes naturally, in a typical study posture.',
    purpose: 'High-value realistic false-positive test.',
    expectedSemanticBehavior: [
      'Pitch-down and/or Head Tilt may appear as SUPPORT cues.',
      'Normal study posture must not automatically create TERALIH.',
      'Eye and head signal validity behave honestly.',
      'No "focus" conclusion is invented from unavailable signals.',
    ],
    countdownMs: DEFAULT_COUNTDOWN_MS, recordingDurationMs: 15000,
    expectedSemanticOutcome: 'Support cues allowed; state should remain FOKUS.',
    triggerExpected: false,
  },
].map((s) => ({ ...s, requiredRepetitions: DEBUG_REQUIRED_REPETITIONS }));

/** Categories present in the matrix, in declaration order. */
export const DEBUG_GROUPS = [...new Set(DEBUG_SCENARIOS.map((s) => s.category))];

/** @returns {DebugScenario|null} */
export function getScenario(id) {
  return DEBUG_SCENARIOS.find((s) => s.id === id) ?? null;
}

/** @returns {DebugScenario|null} lookup by D-code. */
export function getScenarioByCode(code) {
  return DEBUG_SCENARIOS.find((s) => s.code === code) ?? null;
}

/**
 * Protocol snapshot for the export, so a session records the matrix it ran
 * under rather than whatever the code says at analysis time.
 */
export function scenarioConfigSnapshot() {
  return DEBUG_SCENARIOS.map((s) => ({
    code: s.code, id: s.id, name: s.name, category: s.category,
    group: s.category,
    instruction: s.instruction, purpose: s.purpose,
    expectedSemanticBehavior: [...s.expectedSemanticBehavior],
    expectedSemanticOutcome: s.expectedSemanticOutcome,
    triggerExpected: s.triggerExpected,
    countdownMs: s.countdownMs,
    recordingDurationMs: s.recordingDurationMs,
    requiredRepetitions: s.requiredRepetitions,
  }));
}

export default DEBUG_SCENARIOS;
