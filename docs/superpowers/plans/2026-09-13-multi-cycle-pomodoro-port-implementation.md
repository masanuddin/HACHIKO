# Multi-Cycle Pomodoro Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-cycle-per-report session flow with hachiko-desktop's already-built, already-tested multi-cycle loop (Work → Break → Work → Break → ...), where the Break screen itself asks "another round, or done for today?" instead of a fixed upfront round count. Removes "Ulangi sesi" (its job moves to Break) and adds a net-new confirm step on "Selesai" since it now ends the whole plan, not one cycle.

**Architecture:** `runSession` (in `src/ui/screens/session.ts`) becomes the loop owner: it repeats Work→Break internally, collecting one `SessionRecord` per cycle, then combines them with a new pure `mergeSessionRecords` function (`src/storage/sessions.ts`) into the single record that gets saved, cleared through Clarify once, and shown on one Session Card. `main.ts` calls `runSession` exactly once instead of looping around it.

**Tech Stack:** Plain TypeScript, Vitest for the new pure-function tests. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-13-multi-cycle-pomodoro-port-design.md`

## Global Constraints

- No new npm dependency anywhere in this plan.
- No new CSS custom property or class - every screen reuses the existing `.card`, `.screen__actions`, `.session__nudge` patterns already in `src/styles/base.css`.
- No color anywhere is red.
- `src/engine/` and the focus engine's algorithm are untouched.
- No focus counter, distraction count, score, or percentage is shown during a live session - this plan changes only the Break screen (between cycles) and end-of-plan screens, never anything rendered during `runWorkPhase`'s live loop.
- "Selesai" (in-session) always ends the *entire* multi-cycle plan, never just the current cycle - confirmed via an inline pause+confirm card, then skips Break entirely and goes straight to merge → Clarify → Session Card.
- `workMs` (from the Ready screen) is chosen once per sitting and reused for every cycle - no per-cycle duration change, no fixed upfront cycle count.
- `runWorkPhase`'s own internals (focus engine, telemetry, early-break/extension nudges, mentor-mode overlay) are untouched by this plan.
- User-facing strings stay in Indonesian, casual register, in `src/ui/strings.ts` only.

---

### Task 1: `mergeSessionRecords` (TDD)

**Files:**
- Modify: `src/storage/sessions.ts` (add export, after the existing `emptyDurations` function at line 125)
- Modify: `src/storage/sessions.test.ts` (add import + new `describe` block)

**Interfaces:**
- Consumes: `SessionRecord`, `DistractionSpan`, `emptyDurations()` (all already exist in `src/storage/sessions.ts`).
- Produces: `mergeSessionRecords(id: string, records: SessionRecord[]): SessionRecord` - Task 4 imports this into `src/ui/screens/session.ts`.

- [ ] **Step 1: Write the failing tests**

In `src/storage/sessions.test.ts`, find the import at the top:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeMetrics,
  deleteAllSessions,
  deleteSession,
  emptyDurations,
  listSessions,
  saveSession,
  type SessionRecord,
} from './sessions'
```

Replace with:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeMetrics,
  deleteAllSessions,
  deleteSession,
  emptyDurations,
  listSessions,
  mergeSessionRecords,
  saveSession,
  type SessionRecord,
} from './sessions'
```

Then, at the end of the file (after the closing `})` of the `describe('session storage', ...)` block), append:

```ts

describe('mergeSessionRecords', () => {
  it('single record -> equivalent data with the new id', () => {
    const only = record({
      startedAt: 5_000,
      declaredMedia: ['book'],
      durationsMs: { ...emptyDurations(), FOKUS: 1000 },
      uncertainMs: 200,
    })
    const merged = mergeSessionRecords('s-merged', [only])
    expect(merged.id).toBe('s-merged')
    expect(merged.startedAt).toBe(5_000)
    expect(merged.declaredMedia).toEqual(['book'])
    expect(merged.durationsMs.FOKUS).toBe(1000)
    expect(merged.uncertainMs).toBe(200)
    expect(merged.clarification).toBeNull()
  })

  it('two records -> durationsMs summed per key', () => {
    const a = record({ durationsMs: { ...emptyDurations(), FOKUS: 1000, TERALIH: 200 } })
    const b = record({ durationsMs: { ...emptyDurations(), FOKUS: 500, MENGANTUK: 100 } })
    const merged = mergeSessionRecords('s-merged', [a, b])
    expect(merged.durationsMs.FOKUS).toBe(1500)
    expect(merged.durationsMs.TERALIH).toBe(200)
    expect(merged.durationsMs.MENGANTUK).toBe(100)
    expect(merged.durationsMs.TIDAK_HADIR).toBe(0)
    expect(merged.durationsMs.UNCERTAIN).toBe(0)
  })

  it('uncertainMs sums across records', () => {
    const a = record({ uncertainMs: 300 })
    const b = record({ uncertainMs: 150 })
    const merged = mergeSessionRecords('s-merged', [a, b])
    expect(merged.uncertainMs).toBe(450)
  })

  it('recoveryTimesMs concatenates in order', () => {
    const a = record({ recoveryTimesMs: [1000, 2000] })
    const b = record({ recoveryTimesMs: [500] })
    const merged = mergeSessionRecords('s-merged', [a, b])
    expect(merged.recoveryTimesMs).toEqual([1000, 2000, 500])
  })

  it("second record's distraction spans are offset by the first record's total elapsed time", () => {
    const a = record({
      durationsMs: { ...emptyDurations(), FOKUS: 6000, TERALIH: 4000 }, // 10_000ms elapsed
      distractionEvents: [{ start: 1000, end: 2000 }],
    })
    const b = record({
      distractionEvents: [{ start: 500, end: 800 }],
    })
    const merged = mergeSessionRecords('s-merged', [a, b])
    expect(merged.distractionEvents).toEqual([
      { start: 1000, end: 2000 },
      { start: 10_500, end: 10_800 },
    ])
  })

  it("a third record's spans are offset by the CUMULATIVE elapsed time of both prior records, not just the immediately preceding one", () => {
    const a = record({ durationsMs: { ...emptyDurations(), FOKUS: 10_000 } }) // 10_000ms elapsed
    const b = record({ durationsMs: { ...emptyDurations(), FOKUS: 20_000 } }) // 20_000ms elapsed
    const c = record({
      distractionEvents: [{ start: 500, end: 700 }],
      firstCollapseAtMs: 100,
    })
    const merged = mergeSessionRecords('s-merged', [a, b, c])
    // cumulative offset going into record c is 10_000 + 20_000 = 30_000
    expect(merged.distractionEvents).toEqual([{ start: 30_500, end: 30_700 }])
    expect(merged.firstCollapseAtMs).toBe(30_100)
  })

  it('firstCollapseAtMs: null in both -> null', () => {
    const merged = mergeSessionRecords('s-merged', [record(), record()])
    expect(merged.firstCollapseAtMs).toBeNull()
  })

  it('firstCollapseAtMs: set in the first record -> used as-is', () => {
    const a = record({ firstCollapseAtMs: 3000 })
    const b = record({ firstCollapseAtMs: 500 })
    const merged = mergeSessionRecords('s-merged', [a, b])
    expect(merged.firstCollapseAtMs).toBe(3000)
  })

  it("firstCollapseAtMs: null in the first record, set in the second -> offset by the first record's elapsed time", () => {
    const a = record({ durationsMs: { ...emptyDurations(), FOKUS: 7000 } }) // 7_000ms elapsed
    const b = record({ firstCollapseAtMs: 1200 })
    const merged = mergeSessionRecords('s-merged', [a, b])
    expect(merged.firstCollapseAtMs).toBe(8200)
  })

  it('clarification is always null in the output, even if an input record had one', () => {
    const a = record({ clarification: { answer: 'book' } })
    const merged = mergeSessionRecords('s-merged', [a])
    expect(merged.clarification).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL - `mergeSessionRecords` is not exported from `./sessions`.

- [ ] **Step 3: Implement `mergeSessionRecords`**

In `src/storage/sessions.ts`, find the end of the file:

```ts
export function emptyDurations(): Record<FocusState, number> {
  return { FOKUS: 0, TERALIH: 0, TIDAK_HADIR: 0, UNCERTAIN: 0, MENGANTUK: 0 }
}
```

Replace with:

```ts
export function emptyDurations(): Record<FocusState, number> {
  return { FOKUS: 0, TERALIH: 0, TIDAK_HADIR: 0, UNCERTAIN: 0, MENGANTUK: 0 }
}

/**
 * Combines every cycle of a multi-cycle Pomodoro session into the one
 * record that actually gets saved and shown - durations summed, spans
 * concatenated onto one continuous timeline (each cycle's own spans are
 * offset by every prior cycle's total elapsed time, since each cycle's
 * timestamps start over at zero), uncertain time summed. `clarification`
 * is always null here - the caller sets it once, after this merge, from
 * a single end-of-loop Clarify screen covering the combined uncertain
 * time. `records` is assumed non-empty - the caller's loop always runs
 * at least one cycle before ever merging.
 */
export function mergeSessionRecords(id: string, records: SessionRecord[]): SessionRecord {
  const durationsMs = emptyDurations()
  const distractionEvents: DistractionSpan[] = []
  const recoveryTimesMs: number[] = []
  let uncertainMs = 0
  let firstCollapseAtMs: number | null = null
  let elapsedOffset = 0

  for (const record of records) {
    for (const key of Object.keys(durationsMs) as FocusState[]) {
      durationsMs[key] += record.durationsMs[key]
    }
    for (const span of record.distractionEvents) {
      distractionEvents.push({ start: span.start + elapsedOffset, end: span.end + elapsedOffset })
    }
    recoveryTimesMs.push(...record.recoveryTimesMs)
    uncertainMs += record.uncertainMs
    if (record.firstCollapseAtMs !== null && firstCollapseAtMs === null) {
      firstCollapseAtMs = record.firstCollapseAtMs + elapsedOffset
    }

    const cycleElapsedMs = Object.values(record.durationsMs).reduce((sum, ms) => sum + ms, 0)
    elapsedOffset += cycleElapsedMs
  }

  const first = records[0] as SessionRecord

  return {
    id,
    startedAt: first.startedAt,
    declaredMedia: first.declaredMedia,
    durationsMs,
    distractionEvents,
    recoveryTimesMs,
    uncertainMs,
    firstCollapseAtMs,
    clarification: null,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS - all `mergeSessionRecords` tests plus every existing test.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/storage/sessions.ts src/storage/sessions.test.ts
git commit -m "Add mergeSessionRecords for combining multi-cycle Pomodoro data into one record"
```

---

### Task 2: Break screen becomes a two-button decision, with an abandonment safety net

**Files:**
- Modify: `src/ui/sessionConfig.ts:7` (add `BREAK_ABANDON_MS` after `BREAK_MS`)
- Modify: `src/ui/strings.ts:101-103` (`session.breakBody` text, add `breakContinueLabel`/`breakStopLabel`)
- Modify: `src/ui/screens/session.ts:5` (import `BREAK_ABANDON_MS`), `src/ui/screens/session.ts:392-416` (`renderBreak`)

**Interfaces:**
- Produces: `renderBreak(root: HTMLElement): Promise<{ continueSession: boolean }>` (was `Promise<void>`) - Task 4's `runSession` rewrite consumes the `continueSession` field.

- [ ] **Step 1: Add `BREAK_ABANDON_MS`**

In `src/ui/sessionConfig.ts`, find:

```ts
export const WORK_MS = 25 * 60_000
export const BREAK_MS = 5 * 60_000
```

Replace with:

```ts
export const WORK_MS = 25 * 60_000
export const BREAK_MS = 5 * 60_000

// Far longer than anyone would plausibly sit on the Break screen while
// still intending to continue - a safety net so a student who walks
// away and never comes back doesn't lose an already-completed cycle's
// data forever, not a nudge shown to them.
export const BREAK_ABANDON_MS = 10 * 60_000
```

- [ ] **Step 2: Update Break copy and add the two button labels**

In `src/ui/strings.ts`, find:

```ts
    breakTitle: 'Waktunya istirahat',
    breakBody: 'Regangkan badan sebentar. Sesi berikutnya dimulai otomatis.',
    goToBreak: 'Istirahat sekarang',
```

Replace with:

```ts
    breakTitle: 'Waktunya istirahat',
    breakBody: 'Regangkan badan sebentar. Kalau siap, kamu yang tentuin lanjut atau selesai.',
    goToBreak: 'Istirahat sekarang',
    breakContinueLabel: 'Fokus lagi',
    breakStopLabel: 'Selesai untuk hari ini',
```

- [ ] **Step 3: Import `BREAK_ABANDON_MS` in session.ts**

In `src/ui/screens/session.ts`, find:

```ts
import { BREAK_MS, EXTENSION_MS, STIRRING_RATIO } from '../sessionConfig'
```

Replace with:

```ts
import { BREAK_ABANDON_MS, BREAK_MS, EXTENSION_MS, STIRRING_RATIO } from '../sessionConfig'
```

- [ ] **Step 4: Rewrite `renderBreak`**

In `src/ui/screens/session.ts`, find:

```ts
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
```

Replace with:

```ts
/**
 * Two explicit choices, not a countdown-gated single button: the
 * student decides fresh after each cycle whether to do another one.
 * Both buttons are available immediately; the countdown keeps ticking
 * for company but holds at 0:00 rather than auto-picking anything.
 */
function renderBreak(root: HTMLElement): Promise<{ continueSession: boolean }> {
  return new Promise((resolve) => {
    const s = strings.session
    const { root: screenEl, content } = screen()

    const countdown = el('p', { class: 'screen__title' }, [formatTimer(BREAK_MS)])
    let remaining = BREAK_MS
    let settled = false

    const choose = (continueSession: boolean) => {
      if (settled) return
      settled = true
      window.clearInterval(countdownInterval)
      window.clearTimeout(abandonTimeout)
      root.replaceChildren()
      resolve({ continueSession })
    }

    const continueBtn = button(s.breakContinueLabel, () => choose(true))
    const stopBtn = button(s.breakStopLabel, () => choose(false), { variant: 'secondary' })
    content.append(title(s.breakTitle), body(s.breakBody), countdown, actions(continueBtn, stopBtn))
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
```

- [ ] **Step 5: Typecheck and test**

Run: `npm run typecheck` - expect zero errors (the one existing call site, `await renderBreak(root)` inside `runSession`, ignores the resolved value and stays valid).
Run: `npm test` - expect every existing test to still pass (this task touches no pure, tested module).

- [ ] **Step 6: Commit**

```bash
git add src/ui/sessionConfig.ts src/ui/strings.ts src/ui/screens/session.ts
git commit -m "Break screen now asks Fokus lagi / Selesai untuk hari ini, with an abandonment safety net"
```

---

### Task 3: "Selesai" gains a pause-and-confirm step

**Files:**
- Modify: `src/ui/strings.ts:91-93` (add `selesaiConfirmTitle`/`selesaiConfirmYes`/`selesaiConfirmNo`)
- Modify: `src/ui/screens/session.ts:176` (`selesaiBtn`), `src/ui/screens/session.ts:266-271` (`nudgeVisible`/`hideNudge`)

**Interfaces:**
- Consumes: existing `nudgeSlot`, `paused`, `jedaBtn`, `card`, `actions`, `button`, `el` (all already in scope in `runWorkPhase`); existing `finishNow(endedManually: boolean): void`.
- Produces: nothing new consumed by other tasks - this is an internal behavior change to `runWorkPhase`.

- [ ] **Step 1: Add the confirm-card strings**

In `src/ui/strings.ts`, find:

```ts
  session: {
    jeda: 'Jeda',
    selesai: 'Selesai',
```

Replace with:

```ts
  session: {
    jeda: 'Jeda',
    selesai: 'Selesai',
    selesaiConfirmTitle: 'Selesai untuk hari ini?',
    selesaiConfirmYes: 'Ya, selesai',
    selesaiConfirmNo: 'Lanjut fokus',
```

- [ ] **Step 2: Widen the nudge-kind type and track pre-confirm pause state**

In `src/ui/screens/session.ts`, find:

```ts
    let nudgeVisible: 'earlyBreak' | 'extension' | null = null

    function hideNudge(): void {
      nudgeVisible = null
      nudgeSlot.replaceChildren()
    }
```

Replace with:

```ts
    let nudgeVisible: 'earlyBreak' | 'extension' | 'selesaiConfirm' | null = null
    let pausedBeforeSelesaiConfirm = false

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
      const confirmBtn = button(s.selesaiConfirmYes, () => {
        hideNudge()
        finishNow(true)
      })
      const cancelBtn = button(
        s.selesaiConfirmNo,
        () => {
          paused = pausedBeforeSelesaiConfirm
          jedaBtn.textContent = paused ? strings.common.continueLabel : s.jeda
          hideNudge()
        },
        { variant: 'secondary' },
      )
      nudgeSlot.replaceChildren(
        card(el('h2', { class: 'card__title' }, [s.selesaiConfirmTitle]), actions(cancelBtn, confirmBtn)),
      )
    }
```

- [ ] **Step 3: Wire "Selesai" to the confirm card**

In `src/ui/screens/session.ts`, find:

```ts
    const selesaiBtn = button(s.selesai, () => finishNow(true), { variant: 'secondary' })
```

Replace with:

```ts
    const selesaiBtn = button(s.selesai, showSelesaiConfirm, { variant: 'secondary' })
```

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck` - expect zero errors (`showSelesaiConfirm` is a hoisted function declaration, so the forward reference from `selesaiBtn` - defined earlier in the same closure - resolves fine, matching how `finishNow` is already referenced before its own definition in this file).
Run: `npm test` - expect every existing test to still pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/strings.ts src/ui/screens/session.ts
git commit -m "Selesai now pauses and asks for confirmation before ending the session"
```

---

### Task 4: `runSession` becomes the multi-cycle loop; `main.ts` calls it once

**Files:**
- Modify: `src/ui/screens/session.ts:15` (import `mergeSessionRecords`), `src/ui/screens/session.ts:27-39` (`newSessionRecord`), `src/ui/screens/session.ts:375-389` (`finishNow`), `src/ui/screens/session.ts:418-445` (`runSession`)
- Modify: `src/main.ts:44-59`

**Interfaces:**
- Consumes: `mergeSessionRecords(id, records)` from Task 1; `renderBreak(root): Promise<{ continueSession: boolean }>` from Task 2; `showSelesaiConfirm`'s `endedManually: true` path from Task 3 (already flows through the existing `WorkPhaseResult.endedManually` field - no new interface needed there).
- Produces: `runSession(root, video, bundle, cone, declaredMedia, workMs): Promise<void>` (was `Promise<boolean>`) - `main.ts` is the only caller.

- [ ] **Step 1: Import `mergeSessionRecords`**

In `src/ui/screens/session.ts`, find:

```ts
import { emptyDurations, saveSession, listSessions, type DistractionSpan, type SessionRecord } from '../../storage/sessions'
```

Replace with:

```ts
import { emptyDurations, mergeSessionRecords, saveSession, listSessions, type DistractionSpan, type SessionRecord } from '../../storage/sessions'
```

- [ ] **Step 2: Extract `newSessionId()`**

In `src/ui/screens/session.ts`, find:

```ts
function newSessionRecord(declaredMedia: Media[]): SessionRecord {
  return {
    id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: Date.now(),
```

Replace with:

```ts
function newSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function newSessionRecord(declaredMedia: Media[]): SessionRecord {
  return {
    id: newSessionId(),
    startedAt: Date.now(),
```

- [ ] **Step 3: Stop persisting telemetry per cycle**

In `src/ui/screens/session.ts`, find:

```ts
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
```

Replace with:

```ts
    function finishNow(endedManually: boolean): void {
      if (finished) return
      finished = true
      loop.stop()
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
```

- [ ] **Step 4: Rewrite `runSession`**

In `src/ui/screens/session.ts`, find:

```ts
export async function runSession(
  root: HTMLElement,
  video: HTMLVideoElement,
  bundle: PerceptionBundle,
  cone: Cone,
  declaredMedia: Media[],
  workMs: number,
): Promise<boolean> {
  const { record } = await runWorkPhase(root, video, bundle, cone, declaredMedia, workMs)

  // The 5-minute break now shows for BOTH endings - timer finishing or
  // the student ending manually - before the report, so no skip guard here.
  await renderBreak(root)

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
  return (await renderSessionCard(root, record, milestone)) === 'repeat'
}
```

Replace with:

```ts
export async function runSession(
  root: HTMLElement,
  video: HTMLVideoElement,
  bundle: PerceptionBundle,
  cone: Cone,
  declaredMedia: Media[],
  workMs: number,
): Promise<void> {
  const records: SessionRecord[] = []
  const telemetryParts: string[] = []
  let keepGoing = true

  // Work -> Break -> Work -> Break -> ... for as long as the student
  // keeps choosing "Fokus lagi." "Selesai" during any Work block ends
  // the whole plan immediately, skipping Break for that final cycle.
  while (keepGoing) {
    const { record, telemetryJsonl, endedManually } = await runWorkPhase(root, video, bundle, cone, declaredMedia, workMs)
    records.push(record)
    telemetryParts.push(telemetryJsonl)

    if (endedManually) {
      keepGoing = false
    } else {
      const { continueSession } = await renderBreak(root)
      keepGoing = continueSession
    }
  }

  // The camera stream and perception bundle stayed alive across every
  // cycle above; this is the one point where the whole plan is over.
  bundle.camera.stop()

  const mergedId = newSessionId()
  const merged = mergeSessionRecords(mergedId, records)
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
```

- [ ] **Step 5: Update `main.ts`'s call site**

In `src/main.ts`, find:

```ts
  const workMs = await renderReady(root, video)

  // Repeat loop: "Ulangi sesi" on the Session Card starts a fresh Pomodoro
  // reusing the same calibration (cone), camera stream, and perception
  // bundle - never re-running onboarding, framing, calibration, media, or
  // ready. The chosen work duration is reused too (in-memory only). The
  // camera is stopped exactly once, after the student finally chooses
  // "Selesai".
  let repeat = true
  while (repeat) {
    repeat = await runSession(root, video, bundle, cone, declaredMedia, workMs)
  }

  bundle.camera.stop()
  renderEndScreen(root)
```

Replace with:

```ts
  const workMs = await renderReady(root, video)

  // runSession now owns the whole multi-cycle loop (Work -> Break ->
  // Work -> Break -> ...) internally, asking "Fokus lagi?" on its own
  // Break screen, and stops the camera itself once the student is done.
  await runSession(root, video, bundle, cone, declaredMedia, workMs)

  renderEndScreen(root)
```

- [ ] **Step 6: Typecheck and test**

Run: `npm run typecheck` - expect zero errors. (`renderSessionCard`'s current `Promise<'repeat' | 'done'>` return type is still valid here since its resolved value is no longer read - Task 5 simplifies that type.)
Run: `npm test` - expect every existing test, plus Task 1's new `mergeSessionRecords` tests, to pass.

- [ ] **Step 7: Commit**

```bash
git add src/ui/screens/session.ts src/main.ts
git commit -m "Loop Work -> Break in runSession; main.ts calls it once instead of repeating around it"
```

---

### Task 5: Remove "Ulangi sesi" from the Session Card

**Files:**
- Modify: `src/ui/strings.ts:140-143` (remove `repeatLabel`/`repeatConfirmTitle`/`repeatConfirmStart`/`repeatConfirmCancel`)
- Modify: `src/ui/screens/sessionCard.ts:131-230` (`renderSessionCard`)

**Interfaces:**
- Produces: `renderSessionCard(root, record, milestone): Promise<void>` (was `Promise<'repeat' | 'done'>`) - no other file reads its resolved value (Task 4 already calls it as `await renderSessionCard(...)` without using the result), so this is a self-contained cleanup.

- [ ] **Step 1: Remove the repeat strings**

In `src/ui/strings.ts`, find:

```ts
    pdfFooter: 'HACHIKO - semua data tetap di perangkatmu saja',
    repeatLabel: 'Ulangi sesi',
    repeatConfirmTitle: 'Siap mulai sesi lagi?',
    repeatConfirmStart: 'Mulai',
    repeatConfirmCancel: 'Batal',
    doneLabel: 'Selesai',
```

Replace with:

```ts
    pdfFooter: 'HACHIKO - semua data tetap di perangkatmu saja',
    doneLabel: 'Selesai',
```

- [ ] **Step 2: Simplify `renderSessionCard`**

In `src/ui/screens/sessionCard.ts`, find:

```ts
export function renderSessionCard(
  root: HTMLElement,
  record: SessionRecord,
  milestone: Milestone | null,
): Promise<'repeat' | 'done'> {
  return new Promise((resolve) => {
    const s = strings.sessionCard
    const { root: screenEl, content } = screen()
    const metrics = computeMetrics(record)
    const metricsGrid = metricGrid(metrics)

    const cardChildren: (Node | string)[] = [metricsGrid, el('p', { class: 'observation' }, [sessionObservation(metrics.firstCollapseAtMs)])]
    if (metrics.exceedsUncertainThreshold) {
      cardChildren.push(el('p', { class: 'threshold-note' }, [s.uncertainThresholdNote]))
    }

    let settled = false

    function finish(decision: 'repeat' | 'done'): void {
      if (settled) return
      settled = true
      root.replaceChildren()
      resolve(decision)
    }

    const errorNote = el('p', { class: 'note' }, [s.downloadError])
    errorNote.style.display = 'none'

    const downloadBtn = button(s.downloadLabel, () => {
      try {
        const bytes = buildSessionReportPdf(record)
        downloadPdf(pdfFilename(record.startedAt), bytes)
        errorNote.style.display = 'none'
      } catch (err) {
        console.error(err)
        errorNote.style.display = ''
      }
    }, { variant: 'secondary' })

    const doneBtn = button(s.doneLabel, () => finish('done'))

    const repeatBtn = button(s.repeatLabel, showConfirm, { variant: 'secondary' })

    const reportActions = actions(downloadBtn, repeatBtn, doneBtn)

    // Inline confirmation (no modal system) - the same card + actions
    // pattern as the in-session nudges. Swapped in place of the report
    // actions while open; "Batal" restores them.
    const confirmCard = card(
      el('h2', { class: 'card__title' }, [s.repeatConfirmTitle]),
      actions(
        button(s.repeatConfirmCancel, hideConfirm, { variant: 'secondary' }),
        button(s.repeatConfirmStart, () => finish('repeat')),
      ),
    )
    confirmCard.style.display = 'none'

    function showConfirm(): void {
      reportActions.style.display = 'none'
      confirmCard.style.display = 'flex'
    }

    function hideConfirm(): void {
      confirmCard.style.display = 'none'
      reportActions.style.display = 'flex'
    }

    const celebration: (Node | string)[] = milestone ? [celebrationBlock(milestone)] : []
    const historyWrap = el('div')

    function renderHistory(): void {
      const history = historySection(
        record.id,
        (id) => {
          deleteSession(id)
          renderHistory()
        },
        () => {
          deleteAllSessions()
          renderHistory()
        },
      )
      historyWrap.replaceChildren(...(history ? [history] : []))
    }
    renderHistory()

    content.append(
      title(s.title),
      ...celebration,
      card(...cardChildren),
      historyWrap,
      body(s.downloadNote),
      reportActions,
      errorNote,
      confirmCard,
    )

    root.replaceChildren(screenEl)
  })
}
```

Replace with:

```ts
export function renderSessionCard(
  root: HTMLElement,
  record: SessionRecord,
  milestone: Milestone | null,
): Promise<void> {
  return new Promise((resolve) => {
    const s = strings.sessionCard
    const { root: screenEl, content } = screen()
    const metrics = computeMetrics(record)
    const metricsGrid = metricGrid(metrics)

    const cardChildren: (Node | string)[] = [metricsGrid, el('p', { class: 'observation' }, [sessionObservation(metrics.firstCollapseAtMs)])]
    if (metrics.exceedsUncertainThreshold) {
      cardChildren.push(el('p', { class: 'threshold-note' }, [s.uncertainThresholdNote]))
    }

    let settled = false

    function finish(): void {
      if (settled) return
      settled = true
      root.replaceChildren()
      resolve()
    }

    const errorNote = el('p', { class: 'note' }, [s.downloadError])
    errorNote.style.display = 'none'

    const downloadBtn = button(s.downloadLabel, () => {
      try {
        const bytes = buildSessionReportPdf(record)
        downloadPdf(pdfFilename(record.startedAt), bytes)
        errorNote.style.display = 'none'
      } catch (err) {
        console.error(err)
        errorNote.style.display = ''
      }
    }, { variant: 'secondary' })

    const doneBtn = button(s.doneLabel, finish)

    const reportActions = actions(downloadBtn, doneBtn)

    const celebration: (Node | string)[] = milestone ? [celebrationBlock(milestone)] : []
    const historyWrap = el('div')

    function renderHistory(): void {
      const history = historySection(
        record.id,
        (id) => {
          deleteSession(id)
          renderHistory()
        },
        () => {
          deleteAllSessions()
          renderHistory()
        },
      )
      historyWrap.replaceChildren(...(history ? [history] : []))
    }
    renderHistory()

    content.append(
      title(s.title),
      ...celebration,
      card(...cardChildren),
      historyWrap,
      body(s.downloadNote),
      reportActions,
      errorNote,
    )

    root.replaceChildren(screenEl)
  })
}
```

- [ ] **Step 3: Typecheck and test**

Run: `npm run typecheck` - expect zero errors.
Run: `npm test` - expect every test to pass.

- [ ] **Step 4: Commit**

```bash
git add src/ui/strings.ts src/ui/screens/sessionCard.ts
git commit -m "Remove Ulangi sesi from the Session Card - Break already covers another round"
```

---

## Manual verification (after all tasks)

Automated tests cover only `mergeSessionRecords` (Task 1) - everything else in this plan is DOM/screen orchestration, the same accepted-untestable-under-Node category as the rest of `src/ui/screens/`, per this repo's existing convention. Once all five tasks are committed, verify by hand in a browser (`npm run dev`):

1. Complete one Work block, choose **"Fokus lagi"** on Break - confirm a second Work block starts with no Ready screen shown again.
2. Complete the second cycle, choose **"Selesai untuk hari ini"** on Break - confirm exactly one Clarify screen (if there was uncertain time) and one Session Card appear, with numbers reflecting both cycles combined (not just the second one).
3. Confirm the Session Card has no "Ulangi sesi" button - only download and "Selesai."
4. Mid-cycle, press **"Selesai"** - confirm the timer visibly stops advancing and a confirm card appears in place of the nudge slot.
5. On that confirm card, press **"Lanjut fokus"** - confirm the timer resumes from the same value and the card disappears.
6. Press **"Selesai"** again, then **"Ya, selesai"** - confirm it skips Break entirely and goes straight to Clarify/Session Card.
7. Leave a Break screen untouched for 10+ minutes - confirm it auto-resolves as if "Selesai untuk hari ini" was pressed.
