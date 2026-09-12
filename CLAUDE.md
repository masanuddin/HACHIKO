# HACHIKO — repo guardrails

Focus companion for Indonesian junior-high students. Browser app. The webcam watches posture during a Pomodoro; a dog sleeps while the student focuses and wakes when they drift.

Full spec: `HACHIKO_PRD.md`. **The PRD is the source of truth. If this file and the PRD disagree, the PRD wins.** Handoff snapshot: `HACHIKO_SOURCE_OF_TRUTH.md`.

> ⚠️ **Known blocker (handoff):** multi-cycle Pomodoro is implemented at
> source level (duration 15/25/50, cycles 1/2/3/4, break 5 min between cycles,
> no break after the last) but the **browser runtime is BLOCKED/UNRESOLVED** —
> after the first break it returns to the Session Card instead of running the
> remaining cycles. Tests/build pass; runtime does not. See
> `HACHIKO_SOURCE_OF_TRUTH.md` §10 and §15. **Do not assume runtime is
> verified just because `tsc`/`npm test`/build pass.**

---

## Hard constraints — never violate

1. **No new dependencies.** The entire allowed list is `@mediapipe/tasks-vision`, `vite`, `typescript`, `vitest`. Nothing else — no React, no charting library, no state library, no date library, no UI kit, no animation library. If you believe something is needed, stop and ask.
2. **No network calls. Ever.** No `fetch`, no `XMLHttpRequest`, no WebSocket, no analytics, no CDN at runtime. The app must run with DevTools' Network tab empty after first load. This is a product claim demonstrated live on stage — breaking it makes the team liars.
3. **No camera frames are stored or transmitted.** Derived numbers only. Never write image data to `localStorage`, IndexedDB, or a file.
4. **`src/engine/` is pure TypeScript.** No DOM, no `window`, no `document`, no browser APIs, no `Date.now()` — timestamps arrive as arguments. It must run under Node in tests.
5. **Build only what the current prompt asks for.** Do not add screens, settings, features, or "nice to haves" from the PRD that the prompt didn't name. Finish, report, stop.

## Never do these

- ❌ Add an npm package to solve a small problem
- ❌ Use the colour red anywhere in the UI — red reads as judgment, and removing judgment is the product's entire thesis
- ❌ Show a focus counter, distraction count, score, streak, or percentage **during** a session
- ❌ Use the words `gagal`, `malas`, or `salah` in any user-facing string
- ❌ Force an ambiguous event into `FOKUS` or `TERALIH` — that's what `UNCERTAIN` is for
- ❌ Ask the student a context question during a focus block (breaks only)
- ❌ Use `requestAnimationFrame` for the detection loop — it throttles in background tabs. Use `video.requestVideoFrameCallback()`
- ❌ Add a parent/teacher dashboard, login, or account of any kind

## Structure

```
src/
  engine/          PURE. No browser APIs.
    types.ts       Frame, FocusState, Media, Cone, EngineConfig
    config.ts      DEFAULT_CONFIG constants
    calibrate.ts   frames[] -> Cone
    focusEngine.ts the state machine
    *.test.ts      vitest, synthetic frame sequences
  perception/      Browser-facing. Camera + MediaPipe.
    camera.ts      getUserMedia, requestVideoFrameCallback loop
    face.ts        FaceLandmarker @ 5fps
    objects.ts     ObjectDetector @ 1fps
    pose.ts        transform matrix -> yaw/pitch/roll
  storage/         localStorage only
  ui/              screens + Hachiko
  main.ts
tools/
  replay.ts        offline ablation over recorded telemetry
public/models/     face_landmarker.task, efficientdet_lite0.tflite
```

## Conventions

- TypeScript strict. No `any`.
- Plain DOM. No framework, no JSX.
- User-facing strings in **Indonesian**, casual register — these are 13-year-olds. Code, comments, and identifiers in English.
- Angles in **radians** everywhere inside the engine. Convert only at display time.
- Timestamps are `number` (ms). The engine never reads the clock itself.
- CSS custom properties for the palette; never hardcode a hex in a component.

## Palette

```css
--cream:#FDF8F3  --sand:#F5EBE0  --amber:#E8934A  --amber-deep:#C4692A
--ink:#2B2622    --ink-muted:#8A7F76  --sage:#7A9471  --night:#14110F
```

Session view uses `--night`. Everything else uses `--cream`. No red.

## Engine contract — do not change these signatures

```ts
type Media = 'laptop' | 'phone' | 'book' | 'paper' | 'mixed' | 'other'
type FocusState = 'FOKUS' | 'TERALIH' | 'TIDAK_HADIR' | 'UNCERTAIN' | 'MENGANTUK'

interface Frame {
  t: number                 // ms
  faceFound: boolean
  yaw: number | null        // radians
  pitch: number | null      // radians
  eyeBlink: number | null   // 0..1
  objects: string[]         // COCO labels seen within the last 1s
}

interface Cone { yawMid: number; yawTol: number; pitchMid: number; pitchTol: number }

interface EngineOutput { state: FocusState; changedAt: number; uncertainMs: number }

class FocusEngine {
  constructor(cfg: EngineConfig, cone: Cone, declaredMedia: Media[])
  step(f: Frame): EngineOutput
  reset(): void
}
```

## Definition of done

Every task ends with: it compiles under `tsc --noEmit`, `npm test` passes, no new dependency appeared in `package.json`, and nothing outside the task's scope changed.

## Handoff constraints for the multi-cycle runtime bug

While the multi-cycle runtime blocker is open, the following apply:

- ❌ Do not treat multi-cycle runtime as verified just because `tsc --noEmit`, `npm test`, or `npm run build` pass. Browser runtime verification is required.
- ❌ Do not change `FocusEngine`, perception, or the calibration algorithm to fix an orchestration bug — the two layers are unrelated.
- ❌ Do not redesign the `SessionRecord` schema without a concrete, documented reason.
- ❌ Do not debug AI / object detection while the open issue is Pomodoro orchestration.

## Current product & storage semantics (handoff)

### Pomodoro / multi-cycle
- Work duration selector: 15 / 25 / 50 min. Cycle selector: 1 / 2 / 3 / 4, default 4.
- Break 5 min **between** cycles; no break after the final cycle.
- One sequence = one `SessionRecord` + one `TelemetryRecorder` + one history entry + one Session Card.
- Clarification is shown once, at the end of the sequence. "Ulangi sesi" repeats the same duration + cycle count; "Selesai" ends the whole sequence.
- `runSession` owns the cycle loop; `runWorkPhase` runs a single cycle and accumulates into the shared `record`/`telemetry`.

### Metrics
- **Waktu Away** = `durationsMs.TIDAK_HADIR`.
- **Waktu Duduk** = `FOKUS + TERALIH + MENGANTUK + UNCERTAIN` (present time).
- Focus line zero state renders `"0 detik dari 0 detik"`.
- Recovery time is recorded but not displayed as a metric.

### Storage
- Delete Session → one record. Delete All Sessions → clear `hachiko.sessions.v1`.
- Delete Profile → `deleteProfile()` + `deleteAllSessions()`.
- Telemetry and calibration are never deleted by the above.

### Report / PDF
- PDF and Session Card share `computeMetrics` + the same formatters. Sub-minute durations render in seconds. Zero-dependency PDF writer.

