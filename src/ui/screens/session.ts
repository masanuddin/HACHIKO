import { strings } from '../strings'
import { actions, body, button, cameraDot, card, confirmOverlay, el, screen, title } from '../components'
import { cssVar } from '../theme'
import { HachikoView, mascotPeek } from '../hachiko'
import {
  BREAK_ABANDON_MS,
  EARLY_STOP_RATIO,
  EXTENSION_MS,
  FAST_DEBUG_BREAK_MS,
  FAST_DEBUG_LONG_BREAK_MS,
  MAX_PLAUSIBLE_DT_MS,
  NUDGE_AUTO_DISMISS_MS,
  STIRRING_RATIO,
  isFastDebugMode,
} from '../sessionConfig'
import { isRawOutOfCone, shouldOfferEarlyBreak, shouldOfferExtension } from '../pacing'
import type { PerceptionBundle } from '../../perception/bundle'
import { startFaceBoxLoop, startPerceptionLoop, type OverlayLoopHandle } from '../../perception/camera'
import type { FaceBox } from '../../perception/faceBox'
import type { AiObjectDiagnostics, AiTelemetryFrame } from '../../perception/aiAdapter'
import { FocusEngine, DEFAULT_CONFIG } from '../../engine/focusEngine'
import type { Cone, EngineOutput, FocusState, Frame, Media } from '../../engine/focusEngine'
import { TelemetryRecorder, persistRecording } from '../../storage/telemetry'
import { emptyDurations, mergeSessionRecords, saveSession, listSessions, type DistractionSpan, type SessionRecord } from '../../storage/sessions'
import { deriveCompanionState, findNewMilestone, type Milestone } from '../../storage/companion'
import { renderClarify } from './clarify'
import { renderSessionCard } from './sessionCard'

function formatTimer(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const sec = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function newSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function newSessionRecord(declaredMedia: Media[], studyTopic?: string): SessionRecord {
  return {
    id: newSessionId(),
    startedAt: Date.now(),
    declaredMedia,
    ...(studyTopic ? { studyTopic } : {}),
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

/** Canonical detector label for the phone class (mirrors the AI-Engine config). */
const PHONE_LABEL = 'cell phone'

/** COCO-90 zero-based index of 'cell phone' (AI-Engine labelIndices.PHONE). */
const PHONE_COCO_INDEX = 76

/**
 * Mentor-only: how long the last ACCEPTED phone box may be redrawn after its
 * detection tick before being considered stale. Object inference runs about
 * once per second, so ~1.5 s covers one missed tick without lingering.
 */
const PHONE_BOX_STALE_MS = 1500

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
 * Draws the face bounding box from the UI-only BlazeFace loop (faceBox.ts),
 * transformed from raw video pixels into the cropped panel space, then
 * mirrored by CSS to match the video. The old implementation derived this
 * box from FaceLandmarker landmarks; the AI-Engine face engine emits
 * measurements, not landmarks, so the debug box now comes from the cheap
 * overlay detector - it still never feeds the FocusEngine.
 */
function drawMentorBox(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  box: FaceBox | null,
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

  if (box) {
    const x = box.originX - crop.cropX
    const y = box.originY - crop.cropY
    ctx.strokeStyle = cssVar('--amber')
    ctx.lineWidth = 2
    ctx.strokeRect(x, y, box.width, box.height)
  }
}

/**
 * Draws the diagnostic phone box from the LAST ACCEPTED 'cell phone'
 * detection, transformed into the same cropped panel space as the face box.
 * The label glyphs are un-mirrored so they stay readable on the CSS-flipped
 * overlay canvas (base.css mirrors both video and overlay). Mentor mode only;
 * purely observational, sourced from the single existing object pipeline.
 */
function drawMentorPhoneBox(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  phone: { originX: number; originY: number; width: number; height: number; confidence: number } | null,
): void {
  if (!phone) return
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) return

  const crop = coverCrop(w, h, PANEL_ASPECT)
  const x = phone.originX - crop.cropX
  const y = phone.originY - crop.cropY

  ctx.strokeStyle = cssVar('--sage')
  ctx.lineWidth = 2
  ctx.strokeRect(x, y, phone.width, phone.height)

  const label = `cell phone ${phone.confidence.toFixed(2)}`
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillStyle = cssVar('--sage')
  ctx.save()
  // The overlay canvas is mirrored by CSS to align with the mirrored video,
  // so mirror the glyphs back here. Anchoring at the box's right edge (its
  // on-screen left edge) makes the label read correctly after the CSS flip.
  ctx.translate(x + phone.width, y + 14)
  ctx.scale(-1, 1)
  ctx.fillText(label, 0, 0)
  ctx.restore()
}

/** Mentor meta line, fed by the AI-Engine perception tick's adapted frame. */
function updateMentorMeta(metaEl: HTMLParagraphElement, frame: Frame): void {
  metaEl.textContent = `faceFound: ${frame.faceFound} · yaw ${toDeg(frame.yaw)} · pitch ${toDeg(frame.pitch)}`
}

/** Active-phone-event subset used by the mentor CONTEXT group. */
interface AiPhoneEventRecord {
  status: string
  context: string
  durationMs: number
}

const fmtDeg = (v: number | null | undefined): string => (v == null ? '—' : `${v.toFixed(1)}°`)
const fmtEar = (v: number | null | undefined): string => (v == null ? '—' : v.toFixed(3))
const fmtNum = (v: number | null | undefined, digits = 0): string => (v == null ? '—' : v.toFixed(digits))
const fmtConf = (v: number | null | undefined): string => (v == null ? '—' : v.toFixed(2))
const fmtSeconds = (v: number | null | undefined): string => (v == null ? '—' : `${(v / 1000).toFixed(1)}s`)

/**
 * OBJECTS block for the mentor panel. Distinguishes the four detector states
 * the phone-recall diagnostic needs - idle / ran-nothing / ran-rejected /
 * phone-accepted - using the SAME telemetry the adapter consumes plus the
 * ObjectDetectorEngine diagnostics snapshot. Observation only; nothing here
 * feeds FocusEngine or any decision path.
 */
function buildObjectDiagnosticLines(
  t: AiTelemetryFrame,
  diag: AiObjectDiagnostics | null,
): string[] {
  const o = t.objects
  const acceptedPhone = o.detections.find((d) => d.category === PHONE_LABEL)

  const lines = [
    `  person: ${o.primaryPersonPresent} (${fmtConf(o.primaryPersonConfidence)})`,
    `  phone: ${o.phonePresent} (${fmtConf(o.phoneConfidence)})`,
  ]

  if (!o.detectorRan) {
    lines.push('  detector: IDLE (did not run this tick)')
    lines.push('  cell phone raw: —')
    lines.push('  phone bbox: —')
    return lines
  }

  // Diagnostics are written by the same synchronous detect() call that
  // produced this tick's detections, so a matching timestamp proves the
  // snapshot is from THIS run rather than a stale previous one.
  const fresh = diag !== null && diag.lastTimestampMs === t.timestampMs
  const raw = fresh && diag ? diag.lastRawDetections : []

  const rawPhone = raw.find(
    (d) => d.index === PHONE_COCO_INDEX || d.categoryName === PHONE_LABEL,
  )

  let state: string
  if (!fresh) {
    state = 'RAN'
  } else if (rawPhone && acceptedPhone) {
    state = 'RAN — PHONE ACCEPTED'
  } else if (rawPhone) {
    state = 'RAN — PHONE REJECTED'
  } else if (raw.length === 0) {
    state = 'RAN — NO DETECTIONS'
  } else {
    state = 'RAN'
  }
  lines.push(`  detector: ${state}`)

  if (!fresh || !diag) {
    lines.push('  cell phone raw: — (diagnostics unavailable)')
  } else if (!rawPhone) {
    lines.push('  cell phone raw: none')
  } else if (acceptedPhone) {
    lines.push(`  cell phone raw: ${fmtConf(rawPhone.score)} (accepted)`)
  } else {
    const rejects = Object.keys(diag.lastRejectReasons)
    const reason = rejects.find((r) => r.startsWith('PHONE')) ?? rejects[0] ?? 'REJECTED'
    lines.push(`  cell phone raw: ${fmtConf(rawPhone.score)} (rejected: ${reason})`)
  }

  if (fresh && diag && raw.length > 0) {
    const rawLine = raw.slice(0, 4).map((d) =>
      `${d.categoryName ?? `#${d.index}`} ${d.score.toFixed(2)}`).join(' · ')
    lines.push(`  raw: ${rawLine}`)
  }

  if (fresh && diag && Object.keys(diag.lastRejectReasons).length > 0) {
    const rejectsLine = Object.entries(diag.lastRejectReasons)
      .map(([reason, count]) => `${reason}×${count}`).join(', ')
    lines.push(`  rejects: ${rejectsLine}`)
  }

  if (fresh && diag && Object.keys(diag.observedCategories).length > 0) {
    const catsLine = Object.entries(diag.observedCategories)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([key, count]) => `${key}×${count}`).join(' · ')
    lines.push(`  cats: ${catsLine}`)
  }

  lines.push(`  phone bbox: ${acceptedPhone && acceptedPhone.boundingBox ? 'visible' : 'unavailable'}`)

  return lines
}

/**
 * Grouped AI telemetry for the mentor panel. Consumes the SAME telemetry the
 * adapter builds the Frame from - no second detector, no second pipeline.
 * The OBJECTS block additionally reads the ObjectDetectorEngine diagnostics
 * snapshot (raw detections, rejection reasons, observed categories) -
 * observation only, never an input to FocusEngine. The STATE group shows the
 * HACHIKO FocusEngine output only; the AI's own internal classification is
 * deliberately not rendered.
 */
function renderMentorTelemetry(
  el: HTMLElement,
  t: AiTelemetryFrame,
  lastOut: EngineOutput | null,
  phoneEvents: AiPhoneEventRecord[],
  objectDiag: AiObjectDiagnostics | null,
): void {
  const m = t.measurement
  const activePhone = phoneEvents.find((e) => e.status === 'ACTIVE')
  const ctx = t.sessionContext

  el.textContent = [
    'FACE',
    `  faceFound: ${m.facePresent} · presence ${t.presence.status}`,
    '',
    'HEAD',
    `  yaw ${fmtDeg(m.yawRaw)}  pitch ${fmtDeg(m.pitchRaw)}`,
    '',
    'EYES',
    `  EAR L ${fmtEar(m.earLeft)}  R ${fmtEar(m.earRight)}  mean ${fmtEar(m.earMean)}`,
    `  earRelative ${fmtNum(t.calibrated.earRelative, 2)}`,
    `  eligible ${t.evidence?.eyeEligible ?? '—'}${t.evidence?.eyeIneligibleReason ? ` (${t.evidence.eyeIneligibleReason})` : ''}`,
    '',
    'OBJECTS',
    ...buildObjectDiagnosticLines(t, objectDiag),
    '',
    'CONTEXT',
    `  tools: ${ctx ? ctx.learningTools.join(', ') : '(none)'}`,
    `  includesPhone: ${ctx ? ctx.declaredIncludesPhone : '—'}`,
    `  phoneContext: ${activePhone ? activePhone.context : '—'}`,
    `  phoneEvent: ${activePhone ? `#${activePhone.status} ${fmtSeconds(activePhone.durationMs)}` : '—'}`,
    '',
    'STATE',
    `  ${lastOut ? lastOut.state : '—'}`,
    '',
    'PERFORMANCE',
    `  fps ${fmtNum(t.performance?.fps, 1)} · face ${fmtNum(t.performance?.faceInferenceMs, 0)}ms · object ${fmtNum(t.performance?.objectInferenceMs, 0)}ms`,
  ].join('\n')
}

/**
 * S6 Sesi. No focus counter, no distraction count, no score, no
 * percentage during the session (CLAUDE.md) - just the timer, Hachiko,
 * the state label, and the two controls. Selesai now pauses the timer
 * and asks for confirmation before ending the entire multi-cycle plan;
 * confirming skips Break and goes straight to clarification/the card.
 * The timer reaching zero on its own still goes through Break first,
 * and, if the student chooses to continue, another Work cycle after that.
 */
function runWorkPhase(
  root: HTMLElement,
  video: HTMLVideoElement,
  bundle: PerceptionBundle,
  cone: Cone,
  declaredMedia: Media[],
  studyTopic: string | undefined,
  workMs: number,
): Promise<WorkPhaseResult> {
  return new Promise((resolve) => {
    const s = strings.session
    const { root: screenEl, content } = screen({ night: true })

    const timerEl = el('p', { class: 'session__timer' }, [formatTimer(workMs)])
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
    const lewatiBtn = button(strings.common.skip, showLewatiConfirm, { variant: 'secondary' })
    const selesaiBtn = button(s.selesai, showSelesaiConfirm, { variant: 'secondary' })
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
    let mentorTelemetry: HTMLDivElement | null = null
    let mentorBoxLoop: OverlayLoopHandle | null = null
    // Diagnostic-only: the last ACCEPTED 'cell phone' detection, held so the
    // overlay can redraw it between the ~1 s object-inference ticks and
    // dropped once PHONE_BOX_STALE_MS passes. Mentor visualization only -
    // this state never reaches FocusEngine or any storage path.
    let lastPhoneBox: {
      originX: number
      originY: number
      width: number
      height: number
      confidence: number
      seenAt: number
    } | null = null

    if (mentor) {
      // Calibration set this to '0' for its canvas-drawn preview; the
      // mentoring panel shows the real <video>, so restore visibility.
      video.style.opacity = ''

      const overlay = el('canvas', { class: 'mentor-panel__overlay' })
      const videoWrap = el('div', { class: 'mentor-panel__video' }, [video, overlay])
      const panelState = el('p', { class: 'mentor-panel__state' }, [''])
      const panelMeta = el('p', { class: 'mentor-panel__meta' }, [''])
      const panelTelemetry = el('div', { class: 'mentor-panel__telemetry' }, [''])
      const panel = el('div', { class: 'mentor-panel' }, [
        el('p', { class: 'mentor-panel__title' }, ['CAMERA']),
        videoWrap,
        panelState,
        panelMeta,
        panelTelemetry,
      ])

      mentorOverlay = overlay
      mentorOverlayCtx = overlay.getContext('2d')
      mentorState = panelState
      mentorMeta = panelMeta
      mentorTelemetry = panelTelemetry

      // The bounding box comes from the UI-only BlazeFace overlay loop; the
      // meta text and telemetry come from the AI perception tick below.
      mentorBoxLoop = startFaceBoxLoop(video, bundle.faceDetector, (box, ts) => {
        if (!mentorOverlayCtx || !mentorOverlay) return
        if (lastPhoneBox && ts - lastPhoneBox.seenAt > PHONE_BOX_STALE_MS) lastPhoneBox = null
        drawMentorBox(mentorOverlay, mentorOverlayCtx, video, box)
        drawMentorPhoneBox(mentorOverlayCtx, video, lastPhoneBox)
      })

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
      el('div', { class: 'session__controls' }, [jedaBtn, lewatiBtn, selesaiBtn]),
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
    // The student's declared learning tools flow straight into the AI core as
    // provenance for phone events (EXPECTED_TOOL / DISTRACTION_CANDIDATE).
    // The AI-Engine session context never decides a state - FocusEngine keeps
    // its own declaredMedia argument and remains the sole authority.
    bundle.ai.setSessionContext({ learningTools: declaredMedia })
    const telemetry = new TelemetryRecorder()
    const record = newSessionRecord(declaredMedia, studyTopic)

    let remainingMs = workMs
    // Whichever duration currently governs the countdown - reassigned
    // alongside remainingMs when an extension is accepted, so the
    // progress bar re-baselines against the new total instead of
    // reading as "past 100%".
    let totalMs = workMs
    let lastFrameT: number | null = null
    let sessionStartT: number | null = null
    let previousState: FocusState | null = null
    let stateEnteredAt = 0
    let openTeralihSpan: DistractionSpan | null = null
    let finished = false
    // Last FocusEngine output, for the mentor STATE group (updates on the
    // next tick while paused, since the engine is not stepped when paused).
    let lastOut: EngineOutput | null = null

    // Adaptive pacing (ADHD-focused): the app only ever offers, never
    // imposes. See src/ui/pacing.ts for the pure decision functions.
    let rawOutAccumMs = 0
    let offeredEarlyBreak = false
    let extensionOffered = false
    let nudgeVisible: 'earlyBreak' | 'extension' | 'selesaiConfirm' | 'lewatiConfirm' | null = null
    let pausedBeforeSelesaiConfirm = false
    let pausedBeforeLewatiConfirm = false

    function hideNudge(): void {
      nudgeVisible = null
      nudgeSlot.replaceChildren()
    }

    /**
     * "Selesai" now ends the entire multi-cycle plan (see runSession),
     * not just the current cycle - a much bigger commitment than before,
     * so an accidental tap gets a confirm instead of ending immediately.
     * Pauses (reusing the same `paused` flag Jeda uses) so no frames are
     * processed while the card is up; "Lanjut fokus" restores whatever
     * paused state the student was actually in before this tap.
     */
    function showSelesaiConfirm(): void {
      pausedBeforeSelesaiConfirm = paused
      paused = true
      nudgeVisible = 'selesaiConfirm'

      function cancel(): void {
        paused = pausedBeforeSelesaiConfirm
        jedaBtn.textContent = paused ? strings.common.continueLabel : s.jeda
        hideNudge()
        overlay.close()
      }

      // Stopping well short of the committed time gets a neutral mascot
      // reaction (not a sad one - see hachiko.ts's note on why "crying"
      // is never used) instead of the plain text-only confirm.
      const elapsedMs = totalMs - remainingMs
      const stoppingEarly = elapsedMs < totalMs * EARLY_STOP_RATIO
      const dialogChildren: (Node | string)[] = []
      if (stoppingEarly) dialogChildren.push(mascotPeek('drowsy'))
      dialogChildren.push(
        el('h2', { class: 'card__title' }, [s.selesaiConfirmTitle]),
        actions(
          button(s.selesaiConfirmNo, cancel, { variant: 'secondary' }),
          button(s.selesaiConfirmYes, () => {
            hideNudge()
            overlay.close()
            finishNow(true)
          }),
        ),
      )

      const overlay = confirmOverlay(screenEl, dialogChildren, cancel)
    }

    /**
     * "Lewati" ends only THIS work block early and moves straight to
     * Break - the same outcome as accepting the adaptive early-break
     * nudge (finishNow(false)), just manually triggered instead of
     * offered. Deliberately its own button rather than folded into the
     * Selesai confirm (see the 2026-09-20 brainstorm: student explicitly
     * chose two separate buttons over one button with two choices), so
     * this mirrors showSelesaiConfirm's structure closely on purpose -
     * same pause/confirm/neutral-mascot treatment, different finishNow
     * argument and copy.
     */
    function showLewatiConfirm(): void {
      pausedBeforeLewatiConfirm = paused
      paused = true
      nudgeVisible = 'lewatiConfirm'

      function cancel(): void {
        paused = pausedBeforeLewatiConfirm
        jedaBtn.textContent = paused ? strings.common.continueLabel : s.jeda
        hideNudge()
        overlay.close()
      }

      // Same "stopping early gets a neutral reaction" treatment as
      // Selesai - skipping to break is, by definition, almost always
      // early relative to the full block.
      const elapsedMs = totalMs - remainingMs
      const stoppingEarly = elapsedMs < totalMs * EARLY_STOP_RATIO
      const dialogChildren: (Node | string)[] = []
      if (stoppingEarly) dialogChildren.push(mascotPeek('drowsy'))
      dialogChildren.push(
        el('h2', { class: 'card__title' }, [s.lewatiConfirmTitle]),
        actions(
          button(s.selesaiConfirmNo, cancel, { variant: 'secondary' }),
          button(s.goToBreak, () => {
            hideNudge()
            overlay.close()
            finishNow(false)
          }),
        ),
      )

      const overlay = confirmOverlay(screenEl, dialogChildren, cancel)
    }

    function showEarlyBreakNudge(): void {
      nudgeVisible = 'earlyBreak'
      const decline = () => hideNudge()
      const accept = button(s.goToBreak, () => {
        hideNudge()
        finishNow(false)
      })
      const declineBtn = button(s.earlyBreak.decline, decline, { variant: 'secondary' })
      nudgeSlot.replaceChildren(
        card(el('h2', { class: 'card__title' }, [s.earlyBreak.title]), body(s.earlyBreak.body), actions(accept, declineBtn)),
      )
      // Ignored offers must not block the timer reaching 0 forever - see
      // NUDGE_AUTO_DISMISS_MS in sessionConfig.ts.
      window.setTimeout(() => {
        if (!finished && nudgeVisible === 'earlyBreak') decline()
      }, NUDGE_AUTO_DISMISS_MS)
    }

    function showExtensionNudge(): void {
      nudgeVisible = 'extension'
      const decline = () => {
        hideNudge()
        finishNow(false)
      }
      const accept = button(s.extension.accept, () => {
        hideNudge()
        remainingMs = EXTENSION_MS
        totalMs = EXTENSION_MS
      })
      const declineBtn = button(s.goToBreak, decline, { variant: 'secondary' })
      nudgeSlot.replaceChildren(
        card(el('h2', { class: 'card__title' }, [s.extension.title]), body(s.extension.body), actions(accept, declineBtn)),
      )
      // Ignored offers must not block the session from moving on - see
      // NUDGE_AUTO_DISMISS_MS in sessionConfig.ts.
      window.setTimeout(() => {
        if (!finished && nudgeVisible === 'extension') decline()
      }, NUDGE_AUTO_DISMISS_MS)
    }

    const loop = startPerceptionLoop(video, bundle.ai, bundle.faceEngine, bundle.objectEngine, (tick) => {
      if (mentor) {
        // Capture the highest-confidence ACCEPTED phone detection so the
        // overlay can hold it across idle object-inference ticks. Accepted
        // detections only - raw diagnostics never reach this state.
        let bestPhone: typeof lastPhoneBox = null
        for (const d of tick.telemetry.objects.detections) {
          if (d.category !== PHONE_LABEL || !d.boundingBox) continue
          if (!bestPhone || d.confidence > bestPhone.confidence) {
            bestPhone = {
              originX: d.boundingBox.originX,
              originY: d.boundingBox.originY,
              width: d.boundingBox.width,
              height: d.boundingBox.height,
              confidence: d.confidence,
              seenAt: tick.timestampMs,
            }
          }
        }
        if (bestPhone) lastPhoneBox = bestPhone
      }
      if (mentorMeta) updateMentorMeta(mentorMeta, tick.frame)
      if (mentorTelemetry) {
        renderMentorTelemetry(
          mentorTelemetry,
          tick.telemetry,
          lastOut,
          bundle.ai.getPhoneEvents() as unknown as AiPhoneEventRecord[],
          bundle.objectEngine.getDiagnostics() as unknown as AiObjectDiagnostics,
        )
      }
      const frame = tick.frame

      // Tracked unconditionally - even while paused/finished - so a
      // manual "Jeda" pause never shows up as a large gap once ticks
      // resume (frames keep arriving normally while paused; only the
      // business logic below is skipped). Only a REAL perception stall
      // (see remainingMs below) should ever look large.
      const rawDt = lastFrameT === null ? 0 : Math.max(0, frame.t - lastFrameT)
      lastFrameT = frame.t

      if (paused || finished) return

      if (sessionStartT === null) sessionStartT = frame.t
      const relativeT = frame.t - sessionStartT

      telemetry.record(frame)

      // Clamped: a single implausible gap (GC pause, a slow inference
      // tick) must never get attributed wholesale to whatever FocusState
      // was last reported - see MAX_PLAUSIBLE_DT_MS's own comment.
      const dt = rawDt > MAX_PLAUSIBLE_DT_MS ? 0 : rawDt

      const out = engine.step(frame)
      lastOut = out

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

      // Deliberately the UNCLAMPED rawDt, not the engine's own clamped dt
      // above - a genuine perception stall (this tab backgrounded; see
      // startPerceptionLoop's doc comment on why requestVideoFrameCallback
      // was chosen specifically so this keeps running then) must not
      // leave the visible countdown looking permanently frozen. It
      // catches up to the real elapsed time the moment ticks resume,
      // rather than silently losing that time forever. `lastFrameT` is
      // tracked above regardless of pause, so a manual Jeda pause can
      // never inflate rawDt the same way.
      if (out.state !== 'TIDAK_HADIR') {
        remainingMs = Math.max(0, remainingMs - rawDt)
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
          shouldOfferEarlyBreak(workMs, remainingMs, record.durationsMs)
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
      mentorBoxLoop?.stop()
      // The camera stream and the perception bundle deliberately stay
      // alive here: runSession's loop reuses them for the next cycle
      // without re-prompting permission or re-calibrating, and stops
      // the camera exactly once, after the whole multi-cycle plan ends.
      // Telemetry is persisted once too, by runSession, after every
      // cycle's JSONL is joined into one file - not per cycle here.
      const telemetryJsonl = telemetry.toJsonl()
      root.replaceChildren()
      resolve({ record, telemetryJsonl, endedManually })
    }
  })
}

/**
 * Two explicit choices, not a countdown-gated single button: the
 * student decides fresh after each cycle whether to do another one.
 * Both buttons are available immediately; the countdown keeps ticking
 * for company but holds at 0:00 rather than auto-picking anything.
 * `isLongBreak` (see runSession's ROUNDS_PER_SET tracking) swaps in a
 * longer duration and different copy - everything else is identical.
 */
function renderBreak(
  root: HTMLElement,
  isLongBreak: boolean,
  shortBreakMs: number,
  longBreakMs: number,
): Promise<{ continueSession: boolean }> {
  return new Promise((resolve) => {
    const s = strings.session
    const { root: screenEl, content } = screen()

    const breakMs = isLongBreak
      ? isFastDebugMode()
        ? FAST_DEBUG_LONG_BREAK_MS
        : longBreakMs
      : isFastDebugMode()
        ? FAST_DEBUG_BREAK_MS
        : shortBreakMs
    const countdown = el('p', { class: 'screen__title' }, [formatTimer(breakMs)])
    let remaining = breakMs
    let settled = false

    const choose = (continueSession: boolean) => {
      if (settled) return
      settled = true
      window.clearInterval(countdownInterval)
      window.clearTimeout(abandonTimeout)
      root.replaceChildren()
      resolve({ continueSession })
    }

    // Both choices are one tap from a real commitment (another full cycle,
    // or ending the whole multi-cycle plan) - a misclick gets a confirm
    // overlay floating above the buttons, not an immediate action.
    function showContinueConfirm(): void {
      const overlay = confirmOverlay(
        screenEl,
        [
          el('h2', { class: 'card__title' }, [s.breakContinueConfirmTitle]),
          actions(
            button(s.breakConfirmCancel, () => overlay.close(), { variant: 'secondary' }),
            button(s.breakContinueConfirmYes, () => {
              overlay.close()
              choose(true)
            }),
          ),
        ],
        () => overlay.close(),
      )
    }

    function showStopConfirm(): void {
      const overlay = confirmOverlay(
        screenEl,
        [
          el('h2', { class: 'card__title' }, [s.breakStopConfirmTitle]),
          actions(
            button(s.breakConfirmCancel, () => overlay.close(), { variant: 'secondary' }),
            button(s.breakStopConfirmYes, () => {
              overlay.close()
              choose(false)
            }),
          ),
        ],
        () => overlay.close(),
      )
    }

    const continueBtn = button(s.breakContinueLabel, showContinueConfirm)
    const stopBtn = button(s.breakStopLabel, showStopConfirm, { variant: 'secondary' })

    content.append(
      title(isLongBreak ? s.breakLongTitle : s.breakTitle),
      body(isLongBreak ? s.breakLongBody : s.breakBody),
      countdown,
      actions(continueBtn, stopBtn),
    )
    root.replaceChildren(screenEl)

    const countdownInterval = window.setInterval(() => {
      remaining = Math.max(0, remaining - 1000)
      countdown.textContent = formatTimer(remaining)
      if (remaining <= 0) window.clearInterval(countdownInterval)
    }, 1000)

    // Not shown to the student - a silent fallback if the screen is
    // simply abandoned (see BREAK_ABANDON_MS in sessionConfig.ts).
    const abandonTimeout = window.setTimeout(() => choose(false), BREAK_ABANDON_MS)
  })
}

export async function runSession(
  root: HTMLElement,
  video: HTMLVideoElement,
  bundle: PerceptionBundle,
  cone: Cone,
  declaredMedia: Media[],
  studyTopic: string | undefined,
  workMs: number,
  roundsPerSet: number,
  breakMs: number,
  longBreakMs: number,
): Promise<void> {
  const records: SessionRecord[] = []
  const telemetryParts: string[] = []
  let keepGoing = true
  // Counts completed rounds since the last long break; reset to 0 once
  // it reaches roundsPerSet, so the next set starts counting fresh.
  let cycleInSet = 0
  // Wall-clock total across every Break screen this sitting - see
  // SessionRecord.restMs's doc comment for why this is measured
  // directly rather than derived from the work-phase durations.
  let restMs = 0

  // Work -> Break -> Work -> Break -> ... for as long as the student
  // keeps choosing "Fokus lagi." "Selesai" during any Work block ends
  // the whole plan immediately, skipping Break for that final cycle.
  while (keepGoing) {
    const { record, telemetryJsonl, endedManually } = await runWorkPhase(root, video, bundle, cone, declaredMedia, studyTopic, workMs)
    records.push(record)
    telemetryParts.push(telemetryJsonl)

    if (endedManually) {
      keepGoing = false
    } else {
      cycleInSet += 1
      const isLongBreak = cycleInSet >= roundsPerSet
      const breakStartedAt = Date.now()
      const { continueSession } = await renderBreak(root, isLongBreak, breakMs, longBreakMs)
      restMs += Date.now() - breakStartedAt
      if (isLongBreak) cycleInSet = 0
      keepGoing = continueSession
    }
  }

  // The camera stream and perception bundle stayed alive across every
  // cycle above; this is the one point where the whole plan is over.
  bundle.camera.stop()

  const mergedId = newSessionId()
  const merged = mergeSessionRecords(mergedId, records)
  // Measured here, before the trailing Clarify screen below - that's
  // end-of-sitting paperwork, not part of "how long the session was".
  merged.restMs = restMs
  merged.totalSessionMs = Date.now() - merged.startedAt
  // Empty parts (a cycle ended via Selesai before any frame was ever
  // recorded) would otherwise leave a blank line in the joined file -
  // harmless to this app, but a real problem for anything that parses
  // the download line-by-line later.
  const telemetryJsonl = telemetryParts.filter((part) => part.length > 0).join('\n')
  persistRecording(mergedId, telemetryJsonl)

  if (merged.uncertainMs > 0) {
    const answer = await renderClarify(root)
    merged.clarification = { answer }
  }

  const now = Date.now()
  const before = deriveCompanionState(listSessions(), now)
  saveSession(merged)
  const after = deriveCompanionState(listSessions(), now)
  const milestone: Milestone | null = findNewMilestone(before, after)

  await renderSessionCard(root, merged, milestone)
}
