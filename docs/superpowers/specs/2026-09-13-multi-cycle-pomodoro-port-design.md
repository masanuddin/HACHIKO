# Multi-Cycle Pomodoro (Port from hachiko-desktop) — Design

Date: 2026-09-13
Status: Approved by user, pending implementation plan

## Summary

The app is currently single-cycle-per-report: one Work block, one Break,
one Clarify/Session Card, with "Ulangi sesi" on the card offering a fresh
cycle by re-invoking the whole flow from `main.ts`'s outer loop. This
spec replaces that with `hachiko-desktop`'s already-built, already-tested
multi-cycle loop: Work → Break → Work → Break → ..., where the *Break*
screen itself asks "another round, or done for today?" - no report shown
until the student is actually done. `Ulangi sesi` is removed; its job
moves to the Break screen.

Like the existing companion-gamification and dual-cadence-perception
ports, this is a transcription of already-built, already-reviewed logic
(`hachiko-desktop`'s own approved spec:
`docs/superpowers/specs/2026-08-31-multi-cycle-pomodoro-design.md`,
implemented across commits `17b23b6`..`53eeb65` in that repo) - adapted
only where this codebase genuinely differs. One net-new piece is added
that `hachiko-desktop` doesn't have: a confirm step on "Selesai".

## What ports unchanged

- **`mergeSessionRecords(id, records)`** in `src/storage/sessions.ts`:
  sums `durationsMs` per state, concatenates `distractionEvents` and
  `recoveryTimesMs` with each cycle's spans offset by the cumulative
  elapsed time of every prior cycle, takes the earliest non-null
  `firstCollapseAtMs` (offset the same way), takes `declaredMedia`/
  `startedAt` from the first cycle, and always returns `clarification:
  null` (the caller sets it once, after the loop). `SessionRecord`'s
  shape is identical in both repos, so this ports verbatim, including
  its existing test suite in `sessions.test.ts`.
- **The Break screen becomes a real decision, not a countdown-gated
  continue**: `renderBreak` returns `Promise<{ continueSession: boolean
  }>` via two buttons - "Fokus lagi" and "Selesai untuk hari ini" - both
  live immediately. The countdown keeps ticking for company but no
  longer auto-resolves anything at zero; it holds at `0:00` with both
  buttons still available.
- **A 10-minute Break-abandonment safety net**: `BREAK_ABANDON_MS` in
  `sessionConfig.ts`, a `setTimeout` on the Break screen that resolves
  `{ continueSession: false }` if neither button is ever pressed - a
  student who walks away and never comes back doesn't lose an
  already-completed cycle's data forever.
- **The `runSession` loop shape**:
  ```ts
  while (keepGoing) {
    const { record, telemetryJsonl, endedManually } = await runWorkPhase(...)
    records.push(record); telemetryParts.push(telemetryJsonl)
    if (endedManually) keepGoing = false
    else keepGoing = (await renderBreak(root)).continueSession
  }
  ```
  followed by one merge, one Clarify (if `merged.uncertainMs > 0`), one
  `saveSession`, one milestone check, one Session Card.
- **`runWorkPhase`'s own internals are completely untouched**: the focus
  engine, telemetry recording, adaptive early-break/extension nudges, and
  (this repo's own addition, absent from `hachiko-desktop`) mentor-mode
  overlay all keep working exactly as they do today, once per cycle.

## What's different in this codebase (the actual porting work)

1. **`persistRecording` and `bundle.camera.stop()` move to the end of
   `runSession`.** Today this repo calls both per-round, inside
   `runWorkPhase`'s `finishNow` (camera stop actually already happens in
   `main.ts`, after its own repeat loop - see point 3). The port calls
   `persistRecording` exactly once, with the merged id and every cycle's
   `telemetryJsonl` joined by `'\n'` (empty parts filtered first, so a
   cycle ended via Selesai before any frame was recorded doesn't leave a
   blank line). `bundle.camera.stop()` moves into `runSession` itself,
   called once after the loop - `main.ts` no longer owns it at all.
2. **"Selesai" (in `runWorkPhase`) gains a confirm step - net-new,
   not in `hachiko-desktop`.** Because "Selesai" now ends the *entire*
   multi-cycle plan (not just one cycle out of a sitting the student
   might still want more of), an accidental tap is costlier than before.
   Pressing it pauses the timer (reusing the existing `paused` flag) and
   swaps `nudgeSlot` for an inline confirm card (the same card+actions
   pattern already used for pacing nudges and today's repeat-confirm):
   "Ya, selesai" → resolves `endedManually: true` immediately, skipping
   the Break screen entirely and going straight to merge → Clarify →
   Session Card; "Lanjut fokus" → dismisses the card and unpauses. This
   also resolves the divergence between this repo (commit `08ee8c3`
   made Break always show, even after manual Selesai - a workaround for
   a "cannot proceed" bug) and `hachiko-desktop` (skips Break on manual
   end, with no such bug because its camera-lifecycle fix addresses the
   underlying cause): the confirm step means an ended-manually plan
   always skips Break now, matching `hachiko-desktop`'s tested behavior.
3. **`main.ts` loses its outer repeat loop.** Today:
   ```ts
   let repeat = true
   while (repeat) { repeat = await runSession(...) }
   bundle.camera.stop()
   ```
   becomes a single `await runSession(root, video, bundle, cone,
   declaredMedia, workMs)`, then straight to `renderEndScreen(root)` -
   `runSession`'s return type changes from `Promise<boolean>` to
   `Promise<void>`, since there's no repeat decision left to bubble up.
4. **`sessionCard.ts` loses its repeat affordance.** `repeatBtn`, the
   repeat-confirm card (`repeatConfirmTitle`/`repeatConfirmStart`/
   `repeatConfirmCancel`), and the `Promise<'repeat' | 'done'>` return
   type are removed - there's nothing left to repeat into, since Break
   already asked. `renderSessionCard` returns `Promise<void>`. The PDF
   download, session history list, and delete-session/delete-all
   controls are untouched: all operate on a plain `SessionRecord`, which
   the merged record still is.
5. **`workMs` still comes from the Ready screen, per-sitting, not
   per-cycle.** Both repos already agree on this (`hachiko-desktop`'s
   non-goals explicitly exclude a fixed upfront cycle count or dynamic
   duration) - `runWorkPhase` keeps taking `workMs` and reusing it for
   every cycle in the loop, exactly as `hachiko-desktop` does.
6. **Break copy**: adopt `hachiko-desktop`'s `breakBody` ("Regangkan
   badan sebentar. Kalau siap, kamu yang tentuin lanjut atau selesai.")
   over this repo's current text (which describes the old auto-advance
   behavior now removed), and add `breakContinueLabel`/`breakStopLabel`.
   New strings for the Selesai confirm card (not present in
   `hachiko-desktop`, since that repo has no such step): working copy
   `selesaiConfirmTitle: 'Selesai untuk hari ini?'`,
   `selesaiConfirmYes: 'Ya, selesai'`, `selesaiConfirmNo: 'Lanjut fokus'`
   - final wording can be adjusted during implementation.

## New/changed files

| File | Change |
|---|---|
| `src/storage/sessions.ts` | New: `mergeSessionRecords(id, records)` |
| `src/storage/sessions.test.ts` | New: `mergeSessionRecords` test suite (ported from `hachiko-desktop`, including the cumulative-offset-across-three-records case) |
| `src/ui/sessionConfig.ts` | New: `BREAK_ABANDON_MS` |
| `src/ui/screens/session.ts` | `renderBreak` returns `{ continueSession }` via two buttons + abandonment timeout; `runWorkPhase`'s `finishNow`/Selesai path gains the pause+confirm step, no longer calls `persistRecording`; `runSession` becomes the merge/loop orchestrator described above, returns `Promise<void>` |
| `src/ui/screens/sessionCard.ts` | Repeat button/confirm card removed; `renderSessionCard` returns `Promise<void>` |
| `src/main.ts` | Outer `while (repeat)` loop removed; single `await runSession(...)` call; `bundle.camera.stop()` removed (now inside `runSession`) |
| `src/ui/strings.ts` | `breakContinueLabel`, `breakStopLabel`, updated `breakBody`, new Selesai-confirm strings; `repeatLabel`/`repeatConfirm*` removed |

## Testing

`mergeSessionRecords` is pure and testable under Node, same category as
`storage/companion.ts`. Port `hachiko-desktop`'s existing test suite
directly. No automated test for the Break screen's two-button behavior,
the Selesai confirm step, or the `runSession` loop itself - all
DOM/screen-orchestration code, the same accepted-untestable-under-Node
category as the rest of `src/ui/screens/`.

Manual verification: complete one Work block, choose "Fokus lagi" on
Break, confirm a second Work block starts with no Ready screen shown
again; complete it, choose "Selesai untuk hari ini" on Break - confirm
exactly one Clarify (if applicable) and one Session Card appear, with
numbers reflecting both cycles combined. Separately: mid-cycle, press
"Selesai", confirm the timer visibly pauses and a confirm card appears;
"Lanjut fokus" resumes the same timer value; "Ya, selesai" skips Break
entirely and goes straight to Clarify/Session Card. Leave a Break screen
untouched for 10+ minutes, confirm it auto-resolves to "stop."

## Out of scope (explicit)

Dynamic/adaptive cycle duration (`hachiko-desktop`'s own
`2026-08-31-dynamic-pomodoro-future-ideas.md`, not ported), any fixed
upfront cycle count, any per-cycle counter/indicator shown during a Work
block, any change to Media, Calibration, the focus engine, or the PDF
report builder. The broader "reduce onboarding step count" concern
raised alongside this feature is a separate brainstorm, not addressed
here.
