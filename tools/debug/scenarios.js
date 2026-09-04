/**
 * HACHIKO — Debug Harness scenario configuration  (tools/debug)
 * =============================================================
 * One place defining, per scenario: what the operator does, how long the trial
 * records, and what the temporal rule is expected to do.
 *
 * ── WHY DURATIONS DIFFER PER SCENARIO ────────────────────────────────────
 * The Debug Harness tests TEMPORAL logic, so a single fixed window would make
 * most scenarios meaningless. A 3 s recording cannot prove that a 3 s
 * eye-closure persistence fires, and it cannot prove a short glance does NOT
 * fire either. Each duration is therefore derived from the rule under test:
 *
 *   "SHORT" scenarios  record for LESS than the persistence window
 *                      -> the rule must NOT trigger
 *   "LONG" scenarios   record for persistence + observation buffer
 *                      -> the rule may trigger, and we measure the delay
 *
 * Durations are read from CONFIG so they track the engine. This file does NOT
 * define or change any AI threshold — it only reads them to choose how long to
 * watch. Changing a threshold in src/ai/config.js automatically lengthens or
 * shortens the corresponding trial.
 */

import { CONFIG } from '../../src/ai/index.js';

const S = CONFIG.state;

/** Extra time after a persistence window, so a trigger has room to be seen. */
const OBSERVE_BUFFER_MS = 2500;
/** How long a "short" probe runs: comfortably under the persistence window. */
const shortOf = (persistMs) => Math.max(600, Math.round(persistMs * 0.5));
/** How long a "long" probe runs: persistence plus buffer. */
const longOf = (persistMs) => persistMs + OBSERVE_BUFFER_MS;

const DEFAULT_COUNTDOWN_MS = 3000;

/**
 * @typedef {Object} DebugScenario
 * @property {string} id
 * @property {string} group
 * @property {string} instruction
 * @property {number} countdownMs
 * @property {number} recordingDurationMs
 * @property {string} expectedSemanticOutcome
 * @property {boolean} [triggerExpected]  whether a state change is expected
 * @property {boolean} [pending]          blocked on a pending model choice
 * @property {string}  [pendingReason]
 */

/** @type {DebugScenario[]} */
export const DEBUG_SCENARIOS = [
  // ── Normal / study ──────────────────────────────────────────────────
  {
    id: 'SCREEN_NORMAL', group: 'NORMAL / STUDY',
    instruction: 'Sit normally and look at the screen. Do not move much.',
    countdownMs: DEFAULT_COUNTDOWN_MS, recordingDurationMs: 10000,
    expectedSemanticOutcome: 'FOKUS throughout; no evidence should activate.',
    triggerExpected: false,
  },
  {
    id: 'READ_BOOK', group: 'NORMAL / STUDY',
    instruction: 'Look down at a book on the desk and read.',
    countdownMs: DEFAULT_COUNTDOWN_MS,
    // Long enough for pitch-down SUPPORT to persist, proving it does NOT trigger.
    recordingDurationMs: longOf(S.DOWN_PITCH_SUPPORT_PERSIST_MS),
    expectedSemanticOutcome:
      'Pitch-down SUPPORT may activate. State must remain FOKUS — support evidence cannot trigger TERALIH.',
    triggerExpected: false,
  },
  {
    id: 'WRITE_NOTES', group: 'NORMAL / STUDY',
    instruction: 'Write in a notebook on the desk.',
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: longOf(S.DOWN_PITCH_SUPPORT_PERSIST_MS),
    expectedSemanticOutcome:
      'Pitch-down and possibly roll SUPPORT may activate. State must remain FOKUS.',
    triggerExpected: false,
  },

  // ── Yaw ─────────────────────────────────────────────────────────────
  {
    id: 'LOOK_LEFT_SHORT', group: 'YAW',
    instruction: 'At GO, glance left briefly, then return to the screen.',
    countdownMs: DEFAULT_COUNTDOWN_MS,
    // Deliberately shorter than YAW_PERSIST_MS.
    recordingDurationMs: shortOf(S.YAW_PERSIST_MS),
    expectedSemanticOutcome:
      `Yaw evidence starts but must not persist past ${S.YAW_PERSIST_MS} ms. State stays FOKUS.`,
    triggerExpected: false,
  },
  {
    id: 'LOOK_LEFT_LONG', group: 'YAW',
    instruction: 'At GO, turn your head left and HOLD until the timer ends.',
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: longOf(S.YAW_PERSIST_MS),
    expectedSemanticOutcome: 'Yaw STRONG evidence persists; state may become TERALIH with reason YAW.',
    triggerExpected: true,
  },
  {
    id: 'LOOK_RIGHT_LONG', group: 'YAW',
    instruction: 'At GO, turn your head right and HOLD until the timer ends.',
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: longOf(S.YAW_PERSIST_MS),
    expectedSemanticOutcome: 'Yaw is non-directional; state may become TERALIH with reason YAW.',
    triggerExpected: true,
  },
  {
    id: 'EXTREME_YAW_HELD', group: 'YAW',
    instruction: 'At GO, turn far enough that the face is lost, body still visible. HOLD.',
    countdownMs: DEFAULT_COUNTDOWN_MS, recordingDurationMs: 8000,
    expectedSemanticOutcome:
      'Face becomes unavailable. Without a presence model, absence handling is PENDING — '
      + 'record what the engine does and whether it wrongly claims absence.',
    triggerExpected: true,
  },

  // ── Pitch ───────────────────────────────────────────────────────────
  {
    id: 'LOOK_UP_SHORT', group: 'PITCH',
    instruction: 'At GO, glance up briefly, then return.',
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: shortOf(S.PITCH_UP_PERSIST_MS),
    expectedSemanticOutcome:
      `Pitch-up starts but must not persist past ${S.PITCH_UP_PERSIST_MS} ms. State stays FOKUS.`,
    triggerExpected: false,
  },
  {
    id: 'LOOK_UP_LONG', group: 'PITCH',
    instruction: 'At GO, look up and HOLD until the timer ends.',
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: longOf(S.PITCH_UP_PERSIST_MS),
    expectedSemanticOutcome: 'Pitch-up STRONG evidence persists; state may become TERALIH with reason PITCH_UP.',
    triggerExpected: true,
  },
  {
    id: 'LOOK_DOWN_LONG', group: 'PITCH',
    instruction: 'At GO, look down and HOLD until the timer ends.',
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: longOf(S.PITCH_UP_PERSIST_MS),
    expectedSemanticOutcome:
      'Pitch-down is SUPPORT only. State must remain FOKUS at any depth or duration.',
    triggerExpected: false,
  },

  // ── Eye ─────────────────────────────────────────────────────────────
  {
    id: 'NORMAL_BLINK', group: 'EYE',
    instruction: 'At GO, blink naturally while facing the screen.',
    countdownMs: DEFAULT_COUNTDOWN_MS, recordingDurationMs: 12000,
    expectedSemanticOutcome:
      'Eye evidence stays eligible, but blinks are far shorter than '
      + `${S.EYE_CLOSED_PERSIST_MS} ms. State stays FOKUS.`,
    triggerExpected: false,
  },
  {
    id: 'EYES_CLOSED_LONG', group: 'EYE',
    instruction: 'At GO, close both eyes facing forward and HOLD until the timer ends.',
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: longOf(S.EYE_CLOSED_PERSIST_MS),
    expectedSemanticOutcome:
      'Eye evidence eligible and persists; state may become TERALIH with reason EYE_CLOSURE.',
    triggerExpected: true,
  },

  // ── Robustness ──────────────────────────────────────────────────────
  {
    id: 'HEAD_TILT', group: 'ROBUSTNESS',
    instruction: 'At GO, tilt your head toward one shoulder and HOLD.',
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: longOf(S.ROLL_SUPPORT_PERSIST_MS),
    expectedSemanticOutcome: 'Roll SUPPORT may activate. State must remain FOKUS.',
    triggerExpected: false,
  },
  {
    id: 'TILT_LEFT', group: 'ROBUSTNESS',
    instruction: 'At GO, tilt toward your LEFT shoulder while facing the camera. HOLD.',
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: longOf(S.ROLL_SUPPORT_PERSIST_MS),
    expectedSemanticOutcome: 'Roll SUPPORT only. FOKUS. Validates roll independently of yaw.',
    triggerExpected: false,
  },
  {
    id: 'TILT_RIGHT', group: 'ROBUSTNESS',
    instruction: 'At GO, tilt toward your RIGHT shoulder while facing the camera. HOLD.',
    countdownMs: DEFAULT_COUNTDOWN_MS,
    recordingDurationMs: longOf(S.ROLL_SUPPORT_PERSIST_MS),
    expectedSemanticOutcome: 'Roll SUPPORT only. FOKUS.',
    triggerExpected: false,
  },
  {
    id: 'FACE_OCCLUDED_SHORT', group: 'ROBUSTNESS',
    instruction: 'At GO, cover your face with a hand for a moment, then uncover.',
    countdownMs: DEFAULT_COUNTDOWN_MS, recordingDurationMs: 6000,
    expectedSemanticOutcome:
      'Face becomes unavailable briefly. State should be held, not flipped. '
      + 'Full absence semantics need the presence model (PENDING).',
    triggerExpected: false,
  },

  // ── Absence / return — blocked on the Bake-off ──────────────────────
  // Deliberately marked pending rather than removed: absence validation is not
  // meaningful while the physical-presence model is unselected, and running it
  // now would produce results that look final but are not.
  {
    id: 'ABSENT', group: 'ABSENCE / RETURN',
    instruction: 'Leave the camera frame entirely.',
    countdownMs: DEFAULT_COUNTDOWN_MS, recordingDurationMs: 8000,
    expectedSemanticOutcome: 'Requires the final physical-presence model.',
    triggerExpected: true,
    pending: true,
    pendingReason: 'PENDING PRESENCE MODEL — absence cannot be validated until the '
                 + 'Bake-off selects a physical-presence model.',
  },
  {
    id: 'RETURN', group: 'ABSENCE / RETURN',
    instruction: 'Return to the camera frame and sit normally.',
    countdownMs: DEFAULT_COUNTDOWN_MS, recordingDurationMs: 6000,
    expectedSemanticOutcome: 'Requires the final physical-presence model.',
    triggerExpected: false,
    pending: true,
    pendingReason: 'PENDING PRESENCE MODEL — recovery from absence cannot be '
                 + 'validated until the Bake-off selects a physical-presence model.',
  },
];

/** Ordered group names, for rendering. */
export const DEBUG_GROUPS = [
  'NORMAL / STUDY', 'YAW', 'PITCH', 'EYE', 'ROBUSTNESS', 'ABSENCE / RETURN',
];

export const getScenario = (id) => DEBUG_SCENARIOS.find((s) => s.id === id) ?? null;

/** Snapshot for the export record, so a log states the timings it used. */
export function scenarioConfigSnapshot() {
  return DEBUG_SCENARIOS.map(({ id, group, countdownMs, recordingDurationMs,
                                expectedSemanticOutcome, triggerExpected, pending }) =>
    ({ id, group, countdownMs, recordingDurationMs, expectedSemanticOutcome,
       triggerExpected: !!triggerExpected, pending: !!pending }));
}

export default DEBUG_SCENARIOS;
