# Scrapbook Removal / Bento + Elevation Design

**Status:** approved by user (design summary + one clarifying question, both confirmed), ready for implementation planning.

## Problem

Immediately after the scrapbook polish pass shipped, the user asked to remove the scrapbook visual language entirely and replace it with a flatter, more saturated bento aesthetic driven by real shadow-based depth instead of paper/tilt/tape decoration: "remove the scrapbook ideas, just use bento grid with clear color and deep elevation vice versa." Confirmed in chat: keep the small hand-drawn doodle marks (they're independent SVG accents, not part of the paper/tilt/tape mechanics); remove everything else — tilt, torn-paper edges, washi tape, and the background paper-grain texture.

## What "vice versa" means here, concretely

The scrapbook system used **texture and rotation** as its primary depth/personality cue (tilt, torn edges, tape, grain) on top of a very faint, barely-there elevation shadow (`--shadow-card`'s two layers were 6%/8% ink opacity) and light color washes (8–10% tint mixes). The new direction inverts which half of that pairing carries the visual weight: **no texture or rotation at all** (clean rectangles, straight edges, flat background), with depth instead carried by a **genuinely deep, pronounced elevation shadow**, and color carried by **clearly saturated tile tints** instead of a faint wash.

## Global Constraints (same as every prior pass on this app)

- No new npm dependencies (allowed list: `@mediapipe/tasks-vision`, `vite`, `typescript`, `vitest`).
- No red anywhere in the UI. Every new/changed color value must be composed via `color-mix()` from the existing fixed palette (`--cream`, `--sand`, `--amber`, `--amber-deep`, `--ink`, `--ink-muted`, `--sage`, `--night`) — never a new hex.
- Session (night) screen is untouched by this pass, same as every prior visual pass — none of the classes/tokens below (`.card--paper`, `.bento-tile`, tilt/torn/tape/grain) were ever used by `session.ts`, so removing them cannot affect it. Verify this stays true.
- `src/engine/` untouched.
- No `gagal`/`malas`/`salah` in any string (this pass touches no copy at all, only CSS/DOM structure).
- Plain DOM, CSS custom properties only, one fixed palette.
- Doodle marks (`doodleMark()`, `titleWithDoodle()`, `DOODLE_MARK_SVG`, `.doodle-mark`/`.doodle-mark svg` CSS, and every screen's mark assignment) are explicitly OUT of scope for removal — confirmed by the user. Do not touch them.

## 1. Remove the scrapbook tokens

In `src/styles/tokens.css`, delete the entire "Scrapbook / bento texture" block (the tilt tokens, `--paper-sage`/`--paper-amber`, `--tape-color`/`--tape-border`, both `--torn-edge-*`, and `--paper-grain`), replacing it with a much smaller "Bento tile colors" block that keeps only two renamed, strengthened tint tokens:

```css
  /* ---- Bento tile colors (daylight screens only) ----
     Clear, saturated tile tints instead of a faint wash - composed only
     from the fixed palette above, never a new hue. Never applied to the
     Session (night) screen: .screen--night's own background/.card rules
     take precedence there. */
  --tile-amber: color-mix(in srgb, var(--amber) 28%, var(--cream));
  --tile-sage: color-mix(in srgb, var(--sage) 22%, var(--cream));
```

(28%/22% rather than matching percentages because amber reads more saturated than sage at the same mix ratio — the target is that both tints read equally "clear" next to each other, not that the numbers match. Fine to hand-tune during implementation self-review if the two don't look balanced.)

## 2. Deepen the elevation shadow

In the same file's existing "Elevation" block, change `--shadow-card`'s value from the current faint two-layer shadow to a pronounced one — same ink-tinted convention (never pure black), just much stronger blur/offset/opacity:

```css
  --shadow-card: 0 4px 8px color-mix(in srgb, var(--ink) 12%, transparent),
    0 20px 48px color-mix(in srgb, var(--ink) 20%, transparent);
```

This one token is read by both `.card` and `.bento-tile` already, so this single change deepens elevation everywhere without touching either rule. `--shadow-card-night` (the session screen's separate token) and `--shadow-button` are untouched.

## 3. Remove the scrapbook CSS rules from `base.css`

Delete entirely:
- The "Scrapbook / bento treatment" comment block and the `.card--paper, .bento-tile { clip-path: ... }` rule, `.card--paper::before { display: none; }`, `.torn-b`, and all five `.tilt-a`..`.tilt-e` rules.
- `.paper-tape::after` and the two padding-top companion rules added in the last pass (`.paper-tape { padding-top: ... }`, `.bento-tile.paper-tape { padding-top: ... }`), plus their comments.
- `.bento-tile--plain { clip-path: none; }` — this class existed only to opt the Ready screen's camera tile OUT of the torn-edge clip-path; once no `.bento-tile` has a clip-path by default, the opt-out class has nothing to do. Remove the class from `ready.ts`'s camera tile too (Section 6 below).

Update:
- `.screen`'s `background` (the rule combining a radial amber glow, the paper-grain texture, and `--cream`): remove the `var(--paper-grain),` layer, leaving just the glow gradient and `var(--cream)`. Update the comment above it that explains why `--paper-grain` never reaches the Session screen — that reasoning no longer applies since the token is gone.
- `.bento-tile--amber-tint`/`.bento-tile--sage-tint`: change `background: var(--paper-amber)`/`var(--paper-sage)` to `background: var(--tile-amber)`/`var(--tile-sage)`.

**Expected, intentional side effect:** `.card`'s existing straight amber-gradient top bar (`.card::before`, already defined, previously suppressed only for scrapbook cards via `.card--paper::before { display: none; }`) will now render on every card that used to be a `paperCard` — Welcome's intro card, Consent's two cards, Clarify's options card, and every Session Card history card. This is wanted, not a bug to "fix": it's a clear, consistent color accent that fits the new direction, and removing the suppression rule is exactly what un-hides it. No code change is needed to make this happen beyond deleting `.card--paper::before` — do not add anything extra to compensate.

## 4. Remove `paperCard()` from `components.ts`

Delete the `paperCard()` function (and its doc comment) entirely. Nothing else in this file changes — `card()`, `doodleMark()`, `titleWithDoodle()`, `stepper()`, `disclosure()`, `checkboxItem()`, etc. are all untouched.

`card()`'s existing signature already covers every remaining need: `card(...children: (Node | string)[]): HTMLDivElement`.

## 5. Update every `paperCard(...)` call site to plain `card(...)`

`paperCard(children, opts)` took an **array** plus an options object; `card(...children)` takes **rest parameters** with no options. Every call site below drops its `tilt`/`torn`/`tape` options (since those mechanics no longer exist) and switches from an array argument to spread arguments.

**`src/ui/screens/welcome.ts`** — import line: replace `paperCard` with `card` (keep alphabetical order: `actions, body, button, card, el, field, screen, textInput, titleWithDoodle`). Change:
```ts
      paperCard([body(s.body), el('p', { class: 'screen__body' }, [s.browserNote])], { tilt: 'a', tape: true }),
```
to:
```ts
      card(body(s.body), el('p', { class: 'screen__body' }, [s.browserNote])),
```

**`src/ui/screens/consent.ts`** — import line: replace `paperCard` with `card`. Change:
```ts
      paperCard([el('h2', { class: 'card__title' }, [s.cameraExplainerTitle]), body(s.cameraExplainer)], {
        tilt: 'b',
        tape: true,
      }),
      paperCard([permission.element, camera.element, noReport.element], { tilt: 'e', torn: 'b' }),
```
to:
```ts
      card(el('h2', { class: 'card__title' }, [s.cameraExplainerTitle]), body(s.cameraExplainer)),
      card(permission.element, camera.element, noReport.element),
```

**`src/ui/screens/clarify.ts`** — import line: replace `paperCard` with `card`. Change:
```ts
      paperCard(
        [
          actions(
            button(s.optionBook, () => choose('book')),
            button(s.optionPhone, () => choose('phone')),
            button(s.optionMixed, () => choose('mixed')),
          ),
        ],
        { tilt: 'c', tape: true },
      ),
```
to:
```ts
      card(
        actions(
          button(s.optionBook, () => choose('book')),
          button(s.optionPhone, () => choose('phone')),
          button(s.optionMixed, () => choose('mixed')),
        ),
      ),
```

**`src/ui/screens/sessionCard.ts`** — import line: replace `paperCard` with `card` (alphabetical: `actions, body, button, card, doodleMark, el, screen, titleWithDoodle`).

`bentoTile()`'s local helper drops its now-meaningless `opts` parameter entirely:
```ts
function bentoTile(
  modifier: string,
  tint: 'sand' | 'amber-tint' | 'sage-tint' | null,
  children: (Node | string)[],
  opts: { torn?: 'b'; tape?: boolean } = {},
): HTMLDivElement {
  const classes = ['bento-tile', `bento-tile--${modifier}`]
  if (tint) classes.push(`bento-tile--${tint}`)
  if (opts.torn === 'b') classes.push('torn-b')
  if (opts.tape) classes.push('paper-tape')
  return el('div', { class: classes.join(' ') }, children)
}
```
becomes:
```ts
function bentoTile(
  modifier: string,
  tint: 'sand' | 'amber-tint' | 'sage-tint' | null,
  children: (Node | string)[],
): HTMLDivElement {
  const classes = ['bento-tile', `bento-tile--${modifier}`]
  if (tint) classes.push(`bento-tile--${tint}`)
  return el('div', { class: classes.join(' ') }, children)
}
```

`bentoMetrics()`'s five calls that passed a 4th `opts` argument drop it (the sixth call, `observation`, already passes only 3 args and needs no change):
```ts
    bentoTile('mascot', 'sand', [mascotPeek()], { tape: true }),
    bentoTile('focus', 'amber-tint', tileMetric(s.focusMinutesLabel, formatFocusLine(m.focusMs, m.sittingMs), true), { tape: true }),
    bentoTile('duduk', null, tileMetric(s.sittingMinutesLabel, formatDuration(m.sittingMs))),
    bentoTile('away', 'sage-tint', tileMetric(s.awayLabel, formatDuration(m.awayMs)), { torn: 'b' }),
    bentoTile('uncertain', null, tileMetric(s.uncertainLabel, formatDuration(m.uncertainMs)), { torn: 'b' }),
```
becomes:
```ts
    bentoTile('mascot', 'sand', [mascotPeek()]),
    bentoTile('focus', 'amber-tint', tileMetric(s.focusMinutesLabel, formatFocusLine(m.focusMs, m.sittingMs), true)),
    bentoTile('duduk', null, tileMetric(s.sittingMinutesLabel, formatDuration(m.sittingMs))),
    bentoTile('away', 'sage-tint', tileMetric(s.awayLabel, formatDuration(m.awayMs))),
    bentoTile('uncertain', null, tileMetric(s.uncertainLabel, formatDuration(m.uncertainMs))),
```

`historyCard()` drops the now-dead `HISTORY_TILTS` constant and its comment entirely, and its own doc comment's "Lighter paper treatment than the current-session bento tiles (tilt + torn edge, no tape)" sentence is rewritten to reflect the new reality (a plain card, same as every other card in the app — nothing "lighter" about it anymore). Change:
```ts
// Deterministic, alternating tilt/torn-edge per history card - same
// "fixed set of values, no Math.random()" rule as the confetti pattern.
const HISTORY_TILTS = ['c', 'b', 'e', 'a', 'd'] as const

/**
 * One read-only history card with an inline-confirmed delete control.
 * The delete button swaps in place to a "Hapus sesi ini?" confirm; the
 * current session (excluded from history) can never be deleted here.
 * Lighter paper treatment than the current-session bento tiles (tilt +
 * torn edge, no tape) since this can be a long scrolling list.
 */
function historyCard(record: SessionRecord, index: number, onDelete: (id: string) => void): HTMLDivElement {
```
to:
```ts
/**
 * One read-only history card with an inline-confirmed delete control.
 * The delete button swaps in place to a "Hapus sesi ini?" confirm; the
 * current session (excluded from history) can never be deleted here.
 */
function historyCard(record: SessionRecord, index: number, onDelete: (id: string) => void): HTMLDivElement {
```
and change:
```ts
  const tilt = HISTORY_TILTS[index % HISTORY_TILTS.length] ?? 'a'

  return paperCard(
    [
      el('p', { class: 'history-card__time' }, [sessionTimeLabel(record.startedAt)]),
      metricGrid(computeMetrics(record)),
      controls,
    ],
    index % 2 === 1 ? { tilt, torn: 'b' } : { tilt },
  )
```
to:
```ts
  return card(
    el('p', { class: 'history-card__time' }, [sessionTimeLabel(record.startedAt)]),
    metricGrid(computeMetrics(record)),
    controls,
  )
```

## 6. Drop `.bento-tile--plain` from Ready's camera tile

In `src/ui/screens/ready.ts`, change:
```ts
    const cameraTile = el('div', { class: 'bento-tile bento-tile--plain ready-grid__camera' }, [status, preview, dot])
```
to:
```ts
    const cameraTile = el('div', { class: 'bento-tile ready-grid__camera' }, [status, preview, dot])
```

The nearby "Ready screen merge" comment block mentions "The camera tile gets `.bento-tile--plain` (no torn edge/tilt — it's a live functional preview, not decoration)" — since no `.bento-tile` has a clip-path or tilt to opt out of anymore, delete just that clause from the comment (the rest of that comment block, including an already-stale "FIXED height" phrase that predates this plan, is out of scope — leave it alone).

## Testing

No new pure-logic behavior (CSS/DOM structure only), so no new unit tests. Definition of done, same as every prior pass:
- `npx tsc --noEmit` clean
- `npm test` — all 86 existing tests still pass unchanged (none of them assert on CSS classes or the removed tokens/functions)
- Grep confirms zero remaining references anywhere in `src/`/`index.html` to: `paperCard`, `card--paper`, `tilt-a` through `tilt-e` (as CSS classes — the `tilt` local variable name inside `historyCard` is gone too, so this should be a clean zero), `torn-edge`, `torn-b`, `paper-tape`, `paper-grain`, `paper-amber`, `paper-sage`, `bento-tile--plain`, `HISTORY_TILTS`
- Manual browser check: same standing caveat as the last pass — no browser-automation tool exists in this project's dependency allowlist, so this session cannot screenshot the result. Confirm structurally (tsc, tests, grep, dev-server serving the new CSS/JS) and flag for the user's own visual check, same as before.

## Out of scope

- Doodle marks — explicitly staying, per the user's confirmed answer.
- Any copy/string changes — none needed, this is a pure visual-system change.
- The pre-existing stale "FIXED height" phrase in `ready.ts`'s nearby comment (predates this plan, unrelated to scrapbook removal).
- Re-tuning `--tile-amber`/`--tile-sage`'s exact percentages beyond what's specified above, or the exact shadow values beyond what's specified — both are given as concrete literal values to implement, not further open design questions.
