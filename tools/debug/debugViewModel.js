/**
 * HACHIKO — canonical Debug view model  (tools/debug)
 * ===================================================
 * ONE derivation of "what the debug UI should show for this frame", consumed by
 * every panel: header, AI Result, Evidence Summary, Face Signal, Signal
 * Inspector and Runtime.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * The page previously had TWO independent `onFrame` subscribers: the harness
 * renderer wrote the centre panel, and an inline page handler wrote the right
 * panel. `HachikoAI` isolates a throwing listener (so one bad consumer cannot
 * kill inference), which is correct for the engine — but it meant a single
 * ReferenceError in the page handler silently blanked the entire Signal
 * Inspector while the centre kept updating. Two stores, one of which could die
 * unnoticed, is the defect this module removes.
 *
 * It derives NOTHING new. Every value here is read straight off the telemetry
 * frame or `CONFIG`; no threshold is re-implemented, no rule is re-evaluated.
 * If this file disagreed with the engine, this file would be wrong.
 *
 * ── DISPLAY POLICY ───────────────────────────────────────────────────────
 * A bare dash is never a valid rendering. Every field resolves to either a real
 * value, or an explicit reason it is absent (see `Absent`). A field whose
 * absence carries no information is not emitted at all — the UI drops the row.
 */

/** Explicit absence states. Never render a bare dash instead of one of these. */
export const Absent = Object.freeze({
  NO_CAMERA: 'Waiting for camera',
  NO_FACE: 'No face',
  SIGNAL_INVALID: 'Signal invalid',
  NEEDS_CALIBRATION: 'Requires calibration',
  COLLECTING: 'Collecting…',
  UNAVAILABLE: 'Unavailable',
  INACTIVE: 'inactive',
  NOT_APPLICABLE: 'Not applicable',
  PENDING: 'Pending bake-off',
  NONE: 'None',
});

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Whether a whole table can render, or is blocked by ONE shared condition.
 *
 * Repeating "Waiting for camera" in twenty cells is noise, not information:
 * the reason is identical everywhere, so it belongs above the table once and
 * the rows should not render at all. This returns null when the table has real
 * data to show.
 *
 * @returns {string|null} the blocking reason, or null if the table can render
 */
function tableState(ctx, needs = {}) {
  if (!ctx.cameraOn) return Absent.NO_CAMERA;
  if (needs.face && !ctx.faceDetected) return Absent.NO_FACE;
  if (needs.pose && !ctx.headPoseValid) return Absent.SIGNAL_INVALID;
  if (needs.baseline && !ctx.calibrated) return Absent.NEEDS_CALIBRATION;
  return null;
}

/**
 * Resolve one measurement to a display value or an explicit absence.
 *
 * @param {number|null|undefined} value
 * @param {Object} ctx      gating context
 * @param {boolean} [needsBaseline] value is relative to the calibration baseline
 * @returns {{ok: boolean, text: string, value: number|null}}
 */
function resolve(value, ctx, needsBaseline = false) {
  if (!ctx.cameraOn) return { ok: false, text: Absent.NO_CAMERA, value: null };
  if (!ctx.faceDetected) return { ok: false, text: Absent.NO_FACE, value: null };
  if (ctx.requiresPose && !ctx.headPoseValid) {
    return { ok: false, text: Absent.SIGNAL_INVALID, value: null };
  }
  if (needsBaseline && !ctx.calibrated) {
    return { ok: false, text: Absent.NEEDS_CALIBRATION, value: null };
  }
  // Everything the value depends on is satisfied, so a missing number here is a
  // genuine extraction failure and must be surfaced as such, not hidden.
  if (!finite(value)) return { ok: false, text: Absent.UNAVAILABLE, value: null };
  return { ok: true, text: null, value };
}

const deg = (r) => (r.ok ? `${r.value.toFixed(1)}°` : r.text);
const ratio = (r, dp = 3) => (r.ok ? r.value.toFixed(dp) : r.text);

/**
 * Persistence display. A timer is only meaningful once its rule is evaluable;
 * before that the row states why rather than showing "0 / 1500 ms", which would
 * imply the rule is running.
 */
function persistence(elapsedMs, requiredMs, evaluable) {
  if (!evaluable) return { ok: false, text: Absent.NOT_APPLICABLE, pct: 0 };
  const ms = finite(elapsedMs) ? elapsedMs : 0;
  return {
    ok: true,
    text: `${Math.round(ms)} / ${requiredMs} ms`,
    pct: requiredMs > 0 ? Math.min(100, (ms / requiredMs) * 100) : 0,
  };
}

const status = (on) => (on ? 'ACTIVE' : Absent.INACTIVE);

/**
 * Build the canonical view model for one telemetry frame.
 *
 * @param {Object} frame        a HachikoAI telemetry frame
 * @param {Object} ctx
 * @param {boolean} ctx.cameraOn
 * @param {Object}  ctx.calibration  getCalibrationSnapshot() result
 * @param {Object}  ctx.config       CONFIG (thresholds are READ, never redefined)
 * @param {Object}  [ctx.extremes]   live session range accumulator
 * @param {Object}  [ctx.latency]    {p50, p95, count} rolling inference stats
 * @param {string}  [ctx.delegate]
 * @param {Object}  [ctx.video]      {width, height}
 */
export function buildDebugViewModel(frame, ctx) {
  const S = ctx.config.state;
  const m = frame?.measurement ?? {};
  const c = frame?.calibrated ?? {};
  const t = frame?.temporal ?? {};
  const ev = frame?.evidence?.active ?? {};
  const acc = frame?.evidence?.accumulated ?? {};
  const d = frame?.classification ?? {};
  const p = frame?.performance ?? {};
  const v = frame?.validity ?? {};

  const cameraOn = !!ctx.cameraOn;
  const calibrated = ctx.calibration?.status === 'VALID';
  const faceDetected = !!m.facePresent;
  const headPoseValid = !!m.poseValid;

  const poseCtx = { cameraOn, faceDetected, headPoseValid, calibrated, requiresPose: true };
  const eyeCtx = { cameraOn, faceDetected, headPoseValid, calibrated, requiresPose: false };

  // A head-pose rule can only be evaluated with a valid pose AND a baseline to
  // measure the delta against.
  const poseRuleEvaluable = cameraOn && faceDetected && headPoseValid && calibrated;
  // The eye rule additionally needs the geometry gate to pass.
  const eyeEligible = frame?.evidence?.eyeEligible ?? null;
  const eyeRuleEvaluable = cameraOn && faceDetected && calibrated && eyeEligible === true;

  const signal = (rawV, deltaV, smoothV, opts) => ({
    raw: deg(resolve(rawV, poseCtx)),
    delta: deg(resolve(deltaV, poseCtx, true)),
    smoothed: deg(resolve(smoothV, poseCtx)),
    ...opts,
  });

  // One shared reason per table, so the UI can collapse the whole block
  // instead of echoing the same phrase down every column.
  const baseCtx = { cameraOn, faceDetected, headPoseValid, calibrated };
  const blocked = {
    // Raw angles need a face and a valid pose, but no baseline.
    headPose: tableState(baseCtx, { face: true, pose: true }),
    // The interpretation rows are thresholds; they read once a baseline exists.
    pitchInterpretation: tableState(baseCtx, { face: true, pose: true, baseline: true }),
    eyeMeasurements: tableState(baseCtx, { face: true }),
    eyeDecision: tableState(baseCtx, { face: true }),
    runtime: cameraOn ? null : Absent.NO_CAMERA,
  };

  return {
    blocked,
    camera: {
      on: cameraOn,
      video: ctx.video?.width
        ? `${ctx.video.width}×${ctx.video.height}` : Absent.NO_CAMERA,
      delegate: ctx.delegate ?? (cameraOn ? Absent.COLLECTING : Absent.NO_CAMERA),
    },

    calibration: {
      status: ctx.calibration?.status ?? 'NONE',
      valid: calibrated,
      samples: ctx.calibration?.baseline
        ? String(ctx.calibration.baseline.sampleCount)
        : (ctx.calibration?.status === 'NONE'
          ? 'Not started'
          : `${ctx.calibration?.validSamples ?? 0} valid / `
            + `${ctx.calibration?.totalFrames ?? 0} frames`),
      detail: ctx.calibration?.baseline
        ? `yaw ${ctx.calibration.baseline.yaw.toFixed(1)}° · `
          + `pitch ${ctx.calibration.baseline.pitch.toFixed(1)}° · `
          + `EAR ${ctx.calibration.baseline.ear.toFixed(3)}`
        : (ctx.calibration?.failureReason ?? Absent.NEEDS_CALIBRATION),
    },

    // Owned by AI Result alone. The Signal Inspector must not repeat these.
    state: {
      publicState: d.state ?? Absent.NO_CAMERA,
      primaryReason: d.primaryReason ?? d.reason ?? Absent.NONE,
      timeInState: finite(d.stateDurationMs)
        ? `${(d.stateDurationMs / 1000).toFixed(1)} s` : Absent.NO_CAMERA,
      signalValid: v.stateSignalValid,
      holding: !!d.holding,
    },

    face: {
      detected: faceDetected,
      headPoseValid,
      eyeEligible,
      eyeRejectReason: frame?.evidence?.eyeIneligibleReason ?? null,
      faceMissingMs: Math.round(t.faceMissingMs ?? 0),
    },

    signals: {
      yaw: signal(m.yawRaw, c.yawDelta, t.yawSmoothed, {
        rule: `|Δ| > ${S.STRONG_YAW_DELTA_DEG}°`,
        role: 'STRONG',
        persistence: persistence(acc.yawStrong, S.YAW_PERSIST_MS, poseRuleEvaluable),
        active: !!ev.yawStrong,
        status: status(ev.yawStrong),
      }),

      // ONE pitch measurement; the two interpretations below read it.
      pitch: signal(m.pitchRaw, c.pitchDelta, t.pitchSmoothed, {
        role: 'Measurement',
      }),
      pitchUp: {
        role: 'STRONG',
        rule: `Δ > +${S.STRONG_UP_PITCH_DELTA_DEG}°`,
        persistence: persistence(acc.pitchUpStrong, S.PITCH_UP_PERSIST_MS, poseRuleEvaluable),
        active: !!ev.pitchUpStrong,
        status: status(ev.pitchUpStrong),
      },
      pitchDown: {
        role: 'SUPPORT',
        rule: `Δ < −${S.DOWN_PITCH_SUPPORT_DEG}°`,
        persistence: persistence(acc.pitchDownSupport,
          S.DOWN_PITCH_SUPPORT_PERSIST_MS, poseRuleEvaluable),
        active: !!ev.pitchDownSupport,
        status: status(ev.pitchDownSupport),
      },

      // UI term is Head Tilt; the internal/export measurement stays "roll".
      headTilt: signal(m.rollRaw, c.rollDelta, t.rollSmoothed, {
        rule: `|Δ| > ${S.ROLL_SUPPORT_DEG}°`,
        role: 'SUPPORT',
        persistence: persistence(acc.rollSupport, S.ROLL_SUPPORT_PERSIST_MS, poseRuleEvaluable),
        active: !!ev.rollSupport,
        status: status(ev.rollSupport),
      }),

      eye: {
        left: ratio(resolve(m.earLeft, eyeCtx)),
        right: ratio(resolve(m.earRight, eyeCtx)),
        mean: ratio(resolve(m.earMean, eyeCtx)),
        relative: ratio(resolve(c.earRelative, eyeCtx, true)),
        smoothed: ratio(resolve(t.earSmoothed, eyeCtx)),
        // Eligibility is a real tri-state: unknown before any frame arrives.
        eligible: eyeEligible === null
          ? (cameraOn ? Absent.COLLECTING : Absent.NO_CAMERA)
          : (eyeEligible ? 'YES' : 'NO'),
        eligibleBool: eyeEligible,
        threshold: `${S.EAR_RELATIVE_THRESHOLD} relative`,
        persistence: persistence(acc.eyeClosureStrong, S.EYE_CLOSED_PERSIST_MS,
          eyeRuleEvaluable),
        active: !!ev.eyeClosureStrong,
        status: status(ev.eyeClosureStrong),
        rejectReason: frame?.evidence?.eyeIneligibleReason ?? Absent.NONE,
      },
    },

    runtime: {
      fps: finite(p.fps) ? p.fps.toFixed(1) : (cameraOn ? Absent.COLLECTING : Absent.NO_CAMERA),
      inference: finite(p.inferenceMs)
        ? `${p.inferenceMs.toFixed(2)} ms`
        : (cameraOn ? Absent.COLLECTING : Absent.NO_CAMERA),
      p50: latencyText(ctx.latency?.p50, ctx.latency?.count, cameraOn),
      p95: latencyText(ctx.latency?.p95, ctx.latency?.count, cameraOn),
      ranges: buildRanges(ctx.extremes, cameraOn),
      anomalies: {
        nonFinite: ctx.extremes?.nonFinite ?? 0,
        wrapSuspect: ctx.extremes?.wrapSuspect ?? 0,
        // Camera ON must never report "Waiting for camera".
        summary: !cameraOn ? Absent.NO_CAMERA
          : (!ctx.extremes || !Number.isFinite(ctx.extremes.yawRaw?.min)
            ? Absent.COLLECTING
            : ((ctx.extremes.nonFinite || ctx.extremes.wrapSuspect)
              ? 'Anomalies detected' : '✓ No runtime anomalies')),
        clean: !(ctx.extremes?.nonFinite || ctx.extremes?.wrapSuspect),
      },
    },
  };
}

function latencyText(value, count, cameraOn) {
  if (!cameraOn) return Absent.NO_CAMERA;
  if (!finite(value) || (count ?? 0) < 20) return Absent.COLLECTING;
  return `${value.toFixed(1)} ms`;
}

/**
 * Live session range. Rows only exist once a real observation has landed —
 * a min/max of nothing is not information.
 */
function buildRanges(extremes, cameraOn) {
  const spec = [
    ['Yaw', 'yawRaw', 1, '°'],
    ['Pitch', 'pitchRaw', 1, '°'],
    ['Head Tilt', 'rollRaw', 1, '°'],
    ['EAR relative', 'earMean', 3, ''],
  ];
  const rows = [];
  let any = false;
  for (const [label, key, dp, unit] of spec) {
    const o = extremes?.[key];
    if (o && finite(o.min) && finite(o.max)) {
      any = true;
      rows.push({ label, min: `${o.min.toFixed(dp)}${unit}`, max: `${o.max.toFixed(dp)}${unit}` });
    }
  }
  return {
    rows,
    // No rows: say why rather than rendering four empty lines.
    empty: any ? null : (cameraOn ? Absent.COLLECTING : Absent.NO_CAMERA),
  };
}

export default buildDebugViewModel;
