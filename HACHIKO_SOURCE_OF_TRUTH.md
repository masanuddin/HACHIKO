# HACHIKO — Source of Truth

> ✅ **SUPERSEDED.** The multi-cycle architecture documented below (an
> upfront fixed-cycle-count `for` loop, §4/§10) was never fixed - it was
> replaced by a different design: the Break screen itself asks "Fokus
> lagi?" / "Selesai untuk hari ini?" after every cycle, with a long break
> every Nth round instead of a fixed total. See
> `docs/superpowers/specs/2026-09-13-multi-cycle-pomodoro-port-design.md`
> and `CLAUDE.md`'s top note. Kept below as a historical record of what
> was tried and why it was abandoned, not as current documentation -
> verify anything here against the actual source first.

> Single handoff snapshot for the teammate taking over the multi-cycle
> Pomodoro debugging. Everything below reflects the repository as-is at
> handoff time. If this file and any other doc disagree, verify against the
> source code — the source is what actually runs.

## 1. Project Status

- **Product:** browser focus companion for Indonesian junior-high students.
  The webcam watches posture during a Pomodoro; a dog sleeps while focused,
  wakes when attention drifts. No accounts, no server, nothing leaves the
  browser tab.
- **Stack:** Vite + TypeScript (strict) + `@mediapipe/tasks-vision` + vitest.
  Plain DOM, no framework. Allowed deps only: `@mediapipe/tasks-vision`,
  `vite`, `typescript`, `vitest`.
- **Multi-cycle status:** implemented at source level, but browser runtime is
  **BLOCKED / UNRESOLVED** (see §10).

## 2. Current Product Flow

```
Welcome → Consent → Framing kamera → Calibration → Media → Ready (durasi + putaran)
→ Pomodoro Session (multi-cycle) → Session Card → Repeat / Selesai
→ End screen (Muat ulang / Hapus profil)
```

- Onboarding (Welcome + Consent) runs once; skipped when `hachiko.profile.v1`
  exists (`src/main.ts`).
- Ready screen now collects **both** work duration (15/25/50 min) and
  **cycle count** (1/2/3/4).
- One `runSession` call runs the whole cycle sequence, then ONE clarify
  (if any uncertain time), ONE `saveSession`, ONE Session Card.

## 3. Current Implemented Features

- Pomodoro duration selector: 15 / 25 / 50 menit (`src/ui/sessionConfig.ts`).
- Cycle selector: 1 / 2 / 3 / 4 putaran; default cycle count = 4.
- Break = 5 menit antar-cycle (`BREAK_MS`).
- No break after the final cycle.
- One sequence = one `SessionRecord`.
- One sequence = one `TelemetryRecorder` (persisted once at the end).
- One history entry per sequence.
- Clarification shown once, at the end of the sequence.
- "Ulangi sesi" repeats the same duration + cycle count.
- "Selesai" ends the whole sequence (skips remaining cycles).
- Cycle indicator label "Putaran i dari N" (shown only when cycle count > 1).
- Session Card metrics: Waktu fokus / Waktu duduk / Waktu Away / Belum jelas.
- Session history (previous sessions) with per-session delete + delete-all.
- PDF report download (zero-dependency writer).
- "Muat ulang" action on the end screen.

## 4. Current Pomodoro Architecture

- Work duration and cycle count are chosen in-memory on the Ready screen and
  reused verbatim across "Ulangi sesi" (never persisted).
- `runSession(...)` (in `src/ui/screens/session.ts`) owns the shared
  accumulators and loops the cycles:

  ```ts
  const record = newSessionRecord(declaredMedia)
  const telemetry = new TelemetryRecorder()
  const origin = { t: null }

  for (let i = 0; i < cycleCount; i++) {
    const { endedManually } = await runWorkPhase(...)
    if (endedManually) break            // "Selesai" ends the whole sequence
    if (i < cycleCount - 1) await renderBreak(root)  // break between cycles only
  }

  persistRecording(record.id, telemetry.toJsonl())
  // clarify (once) → saveSession(record) → renderSessionCard
  ```

- `runWorkPhase(...)` runs a single work cycle: it renders the timer +
  Hachiko + state label, drives the perception loop, and accumulates into the
  shared `record` / `telemetry` passed in from `runSession`.
- Per-cycle state (engine, timer, `remainingMs`, `previousState`, pacing
  accumulators) is local to each `runWorkPhase` call. `record.durationsMs`
  and `record.uncertainMs` accumulate across cycles via `+=`.
- `firstCollapseAtMs` is relative to the whole sequence via a shared `origin`
  timestamp.
- The engine (`FocusEngine`) is recreated fresh per cycle; its
  `out.uncertainMs` is captured per cycle and summed into `record.uncertainMs`.

## 5. Current SessionRecord Semantics

- **One user-started Pomodoro sequence = one `SessionRecord`.**
- Schema (in `src/storage/sessions.ts`) is unchanged from the single-cycle
  build; no migration was introduced:

  ```ts
  interface SessionRecord {
    id: string
    startedAt: number
    declaredMedia: Media[]
    durationsMs: Record<FocusState, number>   // accumulated across all cycles
    distractionEvents: DistractionSpan[]
    recoveryTimesMs: number[]                 // still recorded, not displayed
    uncertainMs: number                       // accumulated across all cycles
    firstCollapseAtMs: number | null          // relative to sequence start
    clarification: { answer: ClarificationAnswer | null } | null
  }
  ```

## 6. Current Metrics Semantics

- **Waktu Away** = `durationsMs.TIDAK_HADIR` (total time not in front of the
  laptop).
- **Waktu Duduk** = total time present = `FOKUS + TERALIH + MENGANTUK +
  UNCERTAIN`. Sitting and Away are the two sides of presence.
- **Waktu fokus** = `FOKUS` (+ uncertain folded in if clarification answer is
  `book`). Displayed as "X dari Y" where Y is the active/present total.
- **Focus line zero state:** `0 focus / 0 total` renders `"0 detik dari 0 detik"`.
  Non-zero sub-minute durations render in seconds (`formatDuration`).
- **Recovery time** is still recorded in `recoveryTimesMs` but is no longer
  displayed as a Session Card or PDF metric.

## 7. Current Storage Semantics

| Key | Purpose |
|---|---|
| `hachiko.profile.v1` | first name + guardian name + consentedAt |
| `hachiko.sessions.v1` | session history (array of `SessionRecord`) |
| `hachiko.telemetry.v1` | internal JSONL research/replay recordings (last 2) |

- **Delete Session** → remove one `SessionRecord` by id.
- **Delete All Sessions** → `deleteAllSessions()` clears the whole
  `hachiko.sessions.v1` key (no exception).
- **Delete Profile** → `deleteProfile()` + `deleteAllSessions()` (composed in
  `src/main.ts`), so deleting the profile also clears session history.
- Telemetry (`hachiko.telemetry.v1`) is **never** touched by any delete.
- Calibration (cone) is in-memory only — never persisted.

## 8. Current Report / PDF Semantics

- The Session Card and the PDF report both derive from `computeMetrics(record)`
  and share the same formatters, so they never disagree.
- PDF is a zero-dependency writer (`src/ui/pdf.ts`), Helvetica Type1, Latin
  ASCII only.
- Sub-minute durations render in seconds in both the card and the PDF.
- PDF is downloaded via the "Unduh laporan sesi" button (student-initiated,
  no network).

## 9. Current UI Actions

- **Session Card** (`src/ui/screens/sessionCard.ts`):
  - Unduh laporan sesi
  - Ulangi sesi (with inline confirm)
  - Selesai
  - *(Note: "Mulai dari awal" was removed from the Session Card — superseded.)*
- **End screen** (`src/main.ts` `renderEndScreen`):
  - Muat ulang (→ `location.reload()`, skips Welcome when profile exists)
  - Hapus profil (→ deletes profile + session history, then reloads)

## 10. Known Bug / Blocker

**BLOCKED / UNRESOLVED — multi-cycle runtime behavior.**

- **Observed:** selecting 2 or 4 putaran still produces:
  ```
  25 work → 5 break → Session Card
  ```
  i.e. the flow returns to the Session Card after the first break instead of
  running the remaining cycles.
- **Expected:**
  - 2 putaran: `25 → 5 → 25 → Report`
  - 4 putaran: `25 → 5 → 25 → 5 → 25 → 5 → 25 → Report`
- **Source/build audit so far:** the current source and the compiled output
  both appear to contain the expected cycle loop
  (`for (let i = 0; i < cycleCount; i++) { ... }` with `renderBreak` only
  between cycles). The runtime still violates it.
- **Status:** BLOCKED / UNRESOLVED. No root cause is confirmed yet. Do not
  mark this "fixed" without new browser-runtime evidence.

## 11. What Has Been Verified

- `npx tsc --noEmit` — passes.
- `npm test` — passes (currently **63/63** tests).
- `npm run build` — succeeds.

## 12. What Has NOT Been Verified

- Real browser runtime multi-cycle behavior.
- 2-cycle flow.
- 4-cycle flow.
- The runtime contract between the source loop and actual browser behavior
  (this is the open blocker).

## 13. Important Constraints

- **No new dependencies.** Allowed list only: `@mediapipe/tasks-vision`,
  `vite`, `typescript`, `vitest`.
- **No network calls at runtime** (fetch/XHR/WebSocket/analytics/CDN).
- **No camera frames stored or transmitted** — derived numbers only.
- **`src/engine/` is pure TypeScript** — no DOM/browser APIs/`Date.now()`.
- Do not assume multi-cycle runtime is verified just because tests/build pass;
  browser runtime verification is required.
- Do not change `FocusEngine` / perception to fix an orchestration bug.
- Do not do a schema redesign without a concrete reason.
- Do not debug AI / object detection while the open issue is Pomodoro
  orchestration.
- User-facing strings in Indonesian; no `gagal`/`malas`/`salah`; no red.

## 14. Relevant Files

- `src/main.ts` — flow orchestration + repeat loop + end screen.
- `src/ui/screens/session.ts` — `runSession` (cycle loop), `runWorkPhase`
  (one cycle), `renderBreak`.
- `src/ui/screens/ready.ts` — duration + cycle selectors.
- `src/ui/screens/sessionCard.ts` — Session Card metrics, history, actions.
- `src/ui/sessionConfig.ts` — `WORK_DURATION_OPTIONS_MIN`, `BREAK_MS`,
  `CYCLE_COUNT_OPTIONS`, `DEFAULT_CYCLE_COUNT`.
- `src/ui/strings.ts` — user-facing copy + `formatDuration` / `formatFocusLine`.
- `src/ui/pacing.ts` — `shouldOfferEarlyBreak`, `shouldOfferExtension`.
- `src/ui/pdf.ts` — zero-dependency PDF writer.
- `src/storage/sessions.ts` — `SessionRecord`, `computeMetrics`,
  `deleteSession`, `deleteAllSessions`, `saveSession`, `listSessions`.
- `src/storage/profile.ts` — `loadProfile`, `saveProfile`, `deleteProfile`.
- `src/storage/telemetry.ts` — `TelemetryRecorder`, `persistRecording`.
- `src/storage/companion.ts` — `deriveCompanionState`, `findNewMilestone`.
- `src/engine/focusEngine.ts`, `src/engine/types.ts`, `src/engine/config.ts`.
- Tests: `src/storage/sessions.test.ts`, `src/storage/profile.test.ts`,
  `src/storage/companion.test.ts`, `src/ui/strings.test.ts`,
  `src/ui/pdf.test.ts`, `src/ui/pacing.test.ts`,
  `src/engine/focusEngine.test.ts`, `src/engine/calibrate.test.ts`.

## 15. Next Debugging Objective

> Find why the browser runtime exits the multi-cycle run after the first
> break even though the current source/build contains the expected cycle
> loop.

Keep it narrow: verify the real browser runtime of `runSession`'s cycle loop
(first with `?mentor` and/or console instrumentation if useful), and reconcile
the observed runtime with the source loop. Do not change engine/perception or
the schema while investigating.

## 16. Historical / Superseded Decisions

| Decision | Status |
|---|---|
| "Mulai dari awal" button on Session Card | **SUPERSEDED / REMOVED** — no longer a Session Card action. "Muat ulang" on the end screen remains a separate action. |
| Multi-cycle runtime (2/4 putaran) | **IMPLEMENTED (source) / UNRESOLVED (runtime)** |
| JSONL user-facing download button | **SUPERSEDED** — replaced by the PDF "Unduh laporan sesi" button; JSONL remains internal for research/replay. |
| "Delete Profile keeps session history" | **SUPERSEDED** — latest behavior: deleting profile also deletes session history. |
| "Delete All Sessions keeps current session" (via `exceptId`) | **SUPERSEDED** — `deleteAllSessions()` now clears the entire history with no exception. |
| Recovery time ("waktu balik") as a Session Card metric | **SUPERSEDED** — recorded but no longer displayed; "Waktu Away" now means absence time. |
