# HACHIKO — repo guardrails

Focus companion for Indonesian junior-high students. Browser app. The webcam watches posture during a Pomodoro; a dog sleeps while the student focuses and wakes when they drift.

Full spec: `HACHIKO_PRD.md`. **The PRD is the source of truth. If this file and the PRD disagree, the PRD wins.** Handoff snapshot: `HACHIKO_SOURCE_OF_TRUTH.md`.

> ✅ **Multi-cycle Pomodoro blocker resolved, via a different architecture
> than the one that was blocked.** The upfront fixed-cycle-count loop
> described lower in this file's "handoff" sections (and in
> `HACHIKO_SOURCE_OF_TRUTH.md`) was never fixed and was replaced instead:
> the Break screen itself now asks "Fokus lagi?" / "Selesai untuk hari
> ini?" after every cycle, looping for as long as the student keeps
> choosing to continue, with a long break every Nth round (chosen on
> Ready, default 4) instead of a fixed total. See
> `docs/superpowers/specs/2026-09-13-multi-cycle-pomodoro-port-design.md`
> for the design and `src/ui/screens/session.ts`'s `runSession` for the
> actual loop. The "handoff constraints" and "current product & storage
> semantics" sections below describe the old, abandoned architecture and
> are kept only as history - verify against source, not against them.

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
    focusEngine.ts types (Frame, FocusState, Media, Cone, EngineConfig),
                   DEFAULT_CONFIG, calibrate() (frames[] -> Cone), and
                   the FocusEngine state machine - one file by request
                   (2026-09-20), previously split across types.ts/
                   config.ts/calibrate.ts/focusEngine.ts.
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

Refreshed 2026-09-18: amber/amber-deep/sage now source from a new
accent ramp (Harvest Orange / Tropical Teal), at full saturation.
Cream, sand, ink, ink-muted and night are the neutral canvas and are
unchanged - the refresh is accents only, never a wash over the page.
See `src/styles/tokens.css` for the exact derivation (amber-deep is a
75/25 mix of Harvest Orange and ink, not the raw hex, to keep its
several text-color uses AA-compliant while still reading as bold).

```css
--cream:#FDF8F3     --sand:#F5EBE0       --amber:#FF7700   --amber-deep: derived, see tokens.css
--ink:#2B2622       --ink-muted:#8A7F76  --sage:#00AFB5    --night:#14110F
--accent-blue:#004777 (Yale Blue, bento tile tint only)
--accent-peach:#EFD28D (Soft Peach, bento tile tint only)
```

Session view uses `--night`. Everything else uses `--cream`. No red -
the accent ramp's own red ("Inferno" #A30000) is deliberately excluded.

## Engine contract — do not change these signatures

```ts
type Media = 'laptop' | 'phone' | 'book' | 'paper' | 'other'
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

## Superseded: multi-cycle runtime bug handoff (resolved)

The section below documented a BLOCKED/UNRESOLVED bug in an upfront
fixed-cycle-count architecture. That architecture was replaced, not
fixed - see the note at the top of this file. Kept only as history;
`FocusEngine`/perception/`SessionRecord` were never touched by either
attempt, so those specific constraints never mattered either way.

## Current product & storage semantics (handoff)

### Pomodoro / multi-cycle
- Work duration selector: 15 / 25 / 50 min (default 25). Rounds-per-set selector: 1 / 2 / 3 / 4, default 4.
- The Break screen asks "Fokus lagi" / "Selesai untuk hari ini" after every cycle - there is no upfront total-cycle cap, the student decides one round at a time.
- Break is 5 min normally; every Nth break (N = the chosen rounds-per-set) is a 15-min long break instead, then the round count resets.
- "Selesai" during a Work block pauses and asks for confirmation, then ends the whole multi-cycle plan immediately (skips Break for that final cycle).
- One sitting = one `SessionRecord` (cycles merged via `mergeSessionRecords`) + one `TelemetryRecorder` + one history entry + one Session Card. Clarification is shown once, at the end.
- `runSession` (in `src/ui/screens/session.ts`) owns the loop; `runWorkPhase` runs a single cycle and returns its own record, merged afterward - see `docs/superpowers/specs/2026-09-13-multi-cycle-pomodoro-port-design.md`.

### Metrics
- **Waktu Absen** = `durationsMs.TIDAK_HADIR`.
- **Waktu Duduk** = `FOKUS + TERALIH + MENGANTUK + UNCERTAIN` (present time).
- Focus line zero state renders `"0 detik dari 0 detik"`.
- Recovery time is recorded but not displayed as a metric.

### Storage
- Delete Session → one record. Delete All Sessions → clear `hachiko.sessions.v1`.
- Delete Profile → `deleteProfile()` + `deleteAllSessions()`.
- Telemetry and calibration are never deleted by the above.

### Report / PDF
- PDF and Session Card share `computeMetrics` + the same formatters. Sub-minute durations render in seconds. Zero-dependency PDF writer.

