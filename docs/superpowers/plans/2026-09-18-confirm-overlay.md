# Confirm Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert every confirmation of a student/parent-initiated decision (Selesai, Fokus lagi, Selesai untuk hari ini, delete session/all/profile) from an inline DOM swap into a real modal overlay (dimmed backdrop + centered card). Leave the early-break and extension nudges inline, unchanged, per the app's existing "never a modal, never forced" adaptive-pacing rule.

**Architecture:** One new DOM component (`confirmOverlay()`) plus CSS, then five call-site conversions across three files. No new files, no engine/perception/storage changes, no copy changes, no new dependencies.

**Tech Stack:** Plain TypeScript DOM, CSS custom properties, Vite, Vitest — unchanged.

**Spec:** `docs/superpowers/specs/2026-09-18-confirm-overlay-design.md`

## Global Constraints

- No new npm dependencies — allowed list is exactly `@mediapipe/tasks-vision`, `vite`, `typescript`, `vitest`.
- No red anywhere in the UI. The backdrop color and every other new value must be composed via `color-mix()` from the existing fixed palette — never a new hex.
- `src/engine/` untouched.
- No copy/string changes anywhere in this plan — every string used already exists in `strings.ts`.
- Plain DOM only.
- `showEarlyBreakNudge`/`showExtensionNudge` in `session.ts` are explicitly out of scope — do not touch them, or `nudgeSlot`/`hideNudge()`'s existing behavior for those two nudges.
- **Prerequisite:** `docs/superpowers/plans/2026-09-18-scrapbook-removal-bento-elevation.md` must be fully complete (all tasks done, final review clean) before this plan's Task 1 is dispatched — Task 3 here edits `sessionCard.ts`'s `historyCard()`, which that other plan's Task 2 also edits, and this plan's code samples assume that plan's `card(...)` (not `paperCard(...)`) is already in place.
- Definition of done for every task: `npx tsc --noEmit` passes, `npm test` passes (86 tests, unchanged — no new tests needed, this plan changes no pure logic), no new dependency in `package.json`, nothing outside the task's stated files changes.

---

### Task 1: Add `confirmOverlay()` component + CSS

**Files:**
- Modify: `src/ui/components.ts`
- Modify: `src/styles/base.css`

**Interfaces:**
- Produces: `confirmOverlay(mount: HTMLElement, children: (Node | string)[], onCancel: () => void): { close: () => void }`. `mount` is the screen's root `<main>` element (what every screen file calls `screenEl`, from `const { root: screenEl, content } = screen(...)`) — NOT `.screen__content`, and NOT `document.body`. Tasks 2 and 3 consume this exact signature.

- [ ] **Step 1: Add `confirmOverlay()` to `components.ts`**

Add this function after the existing `card()` function (do not modify `card()` itself):

```ts
/**
 * A modal confirm: a dimmed backdrop plus a centered card, appended to
 * the screen's own root element (the <main class="screen">, NOT
 * .screen__content) - same reasoning as session.ts's mentor panel:
 * appending here escapes .screen__content's entrance-animation
 * transform (which would otherwise become this element's `position:
 * fixed` containing block) while staying a descendant of
 * .screen--night when the caller is the night screen, so the night
 * card palette still applies via the existing `.screen--night .card`
 * rule. Reserved for confirming a decision the student/parent already
 * initiated - never for an unprompted system offer (see
 * showEarlyBreakNudge/showExtensionNudge in session.ts, which stay
 * inline on purpose).
 *
 * Backdrop click and Escape both call `onCancel` - dismissing a modal
 * must never be equivalent to confirming it. The caller is responsible
 * for calling the returned `close()` from both its own Cancel button
 * and its confirm button (and from `onCancel` too, if it doesn't
 * already delegate to the same cancel function that does).
 */
export function confirmOverlay(
  mount: HTMLElement,
  children: (Node | string)[],
  onCancel: () => void,
): { close: () => void } {
  const previouslyFocused = document.activeElement as HTMLElement | null
  const backdrop = el('div', { class: 'overlay-backdrop' })
  const dialog = card(...children)
  dialog.classList.add('overlay-dialog')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.tabIndex = -1
  backdrop.append(dialog)

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onCancel()
  }

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) onCancel()
  })
  document.addEventListener('keydown', onKeydown)

  mount.append(backdrop)
  dialog.focus()

  return {
    close: () => {
      backdrop.remove()
      document.removeEventListener('keydown', onKeydown)
      previouslyFocused?.focus()
    },
  }
}
```

- [ ] **Step 2: Add the overlay CSS to `base.css`**

Add this block anywhere after the `.card`/`.card__title` rules (a good spot is right after `.card__title`, before the "Bento tile colors" section from the prior plan):

```css
/* ---- Confirm overlay (modal) ----
   Reserved for confirming a decision the student/parent already
   initiated (Selesai, Fokus lagi, delete). Never used for an
   unprompted system offer - session__nudge's own "never a modal" rule
   above is untouched by this. */
.overlay-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  background: color-mix(in srgb, var(--ink) 45%, transparent);
  backdrop-filter: blur(6px);
  animation: overlay-in var(--duration-fast) var(--ease-standard);
}

@keyframes overlay-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.overlay-dialog {
  width: 100%;
  max-width: 400px;
  animation: overlay-dialog-in var(--duration-base) var(--ease-spring-soft);
}

@keyframes overlay-dialog-in {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
```
Do not add anything to the reduced-motion media query at the bottom of the file — its existing `*, *::before, *::after` selector already covers these two new `@keyframes` automatically.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm test
```
Expected: both succeed — all 86 existing tests still pass (this task adds no new tests; `confirmOverlay` isn't called from anywhere yet, so nothing exercises it until Task 2).

- [ ] **Step 4: Commit**

```bash
git add src/ui/components.ts src/styles/base.css
git commit -m "Add confirmOverlay() component and its CSS"
```

---

### Task 2: Convert `session.ts`'s two confirms to overlays

**Files:**
- Modify: `src/ui/screens/session.ts`

**Interfaces:**
- Consumes: `confirmOverlay(mount, children, onCancel)` from Task 1.

- [ ] **Step 1: Add `confirmOverlay` to the import line**

Change:
```ts
import { actions, body, button, cameraDot, card, el, screen, title } from '../components'
```
to:
```ts
import { actions, body, button, cameraDot, card, confirmOverlay, el, screen, title } from '../components'
```
`card` stays in this import — it's still used by `showEarlyBreakNudge`/`showExtensionNudge`, which this task does not touch.

- [ ] **Step 2: Convert `showSelesaiConfirm()`**

Change:
```ts
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
      // Stopping well short of the committed time gets a neutral mascot
      // reaction (not a sad one - see hachiko.ts's note on why "crying"
      // is never used) instead of the plain text-only confirm.
      const elapsedMs = totalMs - remainingMs
      const stoppingEarly = elapsedMs < totalMs * EARLY_STOP_RATIO
      const cardChildren: (Node | string)[] = []
      if (stoppingEarly) cardChildren.push(mascotPeek('drowsy'))
      cardChildren.push(el('h2', { class: 'card__title' }, [s.selesaiConfirmTitle]), actions(cancelBtn, confirmBtn))

      nudgeSlot.replaceChildren(card(...cardChildren))
    }
```
to:
```ts
    function showSelesaiConfirm(): void {
      pausedBeforeSelesaiConfirm = paused
      paused = true
      nudgeVisible = 'selesaiConfirm'

      function cancel(): void {
        paused = pausedBeforeSelesaiConfirm
        jedaBtn.textContent = paused ? strings.common.continueLabel : s.jeda
        nudgeVisible = null
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
            nudgeVisible = null
            overlay.close()
            finishNow(true)
          }),
        ),
      )

      const overlay = confirmOverlay(screenEl, dialogChildren, cancel)
    }
```
`screenEl` is already in scope — it's destructured at the top of `runWorkPhase` from `const { root: screenEl, content } = screen({ night: true })`.

- [ ] **Step 3: Convert `renderBreak()`'s confirms and remove the now-unused `slot`**

Change:
```ts
    // Both choices are one tap from a real commitment (another full cycle,
    // or ending the whole multi-cycle plan) - a misclick gets a confirm
    // card in place of the two buttons, not an immediate action.
    const slot = el('div')

    function showMainActions(): void {
      slot.replaceChildren(actions(continueBtn, stopBtn))
    }

    function showContinueConfirm(): void {
      slot.replaceChildren(
        card(
          el('h2', { class: 'card__title' }, [s.breakContinueConfirmTitle]),
          actions(
            button(s.breakConfirmCancel, showMainActions, { variant: 'secondary' }),
            button(s.breakContinueConfirmYes, () => choose(true)),
          ),
        ),
      )
    }

    function showStopConfirm(): void {
      slot.replaceChildren(
        card(
          el('h2', { class: 'card__title' }, [s.breakStopConfirmTitle]),
          actions(
            button(s.breakConfirmCancel, showMainActions, { variant: 'secondary' }),
            button(s.breakStopConfirmYes, () => choose(false)),
          ),
        ),
      )
    }

    const continueBtn = button(s.breakContinueLabel, showContinueConfirm)
    const stopBtn = button(s.breakStopLabel, showStopConfirm, { variant: 'secondary' })

    showMainActions()

    content.append(
      title(isLongBreak ? s.breakLongTitle : s.breakTitle),
      body(isLongBreak ? s.breakLongBody : s.breakBody),
      countdown,
      slot,
    )
```
to:
```ts
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
```
`card` is no longer used inside `renderBreak` after this change, but the file-level `card` import stays (still used by `runWorkPhase`, a different function in the same file).

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm test
```
Expected: both succeed — all 86 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/session.ts
git commit -m "Convert session.ts's Selesai and break confirms to the overlay"
```

---

### Task 3: Convert the three destructive-action confirms to overlays

**Files:**
- Modify: `src/ui/screens/sessionCard.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `confirmOverlay(mount, children, onCancel)` from Task 1.
- Changes: `historyCard(record, index, onDelete, screenEl)` and `historySection(currentId, onDelete, onDeleteAll, screenEl)` both gain a new final `screenEl: HTMLElement` parameter — both are private (unexported) functions local to `sessionCard.ts`, so this is not a public interface change.

- [ ] **Step 1: Add `confirmOverlay` to `sessionCard.ts`'s import line**

Change:
```ts
import { actions, body, button, card, doodleMark, el, screen, titleWithDoodle } from '../components'
```
to:
```ts
import { actions, body, button, card, confirmOverlay, doodleMark, el, screen, titleWithDoodle } from '../components'
```
(This assumes `docs/superpowers/plans/2026-09-18-scrapbook-removal-bento-elevation.md` has already landed, so this import already reads `card` instead of `paperCard` — if it doesn't match this exactly, STOP and report BLOCKED rather than guessing at a merge.)

- [ ] **Step 2: Convert `historyCard()`**

Change:
```ts
function historyCard(record: SessionRecord, index: number, onDelete: (id: string) => void): HTMLDivElement {
  const s = strings.sessionCard
  const controls = el('div', { class: 'history-card__actions' })

  function showDelete(): void {
    controls.replaceChildren(button(s.deleteSessionLabel, showConfirm, { variant: 'secondary' }))
  }

  function showConfirm(): void {
    controls.replaceChildren(
      el('span', { class: 'history-card__confirm' }, [s.deleteConfirmTitle]),
      button(s.deleteConfirmYes, () => onDelete(record.id), { variant: 'secondary' }),
      button(s.deleteConfirmCancel, showDelete, { variant: 'secondary' }),
    )
  }

  showDelete()

  return card(
    el('p', { class: 'history-card__time' }, [sessionTimeLabel(record.startedAt)]),
    metricGrid(computeMetrics(record)),
    controls,
  )
}
```
to:
```ts
function historyCard(
  record: SessionRecord,
  index: number,
  onDelete: (id: string) => void,
  screenEl: HTMLElement,
): HTMLDivElement {
  const s = strings.sessionCard

  function showConfirm(): void {
    const overlay = confirmOverlay(
      screenEl,
      [
        el('h2', { class: 'card__title' }, [s.deleteConfirmTitle]),
        actions(
          button(s.deleteConfirmCancel, () => overlay.close(), { variant: 'secondary' }),
          button(s.deleteConfirmYes, () => {
            overlay.close()
            onDelete(record.id)
          }),
        ),
      ],
      () => overlay.close(),
    )
  }

  const controls = el('div', { class: 'history-card__actions' }, [
    button(s.deleteSessionLabel, showConfirm, { variant: 'secondary' }),
  ])

  return card(
    el('p', { class: 'history-card__time' }, [sessionTimeLabel(record.startedAt)]),
    metricGrid(computeMetrics(record)),
    controls,
  )
}
```
Leave the `index` parameter exactly as-is (unused by this function both before and after this change — it's already only there because the call site's `.map((r, i) => ...)` naturally provides it; removing it is out of scope for this plan).

- [ ] **Step 3: Convert `historySection()`**

Change:
```ts
function historySection(currentId: string, onDelete: (id: string) => void, onDeleteAll: () => void): HTMLElement | null {
  const previous = listSessions()
    .filter((r) => r.id !== currentId)
    .sort((a, b) => b.startedAt - a.startedAt)
  if (previous.length === 0) return null

  const s = strings.sessionCard
  const cards = previous.map((r, i) => historyCard(r, i, onDelete))

  const allControls = el('div', { class: 'session-history__delete-all' })

  function showDeleteAll(): void {
    allControls.replaceChildren(button(s.deleteAllSessionsLabel, showDeleteAllConfirm, { variant: 'secondary' }))
  }

  function showDeleteAllConfirm(): void {
    allControls.replaceChildren(
      el('span', { class: 'history-card__confirm' }, [s.deleteAllConfirmTitle]),
      button(s.deleteAllConfirmYes, onDeleteAll, { variant: 'secondary' }),
      button(s.deleteConfirmCancel, showDeleteAll, { variant: 'secondary' }),
    )
  }

  showDeleteAll()

  return el('div', { class: 'session-history' }, [
    el('h2', { class: 'session-history__title' }, [s.historyTitle]),
    el('div', { class: 'session-history__list' }, cards),
    allControls,
  ])
}
```
to:
```ts
function historySection(
  currentId: string,
  onDelete: (id: string) => void,
  onDeleteAll: () => void,
  screenEl: HTMLElement,
): HTMLElement | null {
  const previous = listSessions()
    .filter((r) => r.id !== currentId)
    .sort((a, b) => b.startedAt - a.startedAt)
  if (previous.length === 0) return null

  const s = strings.sessionCard
  const cards = previous.map((r, i) => historyCard(r, i, onDelete, screenEl))

  function showDeleteAllConfirm(): void {
    const overlay = confirmOverlay(
      screenEl,
      [
        el('h2', { class: 'card__title' }, [s.deleteAllConfirmTitle]),
        actions(
          button(s.deleteConfirmCancel, () => overlay.close(), { variant: 'secondary' }),
          button(s.deleteAllConfirmYes, () => {
            overlay.close()
            onDeleteAll()
          }),
        ),
      ],
      () => overlay.close(),
    )
  }

  const allControls = el('div', { class: 'session-history__delete-all' }, [
    button(s.deleteAllSessionsLabel, showDeleteAllConfirm, { variant: 'secondary' }),
  ])

  return el('div', { class: 'session-history' }, [
    el('h2', { class: 'session-history__title' }, [s.historyTitle]),
    el('div', { class: 'session-history__list' }, cards),
    allControls,
  ])
}
```

- [ ] **Step 4: Update `renderSessionCard()`'s call to `historySection`**

Change:
```ts
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
```
to:
```ts
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
        screenEl,
      )
      historyWrap.replaceChildren(...(history ? [history] : []))
    }
```
`screenEl` is already in scope in `renderSessionCard` (destructured from `screen()` at the top of the function).

- [ ] **Step 5: Convert `main.ts`'s `renderEndScreen()`**

Change the import line from:
```ts
import { actions, body, button, card, el, screen, title } from './ui/components'
```
to:
```ts
import { actions, body, button, confirmOverlay, el, screen, title } from './ui/components'
```
(`card` has no other use in `main.ts` after this change — verify that before removing it; if something else in the file still uses `card`, keep it in the import and just add `confirmOverlay` alongside it instead of replacing it.)

Change:
```ts
function renderEndScreen(root: HTMLElement): void {
  const s = strings.endScreen
  const { root: screenEl, content } = screen()
  const slot = el('div')

  function showActions(): void {
    slot.replaceChildren(
      actions(
        button(s.reloadLabel, () => location.reload(), { variant: 'secondary' }),
        button(s.deleteProfileLabel, showConfirm, { variant: 'secondary' }),
      ),
    )
  }

  function showConfirm(): void {
    slot.replaceChildren(
      card(
        el('h2', { class: 'card__title' }, [s.deleteProfileConfirmTitle]),
        body(s.deleteProfileConfirmBody),
        actions(
          button(s.deleteProfileConfirmCancel, showActions, { variant: 'secondary' }),
          button(s.deleteProfileConfirmYes, () => {
            deleteProfile()
            deleteAllSessions()
            location.reload()
          }),
        ),
      ),
    )
  }

  showActions()

  content.append(title(s.doneTitle), body(s.doneMessage), slot)
  root.replaceChildren(screenEl)
}
```
to:
```ts
function renderEndScreen(root: HTMLElement): void {
  const s = strings.endScreen
  const { root: screenEl, content } = screen()

  const actionsRow = actions(
    button(s.reloadLabel, () => location.reload(), { variant: 'secondary' }),
    button(s.deleteProfileLabel, showConfirm, { variant: 'secondary' }),
  )

  function showConfirm(): void {
    const overlay = confirmOverlay(
      screenEl,
      [
        el('h2', { class: 'card__title' }, [s.deleteProfileConfirmTitle]),
        body(s.deleteProfileConfirmBody),
        actions(
          button(s.deleteProfileConfirmCancel, () => overlay.close(), { variant: 'secondary' }),
          button(s.deleteProfileConfirmYes, () => {
            deleteProfile()
            deleteAllSessions()
            location.reload()
          }),
        ),
      ],
      () => overlay.close(),
    )
  }

  content.append(title(s.doneTitle), body(s.doneMessage), actionsRow)
  root.replaceChildren(screenEl)
}
```

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit
npm test
```
Expected: both succeed — all 86 tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/ui/screens/sessionCard.ts src/main.ts
git commit -m "Convert delete-session/all/profile confirms to the overlay"
```

---

### Task 4: Final verification pass

**Files:** none modified — this task only verifies.

- [ ] **Step 1: Full automated check**

```bash
npx tsc --noEmit
npm test
grep -rn "history-card__confirm" src/
```
Expected: `tsc` zero errors, `npm test` 86/86 passing. The `grep` for `history-card__confirm` should find only the CSS class definition in `base.css` (if it's still used elsewhere for styling) or nothing at all if it's now fully dead — check which, and if it's dead CSS with zero remaining callers, note it in the report as a minor deferred cleanup rather than removing it in this verification-only task (removing dead CSS is not one of this plan's stated tasks).

- [ ] **Step 2: Confirm the five conversions all use the new component**

```bash
grep -rn "confirmOverlay(" src/
```
Expected: exactly 5 call sites — `session.ts` (2: `showSelesaiConfirm`, `showContinueConfirm`/`showStopConfirm` count as 2 separate calls even though both are in `renderBreak`, so this is really 3 calls in `session.ts` plus 2 more in `sessionCard.ts` (`historyCard`, `historySection`) plus 1 in `main.ts` — 6 total. Recount carefully against the actual grep output rather than assuming; report the exact count and where each one is.

- [ ] **Step 3: Confirm `showEarlyBreakNudge`/`showExtensionNudge` are untouched**

```bash
git diff dc6d0c73818c8e996e49d982b625f5dce82c532d..HEAD -- src/ui/screens/session.ts | grep -A2 -B2 "showEarlyBreakNudge\|showExtensionNudge"
```
(Replace the base SHA above with this plan's own actual starting commit if different — check the ledger.) Expected: no output, or only context lines showing these functions unchanged — confirming this plan never touched the two nudges that must stay inline.

- [ ] **Step 4: Record what still needs a human eye**

Report to the user: tsc/tests/grep all passed, confirming the right call sites use the new overlay component and the two adaptive-pacing nudges were never touched — but nobody has clicked through the actual dialogs to confirm Escape and backdrop-click both cancel (never confirm) on all 6 converted call sites, or that the night-screen dialogs (Selesai, Fokus lagi, Selesai untuk hari ini) render with the dark card palette rather than the light one. Recommend a full click-through: start a fast-debug session (`?debug` is the perception spike, not this — check `sessionConfig.ts`'s `isFastDebugMode()` trigger), trigger Selesai during Work, then a full Break cycle choosing both Fokus-lagi and Selesai-untuk-hari-ini on different runs, then on the Session Card delete a history entry and delete-all, then from the end screen delete the profile — watching for backdrop-click/Escape canceling correctly and the dialog looking right on both day and night screens.
