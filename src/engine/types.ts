/*
 * Engine contract. These signatures are fixed by CLAUDE.md - do not
 * change them; P5's replay ablation and the perception adapter both
 * depend on this exact shape.
 *
 * This file (and everything else in src/engine/) is PURE TypeScript:
 * no DOM, no `window`, no `document`, no browser APIs, no `Date.now()`.
 * Timestamps always arrive as arguments.
 */

export type Media = 'laptop' | 'phone' | 'book' | 'paper' | 'other'

export type FocusState = 'FOKUS' | 'TERALIH' | 'TIDAK_HADIR' | 'UNCERTAIN' | 'MENGANTUK'

export interface Frame {
  t: number // ms
  faceFound: boolean
  yaw: number | null // radians
  pitch: number | null // radians
  eyeBlink: number | null // 0..1
  objects: string[] // COCO labels seen within the last 1s
}

export interface Cone {
  yawMid: number
  yawTol: number
  pitchMid: number
  pitchTol: number
}

export interface EngineOutput {
  state: FocusState
  changedAt: number
  uncertainMs: number
}

export interface EngineConfig {
  emaAlpha: number
  toDistractedMs: number
  toFocusedMs: number
  absentMs: number
  phoneSustainMs: number
  drowsyThreshold: number
  drowsyMs: number
  coneSigmaMult: number
  coneFloorRad: number
  useDeclaredMedia: boolean
  useObjects: boolean
}
