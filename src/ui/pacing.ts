import type { Cone, Frame, FocusState } from '../engine/focusEngine'
import { EARLY_BREAK_MIN_ELAPSED_RATIO, EARLY_BREAK_STRUGGLE_RATIO, EXTENSION_WINDOW_MS } from './sessionConfig'

/**
 * ADHD-motivated session pacing. Pure functions over data session.ts
 * already accumulates every frame - nothing here touches FocusEngine,
 * its tests, or the replay tool's ablation. The app only ever offers;
 * session.ts decides what to do with the answer.
 */

export function shouldOfferEarlyBreak(
  workMs: number,
  remainingMs: number,
  durationsMs: Record<FocusState, number>,
): boolean {
  const elapsedMs = workMs - remainingMs
  if (elapsedMs < workMs * EARLY_BREAK_MIN_ELAPSED_RATIO) return false

  const struggleMs = durationsMs.TERALIH + durationsMs.UNCERTAIN + durationsMs.MENGANTUK
  return struggleMs / elapsedMs >= EARLY_BREAK_STRUGGLE_RATIO
}

export function shouldOfferExtension(currentState: FocusState, currentStateDurationMs: number): boolean {
  return currentState === 'FOKUS' && currentStateDurationMs >= EXTENSION_WINDOW_MS
}

/**
 * A lightweight, independent early-warning heuristic for Hachiko's
 * stirring pose. Deliberately NOT the engine's own EMA-smoothed,
 * hysteresis-gated cone check - that state is private to FocusEngine per
 * CLAUDE.md's locked contract. This is just the instantaneous raw
 * yaw/pitch-vs-cone test, so it can run a little ahead of the engine's
 * slower-to-commit decision. It's a soft foreshadow, not required to
 * line up exactly with the moment the engine actually flips to TERALIH.
 */
export function isRawOutOfCone(frame: Frame, cone: Cone): boolean {
  if (frame.yaw === null || frame.pitch === null) return false
  return Math.abs(frame.yaw - cone.yawMid) > cone.yawTol || Math.abs(frame.pitch - cone.pitchMid) > cone.pitchTol
}
