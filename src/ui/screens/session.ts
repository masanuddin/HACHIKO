import { strings } from '../strings'
import { actions, body, button, cameraDot, card, el, screen, title } from '../components'
import { cssVar } from '../theme'
import { HachikoView } from '../hachiko'
import { BREAK_MS, EXTENSION_MS, STIRRING_RATIO, WORK_MS } from '../sessionConfig'
import { isRawOutOfCone, shouldOfferEarlyBreak, shouldOfferExtension } from '../pacing'
import type { PerceptionBundle } from '../../perception/bundle'
import { startPerceptionLoop } from '../../perception/camera'
import type { FaceReading } from '../../perception/face'
import { FrameAdapter } from '../../perception/adapter'
import { FocusEngine } from '../../engine/focusEngine'
import { DEFAULT_CONFIG } from '../../engine/config'
import type { Cone, FocusState, Media } from '../../engine/types'
import { TelemetryRecorder, persistRecording } from '../../storage/telemetry'
import { emptyDurations, saveSession, listSessions, type DistractionSpan, type SessionRecord } from '../../storage/sessions'
import { deriveCompanionState, findNewMilestone, type Milestone } from '../../storage/companion'
import { renderClarify } from './clarify'
import { renderSessionCard } from './sessionCard'

function formatTimer(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const sec = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function newSessionRecord(declaredMedia: Media[]): SessionRecord {
  return {
    id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: Date.now(),
    declaredMedia,
    durationsMs: emptyDurations(),
    distractionEvents: [],
    recoveryTimesMs: [],
    uncertainMs: 0,
    firstCollapseAtMs: null,
    clarification: null,
  }
}

interface WorkPhaseResult {
  record: SessionRecord
  telemetryJsonl: string
  endedManually: boolean
}

// The mentoring panel's preview box uses the same 4:3 that base.css's
// `.mentor-panel__video` declares, mirroring the calibration preview.
const PANEL_ASPECT = 4 / 3

/**
 * The mentor panel is a thin visualization layer only (see CLAUDE.md /
 * plan): one existing camera stream, one existing perception loop, and
 * the FaceLandmarker landmarks the loop already produces. Nothing here
 * runs a detector or reads the clock.
 */
function isMentorMode(): boolean {
  return new URLSearchParams(location.search).has('mentor')
}

/**
 * Same cover-crop math as calibration.ts's preview (object-fit: cover
 * into a fixed aspect box). Kept local so calibration.ts stays untouched.
 */
function coverCrop(rawW: number, rawH: number, boxAspect: number) {
  const rawAspect = rawW / rawH
  let cropX = 0
  let cropY = 0
  let visibleW = rawW
  let visibleH = rawH
  if (rawAspect > boxAspect) {
    visibleW = rawH * boxAspect
    cropX = (rawW - visibleW) / 2
  } else if (rawAspect < boxAspect) {
    visibleH = rawW / boxAspect
    cropY = (rawH - visibleH) / 2
  }
  return { cropX, cropY, visibleW, visibleH }
}

function toDeg(rad: number | null): string {
  return rad === null ? '-' : `${(rad * (180 / Math.PI)).toFixed(0)}°`
}

/**
 * Draws the face bounding box derived from FaceLandmarker's normalized
 * landmarks (min/max over x/y), transformed from raw video pixels into
 * the cropped panel space, then mirrored by CSS to match the video.
 * `face` is null on ticks where the 5fps face clock didn't fire; it's
 * `faceFound: false` when a face isn't in frame - either way, no box.
 */
function drawMentorOverlay(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  face: FaceReading | null,
  metaEl: HTMLParagraphElement,
): void {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) return

  const crop = coverCrop(w, h, PANEL_ASPECT)
  const targetW = Math.round(crop.visibleW)
  const targetH = Math.round(crop.visibleH)
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW
    canvas.height = targetH
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const landmarks = face && face.faceFound ? face.landmarks : null
  if (landmarks && landmarks.length > 0) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const lm of landmarks) {
      if (lm.x < minX) minX = lm.x
      if (lm.x > maxX) maxX = lm.x
      if (lm.y < minY) minY = lm.y
      if (lm.y > maxY) maxY = lm.y
    }
    const x = minX * w - crop.cropX
    const y = minY * h - crop.cropY
    const bw = (maxX - minX) * w
    const bh = (maxY - minY) * h
    ctx.strokeStyle = cssVar('--amber')
    ctx.lineWidth = 2
    ctx.strokeRect(x, y, bw, bh)
  }

  metaEl.textContent = face
    ? `faceFound: ${face.faceFound} · yaw ${toDeg(face.yaw)} · pitch ${toDeg(face.pitch)}`
    : ''
}

/**
 * S6 Sesi. No focus counter, no distraction count, no score, no
 * percentage during the session (CLAUDE.md) - just the timer, Hachiko,
 * the state label, and the two controls. Selesai ends the session right
 * now, skipping straight to clarification/the card; the timer reaching
 * zero on its own goes through the break screen first.
 */
function runWorkPhase(
  root: HTMLElement,
  video: HTMLVideoElement,
  bundle: PerceptionBundle,
  cone: Cone,
  declaredMedia: Media[],
): Promise<WorkPhaseResult> {
  return new Promise((resolve) => {
    const s = strings.session
    const { root: screenEl, content } = screen({ night: true })

    const timerEl = el('p', { class: 'session__timer' }, [formatTimer(WORK_MS)])
    // A visual mirror of the same time-based countdown the timer text
    // already shows - not a new metric, just another view of it. Never
    // a number of its own (CLAUDE.md: no percentage during the session).
    const progressFill = el('div', { class: 'session__progress-fill' })
    const progressBar = el('div', { class: 'session__progress' }, [progressFill])
    const hachiko = new HachikoView()
    const stateLabel = el('p', { class: 'session__state' }, [''])
    const dot = cameraDot(strings.common.cameraActive)

    let paused = false
    const jedaBtn = button(
      s.jeda,
      () => {
        paused = !paused
        jedaBtn.textContent = paused ? strings.common.continueLabel : s.jeda
      },
      { variant: 'secondary' },
    )
    const selesaiBtn = button(s.selesai, () => finishNow(true), { variant: 'secondary' })
    const nudgeSlot = el('div', { class: 'session__nudge' })

    // The session view never shows the live feed (PRD §9: a dot, not the
    // video), but `video` still has to stay attached to the document for
    // requestVideoFrameCallback to keep firing at all - see the same
    // note in media.ts. This is what was missing before: `video` was
    // never appended anywhere in this screen, so it sat fully detached
    // and the perception loop never produced a single tick.
    const hiddenVideo = el('div', { class: 'visually-hidden' }, [video])

    // Mentoring visualization (URL ?mentor=true only) - a thin floating
    // overlay on the right that reuses the SAME video element and the
    // SAME perception loop below. No second stream, no second detector.
    const mentor = isMentorMode()
    let mentorOverlay: HTMLCanvasElement | null = null
    let mentorOverlayCtx: CanvasRenderingContext2D | null = null
    let mentorState: HTMLParagraphElement | null = null
    let mentorMeta: HTMLParagraphElement | null = null

    if (mentor) {
      // Calibration set this to '0' for its canvas-drawn preview; the
      // mentoring panel shows the real <video>, so restore visibility.
      video.style.opacity = ''

      const overlay = el('canvas', { class: 'mentor-panel__overlay' })
      const videoWrap = el('div', { class: 'mentor-panel__video' }, [video, overlay])
      const panelState = el('p', { class: 'mentor-panel__state' }, [''])
      const panelMeta = el('p', { class: 'mentor-panel__meta' }, [''])
      const panel = el('div', { class: 'mentor-panel' }, [
        el('p', { class: 'mentor-panel__title' }, ['CAMERA']),
        videoWrap,
        panelState,
        panelMeta,
      ])

      mentorOverlay = overlay
      mentorOverlayCtx = overlay.getContext('2d')
      mentorState = panelState
      mentorMeta = panelMeta

      // Appended to the <main> shell (not .screen__content) so the fixed
      // positioning isn't captured by content's enter animation transform.
      screenEl.append(panel)
    }

    const sessionWrap = el('div', { class: 'session' }, [
      timerEl,
      progressBar,
      hachiko.element,
      stateLabel,
      nudgeSlot,
      el('div', { class: 'session__controls' }, [jedaBtn, selesaiBtn]),
      dot,
      ...(mentor ? [] : [hiddenVideo]),
    ])
    content.append(sessionWrap)
    root.replaceChildren(screenEl)

    // The same <video> element was fully detached while the report/break/
    // clarify screens were up (none of them mount it). Once re-attached
    // here, a MediaStream element's frame delivery can stay stalled, which
    // would leave requestVideoFrameCallback (and therefore the perception
    // loop and the countdown) frozen. play() is idempotent - a no-op on an
    // already-playing video - so this is safe for session #1 too.
    void video.play().catch(() => {})

    const engine = new FocusEngine(DEFAULT_CONFIG, cone, declaredMedia)
    const adapter = new FrameAdapter()
    const telemetry = new TelemetryRecorder()
    const record = newSessionRecord(declaredMedia)

    let remainingMs = WORK_MS
    // Whichever duration currently governs the countdown - reassigned
    // alongside remainingMs when an extension is accepted, so the
    // progress bar re-baselines against the new total instead of
    // reading as "past 100%".
    let totalMs = WORK_MS
    let lastFrameT: number | null = null
    let sessionStartT: number | null = null
    let previousState: FocusState | null = null
    let stateEnteredAt = 0
    let openTeralihSpan: DistractionSpan | null = null
    let finished = false

    // Adaptive pacing (ADHD-focused): the app only ever offers, never
    // imposes. See src/ui/pacing.ts for the pure decision functions.
    let rawOutAccumMs = 0
    let offeredEarlyBreak = false
    let extensionOffered = false
    let nudgeVisible: 'earlyBreak' | 'extension' | null = null

    function hideNudge(): void {
      nudgeVisible = null
      nudgeSlot.replaceChildren()
    }

    function showEarlyBreakNudge(): void {
      nudgeVisible = 'earlyBreak'
      const accept = button(s.goToBreak, () => {
        hideNudge()
        finishNow(false)
      })
      const decline = button(s.earlyBreak.decline, hideNudge, { variant: 'secondary' })
      nudgeSlot.replaceChildren(
        card(el('h2', { class: 'card__title' }, [s.earlyBreak.title]), body(s.earlyBreak.body), actions(accept, decline)),
      )
    }

    function showExtensionNudge(): void {
      nudgeVisible = 'extension'
      const accept = button(s.extension.accept, () => {
        hideNudge()
        remainingMs = EXTENSION_MS
        totalMs = EXTENSION_MS
      })
      const decline = button(s.goToBreak, () => {
        hideNudge()
        finishNow(false)
      }, { variant: 'secondary' })
      nudgeSlot.replaceChildren(
        card(el('h2', { class: 'card__title' }, [s.extension.title]), body(s.extension.body), actions(accept, decline)),
      )
    }

    const loop = startPerceptionLoop(video, bundle.faceLandmarker, bundle.objectDetector, (tick) => {
      if (mentorOverlayCtx && mentorOverlay && mentorMeta) {
        drawMentorOverlay(mentorOverlay, mentorOverlayCtx, video, tick.face, mentorMeta)
      }
      if (paused || finished) return
      const frame = adapter.toFrame(tick)
      if (!frame) return

      if (sessionStartT === null) sessionStartT = frame.t
      const relativeT = frame.t - sessionStartT

      telemetry.record(frame)

      const dt = lastFrameT === null ? 0 : Math.max(0, frame.t - lastFrameT)
      lastFrameT = frame.t

      const out = engine.step(frame)

      if (out.state !== previousState) {
        if (previousState === 'TERALIH' && openTeralihSpan) {
          openTeralihSpan.end = relativeT
          record.distractionEvents.push(openTeralihSpan)
          openTeralihSpan = null
        }
        if (out.state === 'TERALIH') {
          openTeralihSpan = { start: relativeT, end: relativeT }
        }
        if (previousState === 'TERALIH' && out.state === 'FOKUS') {
          record.recoveryTimesMs.push(relativeT - stateEnteredAt)
        }
        if (previousState === 'FOKUS' && out.state === 'TERALIH' && record.firstCollapseAtMs === null) {
          record.firstCollapseAtMs = relativeT
        }
        previousState = out.state
        stateEnteredAt = relativeT
      }

      record.durationsMs[out.state] += dt
      record.uncertainMs = out.uncertainMs

      if (out.state !== 'TIDAK_HADIR') {
        remainingMs = Math.max(0, remainingMs - dt)
      }

      // Independent of the engine's own hysteresis (see pacing.ts) - a
      // soft early foreshadow, not a second decision-maker.
      rawOutAccumMs = isRawOutOfCone(frame, cone) ? rawOutAccumMs + dt : 0
      const stirring = rawOutAccumMs >= STIRRING_RATIO * DEFAULT_CONFIG.toDistractedMs

      timerEl.textContent = formatTimer(remainingMs)
      progressFill.style.width = `${Math.min(1, Math.max(0, 1 - remainingMs / totalMs)) * 100}%`
      stateLabel.textContent = s.stateLabels[out.state]
      if (mentorState) mentorState.textContent = s.stateLabels[out.state]
      hachiko.setState(out.state, stirring)

      if (!nudgeVisible) {
        if (
          remainingMs > 0 &&
          !offeredEarlyBreak &&
          shouldOfferEarlyBreak(WORK_MS, remainingMs, record.durationsMs)
        ) {
          offeredEarlyBreak = true
          showEarlyBreakNudge()
        } else if (remainingMs <= 0) {
          if (!extensionOffered && shouldOfferExtension(out.state, relativeT - stateEnteredAt)) {
            extensionOffered = true
            showExtensionNudge()
          } else {
            finishNow(false)
          }
        }
      }
    })

    function finishNow(endedManually: boolean): void {
      if (finished) return
      finished = true
      loop.stop()
      // The camera stream and the perception bundle deliberately stay
      // alive here: "Ulangi sesi" reuses them for a follow-up session
      // without re-prompting permission or re-calibrating. main.ts stops
      // the camera exactly once, after the student finally chooses
      // "Selesai".
      const telemetryJsonl = telemetry.toJsonl()
      persistRecording(record.id, telemetryJsonl)
      root.replaceChildren()
      resolve({ record, telemetryJsonl, endedManually })
    }
  })
}

function renderBreak(root: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const s = strings.session
    const { root: screenEl, content } = screen()

    const countdown = el('p', { class: 'screen__title' }, [formatTimer(BREAK_MS)])
    let remaining = BREAK_MS

    const finish = () => {
      window.clearInterval(interval)
      root.replaceChildren()
      resolve()
    }

    const lanjutBtn = button(strings.common.continueLabel, finish)
    content.append(title(s.breakTitle), body(s.breakBody), countdown, actions(lanjutBtn))
    root.replaceChildren(screenEl)

    const interval = window.setInterval(() => {
      remaining = Math.max(0, remaining - 1000)
      countdown.textContent = formatTimer(remaining)
      if (remaining <= 0) finish()
    }, 1000)
  })
}

export async function runSession(
  root: HTMLElement,
  video: HTMLVideoElement,
  bundle: PerceptionBundle,
  cone: Cone,
  declaredMedia: Media[],
): Promise<boolean> {
  const { record, telemetryJsonl, endedManually } = await runWorkPhase(root, video, bundle, cone, declaredMedia)

  if (!endedManually) {
    await renderBreak(root)
  }

  if (record.uncertainMs > 0) {
    const answer = await renderClarify(root)
    record.clarification = { answer }
  }

  const now = Date.now()
  const before = deriveCompanionState(listSessions(), now)
  saveSession(record)
  const after = deriveCompanionState(listSessions(), now)
  const milestone: Milestone | null = findNewMilestone(before, after)

  // true → the student asked to repeat via "Ulangi sesi" on the card.
  return (await renderSessionCard(root, record, telemetryJsonl, milestone)) === 'repeat'
}
