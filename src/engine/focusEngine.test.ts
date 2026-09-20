import { describe, expect, it } from 'vitest'
import { FocusEngine, DEFAULT_CONFIG } from './focusEngine'
import type { Cone, EngineConfig, Frame, Media } from './focusEngine'

const STEP_MS = 200 // 5fps

interface FrameSpec {
  n: number
  faceFound?: boolean
  yaw?: number | null
  pitch?: number | null
  eyeBlink?: number | null
  objects?: string[]
}

/** Synthetic-frame helper: stitches spec chunks into one 5fps timeline. */
function buildFrames(specs: FrameSpec[]): Frame[] {
  const frames: Frame[] = []
  let t = 0
  for (const spec of specs) {
    const { n, faceFound = true, yaw = 0, pitch = 0, eyeBlink = 0, objects = [] } = spec
    for (let i = 0; i < n; i++) {
      frames.push({ t, faceFound, yaw, pitch, eyeBlink, objects })
      t += STEP_MS
    }
  }
  return frames
}

const CONE: Cone = { yawMid: 0, yawTol: 0.15, pitchMid: 0, pitchTol: 0.15 }
const OUT_OF_CONE_YAW = 0.5 // well past a 0.15 rad tolerance

function runAll(engine: FocusEngine, frames: Frame[]) {
  let last = engine.step(frames[0]!)
  for (const f of frames.slice(1)) {
    last = engine.step(f)
  }
  return last
}

function newEngine(declaredMedia: Media[], cfg: EngineConfig = DEFAULT_CONFIG) {
  return new FocusEngine(cfg, CONE, declaredMedia)
}

describe('FocusEngine', () => {
  it('(a) 100 in-cone frames -> FOKUS', () => {
    const frames = buildFrames([{ n: 100, yaw: 0, pitch: 0 }])
    const out = runAll(newEngine([]), frames)
    expect(out.state).toBe('FOKUS')
  })

  it('(b) in-cone, then 20 out-of-cone frames (4s @5fps) -> TERALIH', () => {
    const frames = buildFrames([
      { n: 10, yaw: 0, pitch: 0 },
      { n: 20, yaw: OUT_OF_CONE_YAW, pitch: 0 },
    ])
    const out = runAll(newEngine([]), frames)
    expect(out.state).toBe('TERALIH')
  })

  it('(c) recovery in-cone frames -> FOKUS', () => {
    // BUILD_PROMPTS' "8 frames (1.6s)" assumes the hysteresis clock starts
    // the instant the raw signal crosses back into the cone. Because the
    // cone test runs on the EMA-smoothed signal (PRD §5: smooth, then
    // test, then debounce), a hard synthetic jump from 0.5 rad back to 0
    // first has to decay through the EMA before it even reads as
    // "in cone," then still needs 1.5s of continuously-true after that.
    // 16 frames (3.2s) comfortably covers both: ~1s of EMA settling plus
    // the 1.5s hysteresis window, with margin. See focusEngine.ts's
    // module docstring for the full precedence order.
    const frames = buildFrames([
      { n: 10, yaw: 0, pitch: 0 },
      { n: 20, yaw: OUT_OF_CONE_YAW, pitch: 0 },
      { n: 16, yaw: 0, pitch: 0 },
    ])
    const out = runAll(newEngine([]), frames)
    expect(out.state).toBe('FOKUS')
  })

  it('(d) only 10 out-of-cone frames (2s) -> still FOKUS (hysteresis holds)', () => {
    const frames = buildFrames([
      { n: 100, yaw: 0, pitch: 0 },
      { n: 10, yaw: OUT_OF_CONE_YAW, pitch: 0 },
    ])
    const out = runAll(newEngine([]), frames)
    expect(out.state).toBe('FOKUS')
  })

  it('(e) 26 frames faceFound:false -> TIDAK_HADIR', () => {
    const frames = buildFrames([{ n: 26, faceFound: false, yaw: null, pitch: null, eyeBlink: null }])
    const out = runAll(newEngine([]), frames)
    expect(out.state).toBe('TIDAK_HADIR')
  })

  it('(f) declared book + cell phone present 76 frames (15.2s) -> TERALIH', () => {
    const frames = buildFrames([
      { n: 76, yaw: OUT_OF_CONE_YAW, pitch: 0, objects: ['cell phone'] },
    ])
    const out = runAll(newEngine(['book']), frames)
    expect(out.state).toBe('TERALIH')
  })

  it('(g) declared phone + cell phone present, in cone -> FOKUS', () => {
    const frames = buildFrames([{ n: 20, yaw: 0, pitch: 0, objects: ['cell phone'] }])
    const out = runAll(newEngine(['phone']), frames)
    expect(out.state).toBe('FOKUS')
  })

  it('(h) declared book, out of cone, no phone -> UNCERTAIN', () => {
    const frames = buildFrames([{ n: 20, yaw: OUT_OF_CONE_YAW, pitch: 0 }])
    const out = runAll(newEngine(['book']), frames)
    expect(out.state).toBe('UNCERTAIN')
  })

  it('(i) eyeBlink 0.8 for 21 frames -> MENGANTUK', () => {
    const frames = buildFrames([{ n: 21, yaw: 0, pitch: 0, eyeBlink: 0.8 }])
    const out = runAll(newEngine([]), frames)
    expect(out.state).toBe('MENGANTUK')
  })

  it('(j) useObjects:false makes case (f) return UNCERTAIN instead', () => {
    const frames = buildFrames([
      { n: 76, yaw: OUT_OF_CONE_YAW, pitch: 0, objects: ['cell phone'] },
    ])
    const cfg: EngineConfig = { ...DEFAULT_CONFIG, useObjects: false }
    const out = runAll(newEngine(['book'], cfg), frames)
    expect(out.state).toBe('UNCERTAIN')
  })

  it('never coerces UNCERTAIN into FOKUS or TERALIH when no object resolves it', () => {
    const frames = buildFrames([{ n: 50, yaw: OUT_OF_CONE_YAW, pitch: 0 }])
    const out = runAll(newEngine(['laptop']), frames)
    expect(out.state).toBe('UNCERTAIN')
  })

  it('accumulates uncertainMs across UNCERTAIN frames only', () => {
    const frames = buildFrames([
      { n: 10, yaw: 0, pitch: 0 }, // FOKUS
      { n: 20, yaw: OUT_OF_CONE_YAW, pitch: 0 }, // eventually UNCERTAIN
    ])
    const out = runAll(newEngine(['book']), frames)
    expect(out.uncertainMs).toBeGreaterThan(0)
    expect(out.uncertainMs).toBeLessThan(20 * STEP_MS)
  })

  it('reset() clears accumulated state', () => {
    const engine = newEngine(['book'])
    const frames = buildFrames([{ n: 30, yaw: OUT_OF_CONE_YAW, pitch: 0 }])
    runAll(engine, frames)
    engine.reset()
    const out = engine.step({ t: 0, faceFound: true, yaw: 0, pitch: 0, eyeBlink: 0, objects: [] })
    expect(out.uncertainMs).toBe(0)
    expect(out.changedAt).toBe(0)
  })

  it('does not attribute a large frame-timestamp gap (e.g. a pause) as continuous elapsed time', () => {
    // Frame.t comes from performance.now() (see camera.ts), which keeps
    // advancing during a real-world pause even though the UI stops
    // calling step(). The first frame after resuming therefore arrives
    // with a `t` far ahead of the engine's last-seen timestamp - step()
    // must not credit that whole gap as continuously-elapsed UNCERTAIN
    // time, the way a normal ~200ms inter-frame dt would be.
    const frames = buildFrames([{ n: 5, yaw: OUT_OF_CONE_YAW, pitch: 0 }])
    const engine = newEngine(['book'])
    const before = runAll(engine, frames)
    const lastT = frames[frames.length - 1]!.t
    const afterGap = engine.step({ t: lastT + 30_000, faceFound: true, yaw: OUT_OF_CONE_YAW, pitch: 0, eyeBlink: 0, objects: [] })
    expect(afterGap.uncertainMs - before.uncertainMs).toBeLessThan(1000)
  })

  it('changing a threshold in config.ts flips a test (documents the ablation lever)', () => {
    const cfg: EngineConfig = { ...DEFAULT_CONFIG, phoneSustainMs: 100_000 }
    const frames = buildFrames([{ n: 76, yaw: OUT_OF_CONE_YAW, pitch: 0, objects: ['cell phone'] }])
    const out = runAll(newEngine(['book'], cfg), frames)
    // With phoneSustainMs raised well above the recording length, the
    // phone never "sustains" long enough to override - falls through to
    // the ordinary out-of-cone abstention instead of (f)'s TERALIH.
    expect(out.state).toBe('UNCERTAIN')
  })
})
