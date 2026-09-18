import { strings } from '../strings'
import { actions, body, button, el, screen, titleWithDoodle } from '../components'
import { cssVar } from '../theme'
import { flipExpand } from '../transition'
import { mascotPeek } from '../hachiko'
import { startPerceptionLoop, startFaceBoxLoop } from '../../perception/camera'
import type { PerceptionBundle } from '../../perception/bundle'
import type { FaceBox } from '../../perception/faceBox'
import { calibrate } from '../../engine/calibrate'
import { DEFAULT_CONFIG } from '../../engine/config'
import type { Cone, Frame } from '../../engine/types'

const CALIBRATION_MS = 15_000
// The countdown is split into three equal windows, each showing one of
// strings.calibration.hints - ambient/glanceable only, never something
// the student has to stop and read (they still need to look at the
// camera and sit naturally). Derived from CALIBRATION_MS rather than a
// separate constant so the two can never drift out of sync.
const HINT_WINDOW_MS = CALIBRATION_MS / 3
const RING_RADIUS = 42
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
// Beyond this many ms since the last real detection, extrapolation stops
// advancing and the overlay holds at its last known position instead of
// drifting indefinitely on a real multi-frame gap (e.g. face left frame).
const EXTRAPOLATION_CAP_MS = 150

interface BoxReading {
  centerX: number
  centerY: number
  radius: number
  at: number
}

function progressRing(): { element: HTMLDivElement; setProgress: (ratio: number, label: string) => void } {
  const value = el('div', { class: 'progress-ring__value', 'aria-hidden': 'true' }, [''])
  const element = el('div', { class: 'progress-ring' })
  element.innerHTML = `
    <svg viewBox="0 0 96 96">
      <circle class="progress-ring__track" cx="48" cy="48" r="${RING_RADIUS}" />
      <circle class="progress-ring__fill" cx="48" cy="48" r="${RING_RADIUS}"
              stroke-dasharray="${RING_CIRCUMFERENCE}" stroke-dashoffset="${RING_CIRCUMFERENCE}" />
    </svg>
  `
  element.append(value)
  const fill = element.querySelector<SVGCircleElement>('.progress-ring__fill')

  return {
    element,
    setProgress: (ratio: number, label: string) => {
      const clamped = Math.min(1, Math.max(0, ratio))
      if (fill) fill.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - clamped))
      value.textContent = label
    },
  }
}

export type CalibrationResult = { cancelled: true } | { cancelled: false; cone: Cone }

export function renderCalibration(
  root: HTMLElement,
  video: HTMLVideoElement,
  bundle: PerceptionBundle,
  fromRect: DOMRect,
): Promise<CalibrationResult> {
  return new Promise((resolve) => {
    const s = strings.calibration
    const { root: screenEl, content } = screen()
    // See the .screen__content--no-enter comment in base.css - the
    // ancestor's own fade/slide-in would throw off flipExpand's rect
    // math and layer a crossfade on top of the intended "box expands
    // in place" read.
    content.classList.add('screen__content--no-enter')
    // Same reasoning as Ready's own fix: a 2-column layout (camera left,
    // text right) needs more room than .screen__content's 720px default,
    // or it strands as a narrow strip in the middle of a wide viewport.
    content.classList.add('screen__content--wide')

    // A calm, watching presence for the 15 seconds - the student still
    // needs to sit naturally and look at the camera, so this stays
    // peripheral: a gentle idle motion (reusing the existing breathing
    // animation, not a new one) rather than anything that asks for
    // attention. Swapped to 'celebrating' as a small payoff on completion.
    let mascotEl = mascotPeek('waiting')
    mascotEl.querySelector('img')?.classList.add('hachiko-sleep')

    const status = body(s.body)
    const ring = progressRing()
    ring.setProgress(0, '15')
    const countdown = el('p', { class: 'screen__body' }, [s.counting(15)])
    const hint = el('p', { class: 'calibration-hint' }, [s.hints[0] ?? ''])
    let lastHintIndex = 0
    const preview = el('div', { class: 'camera-preview' })
    const canvas = el('canvas', {})
    // The canvas draws the video frame itself (see the tick loop below) and
    // becomes the sole visual surface - the <video> element stays in the
    // DOM only because requestVideoFrameCallback/MediaPipe need a live
    // source to read from, it's never meant to be seen directly here.
    video.style.opacity = '0'
    preview.append(video, canvas)

    let cone: Cone | null = null
    const continueBtn = button(
      s.continueLabel,
      () => {
        if (!cone) return
        overlayLoop.stop()
        root.replaceChildren()
        resolve({ cancelled: false, cone })
      },
      { disabled: true },
    )

    // Always enabled, unlike continueBtn - backs all the way out to
    // Ready so the student can recheck framing/media/duration/rounds,
    // reusing the same camera+bundle rather than re-requesting
    // permission (see main.ts's loop and renderReady's `existing` param).
    const cancelBtn = button(
      strings.common.back,
      () => {
        overlayLoop.stop()
        dataLoop.stop()
        root.replaceChildren()
        resolve({ cancelled: true })
      },
      { variant: 'secondary' },
    )

    // Camera on the left, the mascot/status/ring/countdown/hint stacked
    // in line with it on the right - same two-column shape as Ready's
    // own camera+controls grid, just with the info column narrower
    // since there's no stepper/chip content here.
    const infoColumn = el('div', { class: 'calibration-grid__info' }, [mascotEl, status, ring.element, countdown, hint])
    const cameraColumn = el('div', { class: 'calibration-grid__camera' }, [preview])
    const grid = el('div', { class: 'calibration-grid' }, [cameraColumn, infoColumn])

    content.append(titleWithDoodle(s.title, 'sparkle'), grid, actions(cancelBtn, continueBtn))
    root.replaceChildren(screenEl)
    flipExpand(preview, fromRect)

    const ctx = canvas.getContext('2d')
    const nightColor = cssVar('--night')
    const amberColor = cssVar('--amber')
    let frames: Frame[] = []
    let startT: number | null = null
    let settled = false

    // The last two known (non-null) readings and when they arrived, for
    // velocity-based extrapolation between them - both come from the fast
    // face-box loop below, which runs on every video frame, not the slow
    // FaceLandmarker loop.
    let prevReading: BoxReading | null = null
    let lastReading: BoxReading | null = null
    let smoothCenterX: number | null = null
    let smoothCenterY: number | null = null
    let smoothRadius: number | null = null
    // The target itself updates at the same rate as this blend (every
    // frame, via the fast loop), so there is much less gap to smooth over
    // than a naive lower value would assume - heavier smoothing would
    // just read as sluggish. Retune this one constant if the feel is off
    // in either direction; it is not a structural change.
    const SMOOTHING = 0.35

    // The <video> is displayed with `object-fit: cover` into `.camera-preview`,
    // whose CSS fixes `aspect-ratio: 4 / 3` (base.css) - if the camera's
    // native resolution isn't that same ratio, cover crops the sides or the
    // top/bottom off before display. The box's aspect ratio is a fixed CSS
    // constant here (not measured at runtime): it's exactly what the CSS
    // above declares, and avoids depending on any particular browser's
    // layout-measurement timing.
    const BOX_ASPECT = 4 / 3

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

    function boxToReading(box: FaceBox, cropX: number, cropY: number, at: number): BoxReading {
      return {
        centerX: box.originX + box.width / 2 - cropX,
        centerY: box.originY + box.height / 2 - cropY,
        radius: (box.width / 2 + box.height / 2) / 2,
        at,
      }
    }

    // --- Fast loop: live preview + overlay, every video frame ---
    const overlayLoop = startFaceBoxLoop(video, bundle.faceDetector, (box, timestampMs) => {
      if (!video.videoWidth || !video.videoHeight || !ctx) return
      const crop = coverCrop(video.videoWidth, video.videoHeight, BOX_ASPECT)

      const targetW = Math.round(crop.visibleW)
      const targetH = Math.round(crop.visibleH)
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW
        canvas.height = targetH
      }

      // Draw the current video frame every tick, cropped exactly like
      // `object-fit: cover` would - this is what keeps the preview smooth
      // at full framerate now that the <video> element itself is invisible.
      ctx.drawImage(video, crop.cropX, crop.cropY, crop.visibleW, crop.visibleH, 0, 0, canvas.width, canvas.height)

      if (box) {
        const reading = boxToReading(box, crop.cropX, crop.cropY, timestampMs)
        if (lastReading) prevReading = lastReading
        lastReading = reading
      }

      if (lastReading) {
        // Predict the current position from the last two readings'
        // velocity. Once the gap since the last real reading exceeds the
        // cap, collapse elapsed to 0 so the velocity term vanishes and the
        // overlay holds exactly at lastReading's position, instead of
        // still extrapolating a fixed 150ms ahead of it (which, at high
        // head speed, can park the circle well away from the last known
        // point during a real gap - e.g. face left the frame).
        const age = timestampMs - lastReading.at
        const elapsed = age > EXTRAPOLATION_CAP_MS ? 0 : age
        let predictedX = lastReading.centerX
        let predictedY = lastReading.centerY
        let predictedRadius = lastReading.radius
        if (prevReading && lastReading.at > prevReading.at) {
          // Clamp the divisor: a very small dt (e.g. from the monotonic-
          // timestamp bump in startFaceBoxLoop, or two genuinely close
          // frames) would otherwise amplify normal per-frame jitter into
          // an implausible velocity once multiplied by elapsed below.
          const dt = Math.max(lastReading.at - prevReading.at, 8)
          const vx = (lastReading.centerX - prevReading.centerX) / dt
          const vy = (lastReading.centerY - prevReading.centerY) / dt
          const vr = (lastReading.radius - prevReading.radius) / dt
          predictedX += vx * elapsed
          predictedY += vy * elapsed
          predictedRadius = Math.max(1, predictedRadius + vr * elapsed)
        }

        if (smoothCenterX === null || smoothCenterY === null || smoothRadius === null) {
          smoothCenterX = predictedX
          smoothCenterY = predictedY
          smoothRadius = predictedRadius
        } else {
          smoothCenterX += (predictedX - smoothCenterX) * SMOOTHING
          smoothCenterY += (predictedY - smoothCenterY) * SMOOTHING
          smoothRadius += (predictedRadius - smoothRadius) * SMOOTHING
        }
      }

      if (smoothCenterX !== null && smoothCenterY !== null && smoothRadius !== null) {
        // Spotlight: dim everything outside the circle, leave the face
        // itself fully visible - the evenodd rule fills only where a ray
        // crosses an odd number of the two overlapping subpaths (rect,
        // circle), so the region inside both cancels out to a hole.
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, 0, canvas.width, canvas.height)
        ctx.moveTo(smoothCenterX + smoothRadius, smoothCenterY)
        ctx.arc(smoothCenterX, smoothCenterY, smoothRadius, 0, Math.PI * 2, true)
        ctx.closePath()
        ctx.fillStyle = nightColor
        ctx.globalAlpha = 0.5
        ctx.fill('evenodd')
        ctx.restore()

        ctx.strokeStyle = amberColor
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(smoothCenterX, smoothCenterY, smoothRadius, 0, Math.PI * 2)
        ctx.stroke()
      }
    })

    // --- Slow loop: calibrate()'s data collection + the countdown/ring UI ---
    // Only AI-Engine head pose (yaw/pitch) feeds calibrate() - the fast
    // loop's FaceDetector above has no pose data, only a bounding box.
    // calibrate() filters by real elapsed time, not frame count, and floors
    // its tolerance estimate against a minimum, so this loop's own cadence
    // only affects sample density, not correctness.
    const dataLoop = startPerceptionLoop(video, bundle.ai, bundle.faceEngine, bundle.objectEngine, (tick) => {
      if (settled) return

      if (startT === null) {
        startT = tick.timestampMs
        // The AI core keeps its own 5 s perceptual baseline (used for
        // EAR-relative eye signals). Started inside the same 15 s window
        // the student already sits neutrally for the cone; HACHIKO's cone
        // calibration and its duration/thresholds are untouched.
        bundle.ai.startCalibration(tick.timestampMs)
      }
      frames.push(tick.frame)

      const elapsedMs = tick.timestampMs - startT
      const secondsLeft = Math.max(0, Math.ceil((CALIBRATION_MS - elapsedMs) / 1000))
      countdown.textContent = s.counting(secondsLeft)
      ring.setProgress(elapsedMs / CALIBRATION_MS, String(secondsLeft))

      const hintIndex = Math.min(s.hints.length - 1, Math.floor(elapsedMs / HINT_WINDOW_MS))
      if (hintIndex !== lastHintIndex) {
        lastHintIndex = hintIndex
        hint.textContent = s.hints[hintIndex] ?? ''
      }

      if (elapsedMs >= CALIBRATION_MS) {
        try {
          cone = calibrate(frames, DEFAULT_CONFIG)
          settled = true
          dataLoop.stop()
          status.textContent = s.done
          ring.setProgress(1, '✓')
          continueBtn.disabled = false
          const celebratingMascot = mascotPeek('celebrating')
          mascotEl.replaceWith(celebratingMascot)
          mascotEl = celebratingMascot
        } catch {
          // Face dropped out too much of the window - restart the clock
          // rather than hand back a cone built from too little data.
          frames = []
          startT = null
          ring.setProgress(0, '15')
          lastHintIndex = 0
          hint.textContent = s.hints[0] ?? ''
        }
      }
    }, 1000)
  })
}
