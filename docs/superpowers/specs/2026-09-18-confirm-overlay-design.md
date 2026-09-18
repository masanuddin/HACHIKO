# Confirm Overlay Design

**Status:** approved by user ("yes, do the overlay for those confirms," confirming the scope proposed in chat), ready for implementation planning. Depends on `docs/superpowers/plans/2026-09-18-scrapbook-removal-bento-elevation.md` landing first (see "Sequencing" below) — this spec's code examples show the codebase's state *after* that plan lands (using `card(...)`, not `paperCard(...)`).

## Problem

Every confirmation dialog in the app today is an inline DOM swap: the triggering buttons (or a dedicated slot) get replaced in place with confirm text + Ya/Batal buttons, pushing surrounding content around rather than floating above it. The user flagged this directly: "why always put it expanded" instead of a proper overlay.

Investigation found this same inline pattern used for two genuinely different kinds of dialog, which matters for deciding what to convert:

1. **Confirming a decision the student/parent already initiated** — "Selesai" during Work, "Fokus lagi"/"Selesai untuk hari ini" after Break, deleting a session/all sessions/the profile. The student clicked something with real consequence; the confirm just double-checks before committing.
2. **An unprompted system offer** — the early-break nudge and the focus-extension nudge (`session.ts`'s `showEarlyBreakNudge`/`showExtensionNudge`). These are adaptive-pacing *offers*, not confirmations of anything the student asked for, and `.session__nudge`'s own CSS comment already states the existing, deliberate rule: "never a modal, never forced" — PRD-aligned anti-coercion design for a focus tool, not an oversight.

**Decision, confirmed with the user:** convert every dialog in category 1 to a real overlay (dimmed backdrop, centered floating dialog). Leave category 2 exactly as it is — inline, non-modal — since that split is a deliberate product decision this spec does not reopen.

## Sequencing

This spec's own component (Section 1) is independent of the scrapbook-removal plan, but two of its five call-site conversions (Section 3) touch `sessionCard.ts`'s `historyCard()`, which the scrapbook-removal plan's Task 2 also touches (swapping `paperCard(...)` for `card(...)`). To avoid two different implementers editing the same function in an unpredictable order, this plan's implementation must not start until `docs/superpowers/plans/2026-09-18-scrapbook-removal-bento-elevation.md` has fully landed (all its tasks complete, final review clean). The code samples below already assume that plan's changes are in place.

## 1. The `confirmOverlay()` component

New export in `src/ui/components.ts`, alongside the existing `card()`:

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

### CSS (`src/styles/base.css`)

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
  background: color-mix(in srgb, var(--ink) 55%, transparent);
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
`z-index: 10` clears both existing z-indexed elements (`.skip-link` at 1, `.mentor-panel` at 2) with headroom. `.overlay-dialog` reuses `.card`'s own background/shadow/border via `card(...)` — including the night-screen override and, once the scrapbook-removal plan lands, the deepened elevation shadow — no separate styling needed.

The reduced-motion media query already at the bottom of `base.css` (`@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.001ms !important; ... } }`) automatically covers both new keyframes; no separate rule needed.

## 2. Convert `session.ts`'s two confirms

**`showSelesaiConfirm()`** (Work phase): currently swaps `nudgeSlot`'s children. The `nudgeVisible` flag it sets is a gate the perception-loop tick handler checks before offering the early-break/extension nudges (`if (!nudgeVisible) { ... }`) — that gating must be preserved even though this confirm no longer uses `nudgeSlot`. Change:
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
`screenEl` is already in scope (destructured at the top of `runWorkPhase` from `screen({ night: true })`). The `card` import in this file's import line is no longer used by this function specifically, but IS still used elsewhere in the same file (`showEarlyBreakNudge`/`showExtensionNudge` still build their nudge cards with `card(...)` into `nudgeSlot`, unchanged) — do not remove the `card` import. Add `confirmOverlay` to the import line instead.

**`renderBreak()`'s `showContinueConfirm`/`showStopConfirm`**: currently swap a dedicated `slot` element between the main action row and a confirm card, via a `showMainActions()` toggle-back function. Since the overlay floats above the main actions instead of replacing them, `slot`/`showMainActions()` are no longer needed at all. Change:
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
`card` is no longer used anywhere in `renderBreak` after this change, but it IS still used by `runWorkPhase` in the same file (see above) — the file-level `card` import stays; only add `confirmOverlay` to it.

## 3. Convert the three destructive-action confirms

**`sessionCard.ts`'s `historyCard()`** (per-session delete): currently toggles the delete button itself between "Hapus" and an inline "Hapus sesi ini? / Ya / Batal" row via `showDelete()`/`showConfirm()`. With an overlay, the delete button never needs to change — clicking it just pops the overlay; canceling closes it, leaving the same button in place. This also removes the `showDelete()`/`showConfirm()` ping-pong entirely. `historyCard` needs the screen's root element threaded in as a new parameter (`screenEl`) to pass to `confirmOverlay`. Change:
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
The `index` parameter is unused by this function's body both before and after this change (it was already only consumed by the now-deleted `HISTORY_TILTS` lookup, removed by the scrapbook-removal plan) — leave it as-is; removing an unused parameter from a function whose call site (`historySection`'s `.map((r, i) => historyCard(r, i, onDelete))`) still naturally provides the index is out of scope for this plan and not worth a signature churn.

**`historySection()`** (delete-all): same conversion, plus threading `screenEl` through to `historyCard`. Change:
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

**`renderSessionCard()`'s call to `historySection`**: needs the new fourth argument. Change:
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
`screenEl` is already in scope in `renderSessionCard` (destructured from `screen()` at the top of the function). Add `confirmOverlay` to this file's import from `../components` (it already imports `card`, keep that).

**`main.ts`'s `renderEndScreen()`** (delete profile): same conversion, no threading needed since it's a single function. Change:
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
`main.ts` currently imports `card` from `./ui/components` for this function — after this change `card` is no longer used anywhere in `main.ts` (it has no other card usage), so remove `card` from that import line and add `confirmOverlay`.

## Global Constraints (same as every prior pass)

- No new npm dependencies.
- No red anywhere in the UI — the backdrop color is `color-mix(in srgb, var(--ink) 55%, transparent)`, composed only from the fixed palette.
- Session (night) screen: the overlay must render correctly there too (it's used by `showSelesaiConfirm`/`showContinueConfirm`/`showStopConfirm`, all night-screen call sites) — this is exactly why `confirmOverlay` mounts on `screenEl` rather than `document.body`, so `.screen--night .card`'s existing override still applies.
- `src/engine/` untouched.
- No copy/string changes — every string used above already exists in `strings.ts`.
- Plain DOM only.
- `showEarlyBreakNudge`/`showExtensionNudge` in `session.ts` are explicitly OUT of scope — do not convert them, do not touch `nudgeSlot`/`hideNudge()`'s existing behavior for those two nudges.

## Testing

No new pure-logic behavior (DOM structure + one new CSS-styled component), so no new unit tests. Definition of done, same as every prior pass:
- `npx tsc --noEmit` clean
- `npm test` — all 86 existing tests still pass unchanged
- Manual/structural verification only, same standing caveat as every prior pass in this session: no browser-automation tool exists in this project's dependency allowlist, so keyboard/focus/backdrop-click behavior and the visual result cannot be screenshotted by this session — flag for the user's own check, specifically: Escape and backdrop-click both cancel (never confirm) on every one of the 5 converted dialogs, and the night-screen dialogs (Selesai, Fokus lagi, Selesai untuk hari ini) render with the dark card palette, not the light one.

## Out of scope

- `showEarlyBreakNudge`/`showExtensionNudge` — staying inline, per the explicit non-coercion design rule.
- Any other inline-swap pattern in the app not identified above (field validation errors, the PDF download error note) — none of those are confirmations of a destructive/committing action, so none convert.
- Focus-trapping beyond "focus the dialog on open, restore focus on close" (i.e., Tab does not cycle-trap inside the dialog). A handful of confirm dialogs with 1-2 buttons each is a low enough stakes surface that a full focus trap isn't worth the added complexity; revisit only if a real accessibility issue is reported.
