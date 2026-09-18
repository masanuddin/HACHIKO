import { describe, expect, it } from 'vitest'
import { HachikoAI, LearningTool } from '../ai/index.js'
import { FocusEngine } from '../engine/focusEngine'
import { DEFAULT_CONFIG } from '../engine/config'
import type { FocusState, Media } from '../engine/types'
import { toFrame, type AiTelemetryFrame } from './aiAdapter'

/**
 * Focused tests for the Phase 4 session-context wiring. These drive the SAME
 * integrated path the product uses - HachikoAI.processFrame -> aiAdapter.toFrame
 * -> FocusEngine.step - with synthetic measurements, so the contextual phone
 * behavior (Cases A-I) is verified at the logic level without a webcam.
 */

const MEDIA_VALUES: Media[] = ['laptop', 'phone', 'book', 'paper', 'other']

const CONE = {
  yawMid: 0,
  yawTol: DEFAULT_CONFIG.coneFloorRad,
  pitchMid: 0,
  pitchTol: DEFAULT_CONFIG.coneFloorRad,
}

interface PhoneEventLike {
  status: string
  context: string
}

function measurement(yawDeg = 0): Record<string, unknown> {
  return {
    facePresent: true,
    poseValid: true,
    poseInvalidReason: 'NONE',
    yawRaw: yawDeg,
    pitchRaw: 0,
    rollRaw: 0,
    earLeft: 0.25,
    earRight: 0.25,
    earMean: 0.25,
  }
}

function phoneDetections(): { category: string; confidence: number }[] {
  return [{ category: 'cell phone', confidence: 0.8 }]
}

function stepAi(ai: HachikoAI, nowMs: number, phone: boolean, yawDeg = 0): AiTelemetryFrame {
  return ai.processFrame(measurement(yawDeg), nowMs, {
    faceInferenceMs: 0,
    objectInferenceMs: 0,
    objectDetections: phone ? phoneDetections() : [],
  }) as unknown as AiTelemetryFrame
}

/** Drive the full product path for `steps` frames of 200 ms and return the final state. */
function runSession(
  ai: HachikoAI,
  declaredMedia: Media[],
  phone: boolean,
  yawDeg = 0,
  steps = 90,
): FocusState {
  const engine = new FocusEngine(DEFAULT_CONFIG, CONE, declaredMedia)
  let state: FocusState = 'FOKUS'
  for (let i = 0; i < steps; i++) {
    const out = engine.step(toFrame(stepAi(ai, i * 200, phone, yawDeg)))
    state = out.state
  }
  return state
}

describe('learning-tool enum parity', () => {
  it('every HACHIKO Media value exists in AI-Engine LearningTool (vendor retains MIXED)', () => {
    const learningValues = Object.values(LearningTool) as string[]
    for (const media of MEDIA_VALUES) {
      expect(learningValues).toContain(media)
    }
  })
})

describe('phone event context tagging', () => {
  it('no session context => PENDING', () => {
    const ai = new HachikoAI()
    stepAi(ai, 0, true)
    stepAi(ai, 500, true)
    const events = ai.getPhoneEvents() as unknown as PhoneEventLike[]
    expect(events[0]?.context).toBe('PENDING')
  })

  it('learningTools phone => EXPECTED_TOOL', () => {
    const ai = new HachikoAI()
    ai.setSessionContext({ learningTools: ['phone'] })
    stepAi(ai, 0, true)
    stepAi(ai, 500, true)
    const events = ai.getPhoneEvents() as unknown as PhoneEventLike[]
    expect(events[0]?.context).toBe('EXPECTED_TOOL')
  })

  it('learningTools book => DISTRACTION_CANDIDATE', () => {
    const ai = new HachikoAI()
    ai.setSessionContext({ learningTools: ['book'] })
    stepAi(ai, 0, true)
    stepAi(ai, 500, true)
    const events = ai.getPhoneEvents() as unknown as PhoneEventLike[]
    expect(events[0]?.context).toBe('DISTRACTION_CANDIDATE')
  })

  for (const tools of [['laptop'], ['book'], ['paper'], ['other']] as const) {
    it(`learningTools ${tools[0]} => DISTRACTION_CANDIDATE`, () => {
      const ai = new HachikoAI()
      ai.setSessionContext({ learningTools: [...tools] })
      stepAi(ai, 0, true)
      stepAi(ai, 500, true)
      const events = ai.getPhoneEvents() as unknown as PhoneEventLike[]
      expect(events[0]?.context).toBe('DISTRACTION_CANDIDATE')
    })
  }

  it('learningTools book + paper => DISTRACTION_CANDIDATE (no phone selected)', () => {
    const ai = new HachikoAI()
    ai.setSessionContext({ learningTools: ['book', 'paper'] })
    stepAi(ai, 0, true)
    stepAi(ai, 500, true)
    const events = ai.getPhoneEvents() as unknown as PhoneEventLike[]
    expect(events[0]?.context).toBe('DISTRACTION_CANDIDATE')
  })

  it('learningTools phone + book => EXPECTED_TOOL (explicit phone selected)', () => {
    const ai = new HachikoAI()
    ai.setSessionContext({ learningTools: ['phone', 'book'] })
    stepAi(ai, 0, true)
    stepAi(ai, 500, true)
    const events = ai.getPhoneEvents() as unknown as PhoneEventLike[]
    expect(events[0]?.context).toBe('EXPECTED_TOOL')
  })
})

describe('contextual phone behavior end-to-end (Cases A-I)', () => {
  it('Case A: phone tool + phone visible => FOKUS throughout', () => {
    const ai = new HachikoAI()
    ai.setSessionContext({ learningTools: ['phone'] })
    const state = runSession(ai, ['phone'], true)
    expect(state).toBe('FOKUS')
    const events = ai.getPhoneEvents() as unknown as PhoneEventLike[]
    expect(events.length).toBeGreaterThan(0)
    expect(events[0]?.context).toBe('EXPECTED_TOOL')
  })

  it('Case B: phone tool + sustained head turn => head-pose path still contributes (UNCERTAIN, not FOKUS)', () => {
    const ai = new HachikoAI()
    ai.setSessionContext({ learningTools: ['phone'] })
    const state = runSession(ai, ['phone'], true, 60)
    expect(state).not.toBe('FOKUS')
    expect(state).toBe('UNCERTAIN')
  })

  it('Case C: book tool + phone visible => TERALIH via existing FocusEngine phone rule', () => {
    const ai = new HachikoAI()
    ai.setSessionContext({ learningTools: ['book'] })
    const state = runSession(ai, ['book'], true)
    expect(state).toBe('TERALIH')
    const events = ai.getPhoneEvents() as unknown as PhoneEventLike[]
    expect(events[0]?.context).toBe('DISTRACTION_CANDIDATE')
  })

  it('Case D: book tool + no phone, neutral head => FOKUS and no phone events', () => {
    const ai = new HachikoAI()
    ai.setSessionContext({ learningTools: ['book'] })
    const state = runSession(ai, ['book'], false)
    expect(state).toBe('FOKUS')
    const events = ai.getPhoneEvents() as unknown as PhoneEventLike[]
    expect(events.length).toBe(0)
  })

  it('Case E: laptop tool + phone visible => TERALIH (phone is a distraction candidate)', () => {
    const ai = new HachikoAI()
    ai.setSessionContext({ learningTools: ['laptop'] })
    const state = runSession(ai, ['laptop'], true)
    expect(state).toBe('TERALIH')
  })

  it('Case F: paper tool + phone visible => TERALIH (phone is a distraction candidate)', () => {
    const ai = new HachikoAI()
    ai.setSessionContext({ learningTools: ['paper'] })
    const state = runSession(ai, ['paper'], true)
    expect(state).toBe('TERALIH')
  })

  it('Case G: other tool + phone visible => TERALIH (phone is a distraction candidate)', () => {
    const ai = new HachikoAI()
    ai.setSessionContext({ learningTools: ['other'] })
    const state = runSession(ai, ['other'], true)
    expect(state).toBe('TERALIH')
  })

  it('Case H: book + paper tools + phone visible => TERALIH (no phone selected)', () => {
    const ai = new HachikoAI()
    ai.setSessionContext({ learningTools: ['book', 'paper'] })
    const state = runSession(ai, ['book', 'paper'], true)
    expect(state).toBe('TERALIH')
  })

  it('Case I: phone + book tools + phone visible => FOKUS (explicit phone selection makes phone expected)', () => {
    const ai = new HachikoAI()
    ai.setSessionContext({ learningTools: ['phone', 'book'] })
    const state = runSession(ai, ['phone', 'book'], true)
    expect(state).toBe('FOKUS')
  })
})
