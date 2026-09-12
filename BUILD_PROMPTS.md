# HACHIKO — build prompts for Claude Code

Six prompts, run in order. Each is self-contained. **Do not skip ahead** — P2 is the whole project and everything after it is presentation.

**Setup once:** put `CLAUDE.md` and `HACHIKO_PRD.md` in the repo root before P0. Claude Code reads `CLAUDE.md` automatically.

**After each prompt:** check the acceptance criteria yourself. If something is off, correct it before moving on — errors compound across stages.

---

## P0 · Scaffold *(~1h)*

```
Read CLAUDE.md and HACHIKO_PRD.md.

Scaffold a Vite + TypeScript project (vanilla-ts, no framework).

Do exactly this:
1. package.json with ONLY: vite, typescript, vitest, @mediapipe/tasks-vision
2. tsconfig with strict: true
3. The folder structure in CLAUDE.md, each folder containing an empty
   index.ts placeholder
4. src/styles/tokens.css defining the palette from CLAUDE.md as CSS
   custom properties
5. A minimal index.html that loads main.ts and renders the text "HACHIKO"
6. vitest configured to run *.test.ts under src/engine/
7. README.md: one paragraph on what this is, plus run commands

Do not write any application logic. Do not install anything else.
Report the file tree when done.
```

**✅ Accept when:** `npm run dev` serves a page · `npm test` runs (0 tests, no error) · `package.json` has exactly 4 deps.

---

## P1 · Perception spike *(~10h — this is your week-1 gate)*

```
Build the perception layer only. No engine, no UI, no state machine.

1. src/perception/camera.ts
   - getUserMedia, front camera, 640x480
   - Detection loop driven by video.requestVideoFrameCallback()
     (NOT requestAnimationFrame — it throttles in background tabs)
   - Throttle face inference to 5fps, object inference to 1fps

2. src/perception/face.ts
   - MediaPipe FaceLandmarker, runningMode "VIDEO", GPU delegate
   - outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true
   - numFaces: 1

3. src/perception/objects.ts
   - MediaPipe ObjectDetector, EfficientDet-Lite0, runningMode "VIDEO"
   - scoreThreshold 0.4
   - categoryAllowlist: ["cell phone", "laptop", "book", "keyboard"]

4. src/perception/pose.ts
   - Decompose the 4x4 facialTransformationMatrix to yaw/pitch/roll in radians
   - Export a documented note that sign conventions must be verified by hand

5. A debug page showing live: video preview with landmark dots drawn on the
   face, numeric yaw/pitch/roll, eyeBlink average, and detected object labels

Self-host the MediaPipe WASM bundle in public/ — do not load it from a CDN
at runtime (CLAUDE.md constraint 2).

Report which model files I need to download and where to put them.
```

**✅ Accept when — all four, on a real laptop:**
1. Landmark dots track your face
2. Turning your head changes yaw; nodding changes pitch *(verify the signs by hand and write them down)*
3. Holding up a phone makes `cell phone` appear within ~2s
4. 🔴 **Switch to another tab for 60 seconds, come back — the loop kept running.** If this fails, stop and reconsider before building anything on top of it.

---

## P2 · The engine *(~12h — the whole project is this file)*

```
Build src/engine/ as PURE TypeScript. No DOM, no window, no Date.now().
It must run under Node in vitest.

Use the exact type signatures in CLAUDE.md. Do not change them.

1. types.ts, config.ts — DEFAULT_CONFIG:
   emaAlpha 0.25, toDistractedMs 3000, toFocusedMs 1500, absentMs 5000,
   phoneSustainMs 15000, drowsyThreshold 0.6, drowsyMs 4000,
   coneSigmaMult 2.5, coneFloorRad 0.209 (12 degrees),
   useDeclaredMedia true, useObjects true

2. calibrate.ts — calibrate(frames: Frame[]): Cone
   Discard frames in the first 3000ms. Compute mean and stddev of yaw and
   pitch. Tolerance = max(2.5 * stddev, coneFloorRad) per axis.

3. focusEngine.ts — implement PRD section 7 exactly:
   - EMA smoothing on yaw and pitch
   - Asymmetric hysteresis: 3000ms outside the cone to enter TERALIH,
     1500ms inside to return to FOKUS
   - The full decision table from PRD section 7
   - Key rule: a phone in `objects` for >= phoneSustainMs means TERALIH when
     declared media does NOT include 'phone', and means nothing when it does
   - No face for absentMs -> TIDAK_HADIR
   - eyeBlink above threshold for drowsyMs -> MENGANTUK
   - Head outside the cone with no disambiguating object -> UNCERTAIN.
     Never coerce UNCERTAIN into FOKUS or TERALIH.
   - Accumulate uncertainMs
   - config.useDeclaredMedia / useObjects false must disable those inputs
     (this powers the ablation later)

4. focusEngine.test.ts — write a synthetic-frame helper, then cover:
   a. 100 in-cone frames -> FOKUS
   b. in-cone, then 20 out-of-cone frames (4s @5fps) -> TERALIH
   c. then 8 in-cone frames (1.6s) -> FOKUS
   d. only 10 out-of-cone frames (2s) -> still FOKUS (hysteresis holds)
   e. 26 frames faceFound:false -> TIDAK_HADIR
   f. declared ['book'] + "cell phone" present 76 frames (15.2s) -> TERALIH
   g. declared ['phone'] + "cell phone" present, in cone -> FOKUS
   h. declared ['book'], out of cone, no phone -> UNCERTAIN
   i. eyeBlink 0.8 for 21 frames -> MENGANTUK
   j. useObjects:false makes case (f) return UNCERTAIN instead

Every test must pass. Do not touch src/ui or src/perception.
```

**✅ Accept when:** all 10 tests pass · `src/engine/` contains zero browser references · you can change a threshold in `config.ts` and watch a test flip.

> Cases (f) and (g) are the product. They're the difference between reading a book and scrolling a phone — the exact failure the team's pilot measured at 54.4% vs 56.6%.

---

## P3 · Wire it up *(~12h)*

```
Connect perception to engine and build the session flow. Screens only —
no persistence yet.

1. Frame adapter: perception output -> engine Frame.
   `objects` = COCO labels seen in the last 1000ms.

2. Screens (plain DOM, no framework), using tokens.css:
   - Cek Posisi: live preview, target zone, guidance text, continue button
   - Kalibrasi: 15s countdown, preview VISIBLE with landmark dots,
     collect frames, call calibrate()
   - Pilih Media: six chips (Layar/laptop, HP/tablet, Buku/LKS,
     Kertas/nulis, Campuran, Lainnya), multi-select, continue
   - Sesi: large timer, Hachiko placeholder, state label, Jeda, Selesai,
     a permanently visible camera-active dot

3. Pomodoro: 25min work / 5min break. Read the duration from a config
   constant so a 2-minute demo build is a one-line change.
   Timer RUNS during FOKUS, TERALIH, UNCERTAIN. Timer PAUSES during
   TIDAK_HADIR.

4. Hachiko: four states (sleeping, waking, waiting, drowsy) as simple
   inline SVG with a CSS breathing animation on the sleeping state.
   Placeholder art is fine — leave it easy to swap.

5. Session view background is --night. Everything else --cream.

Do NOT display any focus counter, distraction count, score, or percentage
during the session. Do not build the Session Card yet.
```

**✅ Accept when:** you can run a full 2-minute session end to end · declare "Buku", read a book → Hachiko sleeps · hold up a phone → Hachiko wakes within 15s · walk away → timer pauses.

> That last sequence is your entire thesis working. Once it does, ship the link to 5 students even though it's ugly.

---

## P4 · Memory and context *(~12h)*

```
Add persistence, the Session Card, and the break clarification.

1. src/storage/sessions.ts — localStorage only.
   Session: id, startedAt, declaredMedia, durations per state,
   distractionEvents[], recoveryTimes[], uncertainMs

2. Metrics:
   - focusMinutes vs sittingMinutes
   - recoveryTime per event = ms from TERALIH -> FOKUS; report the MEDIAN
   - firstCollapseAt = timestamp of the first FOKUS -> TERALIH
   - uncertainPercent = uncertainMs / totalSessionMs

3. Kartu Sesi screen showing: focus vs sitting, median recovery ("waktu
   balik"), first collapse minute, and uncertain minutes labelled
   "belum jelas". Plus ONE plain observation sentence.
   Never a judgment. "Fokusmu paling kuat di 12 menit pertama." is right.
   "Kamu terdistraksi 8 kali." is wrong.

4. Klarifikasi card, shown at the BREAK only, and only if uncertain events
   occurred. Maximum ONE card per break, grouping all ambiguous events.
   Buttons: Baca buku / Pegang HP / Campuran / Lewati.
   No answer means the events stay UNCERTAIN. Never coerce them.

5. Onboarding: Selamat Datang (first name only, no account) and
   Izin Orang Tua (consent text from the PRD, checkboxes, name field).

Do not build the Weekly Pattern screen. It is explicitly cut.
```

**✅ Accept when:** a completed session persists across reload · the Session Card shows a median recovery time · the clarification card appears only at breaks, only when there were ambiguous events, and only once.

---

## P5 · Telemetry and ablation *(~6h)*

```
Add research telemetry and the offline ablation tool.

1. src/storage/telemetry.ts
   Record one JSONL row per frame during a session:
   { t, faceFound, yaw, pitch, eyeBlink, objects }
   Numbers only. No images, no raw landmarks.

2. An explicit "Unduh data sesi" button on the Session Card that triggers a
   local file download. NO automatic upload. No network call. Ever.
   (CLAUDE.md constraint 2 — this is demonstrated live on stage.)

3. tools/replay.ts — a Node script:
   Input: a telemetry JSONL file + declared media + cone
   Replays frames through FocusEngine under three configs:
     A: { useDeclaredMedia: false, useObjects: false }
     B: { useDeclaredMedia: true,  useObjects: true  }
     C: B, plus recorded clarification answers applied to UNCERTAIN groups
   Output a table: per-state durations, uncertain %, and transition counts
   for each config.

This is the ablation from PRD section 11. It must reuse the same
FocusEngine — do not reimplement the logic.
```

**✅ Accept when:** `node tools/replay.ts sample.jsonl` prints three columns from one recording · the app still makes zero network requests with DevTools open.

---

## Not for Claude Code

**Week 5 polish is your job, not the agent's.** Spacing, type scale, Hachiko's actual artwork, motion feel, and the desktop mockups for the deck are design decisions. An agent will produce something that works and looks generic — and "generic" is the thing you're specifically trying to avoid as the designer on this team.

Two things to hand-check before submission:

1. Open DevTools → Network → run a full session. **It must be empty.** Anything else and the stage demo becomes a false claim.
2. Search the codebase for `#f00`, `red`, `gagal`, `malas`, `salah`. All should return nothing.

---

## If Claude Code goes off the rails

- **It added a dependency** → revert, re-point it at CLAUDE.md constraint 1
- **It built extra screens** → revert. Say "build only what P_ specifies, nothing else"
- **It put browser code in `src/engine/`** → the tests will fail under Node; that's the tripwire working
- **It used `requestAnimationFrame`** → this only shows up as a bug when a tab is backgrounded, so check it by hand in P1
- **It rewrote the engine types** → revert. The contract in CLAUDE.md is what makes P5's ablation possible

---

## 🔴 CURRENT BLOCKER — multi-cycle runtime debug (handoff addendum)

> This is NOT part of the original P0–P5 sequence. It's the current open
> issue, to be debugged before any further product work. Status:
> **BLOCKED / UNRESOLVED.** Do not mark it fixed without real browser
> verification.

### Observed vs expected

**Observed** — cycle selector set to 2 or 4, actual browser runtime:

```
work → break → Session Card
```

**Expected:**

```
cycle 2:  work → break → work → report
cycle 4:  work → break → work → break → work → break → work → report
```

A prior audit of the source **and the compiled output** appeared to contain
the correct `for (let i = 0; i < cycleCount; i++) { ... }` loop with
`renderBreak` only between cycles, yet the browser runtime still exits after
the first break. The discrepancy between source and runtime is itself the
open question.

### Debug instructions (do this, in order)

1. Do **not** rewrite `runSession` first.
2. Do **not** change the `SessionRecord` schema.
3. Do **not** change `FocusEngine`.
4. Do **not** change perception / AI / object detection.
5. Do **not** change the PDF writer.
6. Do **not** change storage.
7. First, trace the **actual browser execution path**.
8. Verify **which implementation is actually executing** in the browser
   (e.g. the served module graph, not the file on disk you assume).
9. Identify **where control flow resolves back to the Session Card**.
10. Inspect runtime behavior around `renderBreak` / `runWorkPhase` / `runSession`.
11. Distinguish **cycle-loop completion** from the **outer repeat-session
    resolution** (the two levels of control — do not conflate them).
12. Verify **event / Promise resolution**, not just the compiled loop text.
13. Add instrumentation if needed (console logs at the loop top, before/after
    `await runWorkPhase`, before/after `await renderBreak`, and inside
    `finishNow`).
14. Remove temporary instrumentation after the root cause is found, unless you
    deliberately retain it behind a flag.
15. Only then make a **minimal** fix.

Do **not** assume "stale cache / stale artifact" is the root cause.

### Required debug questions (investigation targets — do not answer speculatively)

- Who resolves `runSession()` after the break?
- Is `renderBreak()` returning/throwing something that terminates the outer cycle loop?
- Is `runWorkPhase()` actually returning after the break?
- Is `runSession()` awaiting the next cycle?
- Is the Session Card being rendered by an outer flow before the cycle loop completes?
- Is an old Promise / closure / `resolve` handler still active?
- Is the `repeat` boolean being confused with cycle completion?
- Is there more than one `runSession()` implementation / path?
- Is the browser serving the expected module graph?
- Does the runtime log show cycle index progression (`i` = 0, 1, 2, …)?
- Does the runtime receive the selected `cycleCount` value at `runSession`?

### Relevant files

- `src/main.ts` — repeat loop, `runSession` call site.
- `src/ui/screens/session.ts` — `runSession` (cycle loop), `runWorkPhase`, `renderBreak`.
- `src/ui/screens/ready.ts` — cycle selector → `cycleCount`.
- `src/ui/sessionConfig.ts` — `CYCLE_COUNT_OPTIONS`, `DEFAULT_CYCLE_COUNT`.
- `HACHIKO_SOURCE_OF_TRUTH.md` — §10 (blocker), §15 (next objective).
