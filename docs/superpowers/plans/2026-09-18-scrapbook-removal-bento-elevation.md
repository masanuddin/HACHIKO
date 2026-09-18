# Scrapbook Removal / Bento + Elevation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the scrapbook visual language (tilt, torn-paper edges, washi tape, background paper-grain texture) entirely, replacing it with a flatter bento aesthetic driven by clearly saturated tile colors and a pronounced elevation shadow. Doodle marks stay untouched.

**Architecture:** Pure CSS + DOM-structure changes across two layers: the CSS token/rule layer (`tokens.css`, `base.css`) and the TypeScript component/call-site layer (`components.ts` and five screen files). No new files, no engine/perception/storage changes, no copy changes, no new dependencies.

**Tech Stack:** Plain TypeScript DOM, CSS custom properties, Vite, Vitest — unchanged.

**Spec:** `docs/superpowers/specs/2026-09-18-scrapbook-removal-bento-elevation-design.md`

## Global Constraints

- No new npm dependencies — allowed list is exactly `@mediapipe/tasks-vision`, `vite`, `typescript`, `vitest`.
- No red anywhere in the UI. Every changed color value must be composed via `color-mix()` from the existing fixed palette (`--cream`, `--sand`, `--amber`, `--amber-deep`, `--ink`, `--ink-muted`, `--sage`, `--night`) — never a new hex.
- Session (night) screen is untouched — verify none of the removed classes/tokens were ever referenced by `session.ts` or its night-screen CSS rules.
- `src/engine/` untouched.
- Doodle marks (`doodleMark()`, `titleWithDoodle()`, `DOODLE_MARK_SVG`, `.doodle-mark` CSS, every screen's mark assignment) are explicitly out of scope — do not touch them.
- No copy/string changes anywhere in this plan.
- Definition of done for every task: `npx tsc --noEmit` passes, `npm test` passes (86 tests, unchanged — no new tests needed, this plan changes no pure logic), no new dependency in `package.json`, nothing outside the task's stated files changes.

---

### Task 1: Remove scrapbook tokens/rules from CSS, deepen elevation

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/base.css`

**Interfaces:** None — pure CSS custom-property and rule changes. `--shadow-card` and `--tile-amber`/`--tile-sage` (new names, replacing `--paper-amber`/`--paper-sage`) are consumed by `base.css` rules in this same task, not by any TypeScript.

- [ ] **Step 1: Replace the "Scrapbook / bento texture" token block**

In `src/styles/tokens.css`, find this block:
```css
  /* ---- Scrapbook / bento texture (daylight screens only) ----
     Fixed, deterministic values - same "no Math.random(), no JS loop"
     rule as the confetti pattern below. Never applied to the Session
     (night) screen: base.css's .screen--night rule fully replaces
     `background`, so --paper-grain never shows there, and none of the
     .card--paper/.bento-tile rules are used by session.ts. */
  --tilt-a: -2.4deg;
  --tilt-b: 2deg;
  --tilt-c: -1.6deg;
  --tilt-d: 2.6deg;
  --tilt-e: -0.8deg;

  /* Paper tints - other tiles in a bento grid, mixed only from the
     locked palette above, never a new hue. */
  --paper-sage: color-mix(in srgb, var(--sage) 10%, var(--cream));
  --paper-amber: color-mix(in srgb, var(--amber) 8%, var(--cream));

  --tape-color: color-mix(in srgb, var(--amber) 55%, transparent);
  --tape-border: color-mix(in srgb, var(--amber-deep) 40%, transparent);

  /* Two slightly different jagged top edges so torn-paper cards don't
     all read as one repeated stamp. */
  --torn-edge-a: polygon(0% 3%, 4% 0%, 9% 2%, 15% 0%, 22% 2%, 30% 0%, 38% 2%, 46% 0%, 55% 2%, 63% 0%, 71% 2%, 80% 0%, 88% 2%, 94% 0%, 100% 3%, 100% 100%, 0% 100%);
  --torn-edge-b: polygon(0% 2%, 6% 0%, 12% 3%, 19% 0%, 27% 2%, 35% 0%, 43% 3%, 51% 0%, 60% 2%, 68% 0%, 76% 3%, 84% 0%, 92% 2%, 100% 0%, 100% 100%, 0% 100%);

  /* Generated paper-grain noise (inline SVG feTurbulence), not an image
     asset - low-alpha ink speckle mixed at draw time, never stored or
     fetched. Applied only in base.css's .screen rule (not .screen--night). */
  --paper-grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.169 0 0 0 0 0.149 0 0 0 0 0.133 0 0 0 0.1 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
```
Replace it with:
```css
  /* ---- Bento tile colors (daylight screens only) ----
     Clear, saturated tile tints instead of a faint wash - composed only
     from the fixed palette above, never a new hue. Never applied to the
     Session (night) screen: .screen--night's own background/.card rules
     take precedence there. */
  --tile-amber: color-mix(in srgb, var(--amber) 28%, var(--cream));
  --tile-sage: color-mix(in srgb, var(--sage) 22%, var(--cream));
```

- [ ] **Step 2: Deepen `--shadow-card`**

In the same file's "Elevation" block, find:
```css
  --shadow-card: 0 1px 2px color-mix(in srgb, var(--ink) 6%, transparent),
    0 8px 24px color-mix(in srgb, var(--ink) 8%, transparent);
```
Replace with:
```css
  --shadow-card: 0 4px 8px color-mix(in srgb, var(--ink) 12%, transparent),
    0 20px 48px color-mix(in srgb, var(--ink) 20%, transparent);
```
Do not change `--shadow-card-night` or `--shadow-button`, which appear immediately around it.

- [ ] **Step 3: Remove the scrapbook rules from `base.css`**

Find and delete this entire block:
```css
/* ---- Scrapbook / bento treatment (daylight screens only) ----
   Purely additive modifier classes - .card and .screen's base rules
   above are untouched, so session.ts's night-screen cards (confirm
   dialogs, nudges) render exactly as before. Rotation is a fixed set
   of tokens, never Math.random(), same rule as the confetti pattern
   further down this file. */
.card--paper,
.bento-tile {
  position: relative;
  clip-path: var(--torn-edge-a);
}

.card--paper::before {
  /* Replaces .card's straight amber top bar - a torn top edge reads
     oddly with a clean straight accent line sitting on top of it. */
  display: none;
}

.torn-b {
  clip-path: var(--torn-edge-b);
}

.tilt-a { transform: rotate(var(--tilt-a)); }
.tilt-b { transform: rotate(var(--tilt-b)); }
.tilt-c { transform: rotate(var(--tilt-c)); }
.tilt-d { transform: rotate(var(--tilt-d)); }
.tilt-e { transform: rotate(var(--tilt-e)); }

/* A washi-tape strip pinning a card/tile in place. Positioned inside
   the box (not above it) so .card's `overflow: hidden` and the torn
   clip-path above never crop it. */
.paper-tape::after {
  content: '';
  position: absolute;
  top: 10px;
  left: 50%;
  width: 52px;
  height: 20px;
  background: var(--tape-color);
  border: 1px solid var(--tape-border);
  box-shadow: 0 2px 3px color-mix(in srgb, var(--ink) 25%, transparent);
  transform: translateX(-50%) rotate(-4deg);
  opacity: 0.85;
  pointer-events: none;
}

/* Give tape'd cards enough top clearance that the tape (and its shadow)
   sits above the content instead of painting over it - the tape spans
   roughly y=10px to y=35px, which overlaps a card's own padding-driven
   content start (24px for .card, 20px for .bento-tile). */
.paper-tape {
  padding-top: calc(var(--space-6) + var(--space-3));
}

.bento-tile.paper-tape {
  padding-top: calc(var(--space-5) + var(--space-3));
}
```
Leave the `.doodle-mark`/`.doodle-mark svg`/`.title-row` rules immediately after it completely untouched (doodle marks are out of scope for this plan).

- [ ] **Step 4: Update the `.screen` background**

Find:
```css
.screen {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* .screen--night below fully replaces this `background` shorthand
     (higher specificity), so --paper-grain never reaches the Session
     view - it stays exactly as before. */
  background:
    radial-gradient(ellipse 900px 500px at 50% -10%, var(--glow-amber-soft), transparent 60%),
    var(--paper-grain),
    var(--cream);
  padding: var(--space-8) var(--space-4);
}
```
Replace with:
```css
.screen {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  background:
    radial-gradient(ellipse 900px 500px at 50% -10%, var(--glow-amber-soft), transparent 60%),
    var(--cream);
  padding: var(--space-8) var(--space-4);
}
```

- [ ] **Step 5: Rename the tint variable references**

Find:
```css
.bento-tile--sand { background: var(--sand); border-color: transparent; }
.bento-tile--amber-tint { background: var(--paper-amber); border-color: transparent; }
.bento-tile--sage-tint { background: var(--paper-sage); border-color: transparent; }
```
Replace with:
```css
.bento-tile--sand { background: var(--sand); border-color: transparent; }
.bento-tile--amber-tint { background: var(--tile-amber); border-color: transparent; }
.bento-tile--sage-tint { background: var(--tile-sage); border-color: transparent; }
```

- [ ] **Step 6: Remove `.bento-tile--plain`**

Find and delete:
```css
.bento-tile--plain {
  clip-path: none;
}
```
In the nearby "Ready screen merge" comment block, find the sentence "The camera tile gets `.bento-tile--plain` (no torn edge/tilt - it's a live functional preview, not decoration) and a FIXED height, never aspect-ratio derived from its spanned rows" and shorten it to "The camera tile gets a FIXED height, never aspect-ratio derived from its spanned rows" — removing only the now-meaningless `.bento-tile--plain` clause, leaving the rest of that comment (including the pre-existing "FIXED height" phrasing, which is unrelated to this plan) exactly as-is.

- [ ] **Step 7: Verify**

```bash
npx tsc --noEmit
npm test
```
Expected: both succeed unchanged (CSS-only task, no TypeScript touched — this just confirms nothing broke).

- [ ] **Step 8: Commit**

```bash
git add src/styles/tokens.css src/styles/base.css
git commit -m "Remove scrapbook tilt/torn-edge/tape/grain CSS, deepen elevation and tile colors"
```

---

### Task 2: Remove `paperCard()` and update every call site

**Files:**
- Modify: `src/ui/components.ts`
- Modify: `src/ui/screens/welcome.ts`
- Modify: `src/ui/screens/consent.ts`
- Modify: `src/ui/screens/clarify.ts`
- Modify: `src/ui/screens/sessionCard.ts`
- Modify: `src/ui/screens/ready.ts`

**Interfaces:**
- Consumes: `card(...children: (Node | string)[]): HTMLDivElement`, already defined in `components.ts` and unchanged by this task.
- Removes: `paperCard(children: (Node | string)[], opts): HTMLDivElement` — after this task, nothing in the codebase may reference it. This task must land as one unit (not split further) because removing `paperCard()` breaks every file that imports it until each call site is also updated — splitting would leave the project non-compiling between commits.

This task depends on Task 1 having already landed (Task 1's CSS classes like `torn-b`/`tilt-*`/`paper-tape` no longer exist, which is exactly why this task's call sites stop passing options that reference them) but touches entirely different files, so there is no file-level conflict between the two tasks.

- [ ] **Step 1: Remove `paperCard()` from `components.ts`**

Find and delete this entire block:
```ts
/**
 * The scrapbook variant of `card()` - torn top edge, optional tilt and
 * tape - kept as a separate function (not a `card()` option) so every
 * existing `card(...)` call in session.ts (the night, focus-block
 * screen) renders exactly as before. Only used by the daylight screens.
 */
export function paperCard(
  children: (Node | string)[],
  opts: { tilt?: 'a' | 'b' | 'c' | 'd' | 'e'; torn?: 'b'; tape?: boolean } = {},
): HTMLDivElement {
  const classes = ['card', 'card--paper']
  if (opts.tilt) classes.push(`tilt-${opts.tilt}`)
  if (opts.torn === 'b') classes.push('torn-b')
  if (opts.tape) classes.push('paper-tape')
  return el('div', { class: classes.join(' ') }, children)
}
```
Leave `card()` (just above it) and `doodleMark()`/`titleWithDoodle()` (just below it) completely untouched.

- [ ] **Step 2: Update `welcome.ts`**

Change the import line from:
```ts
import { actions, body, button, el, field, paperCard, screen, textInput, titleWithDoodle } from '../components'
```
to:
```ts
import { actions, body, button, card, el, field, screen, textInput, titleWithDoodle } from '../components'
```
Change:
```ts
      paperCard([body(s.body), el('p', { class: 'screen__body' }, [s.browserNote])], { tilt: 'a', tape: true }),
```
to:
```ts
      card(body(s.body), el('p', { class: 'screen__body' }, [s.browserNote])),
```

- [ ] **Step 3: Update `consent.ts`**

Change the import line from:
```ts
import { actions, body, button, checkboxItem, el, field, paperCard, screen, textInput, titleWithDoodle } from '../components'
```
to:
```ts
import { actions, body, button, card, checkboxItem, el, field, screen, textInput, titleWithDoodle } from '../components'
```
Change:
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

- [ ] **Step 4: Update `clarify.ts`**

Change the import line from:
```ts
import { actions, body, button, el, paperCard, screen, titleWithDoodle } from '../components'
```
to:
```ts
import { actions, body, button, card, el, screen, titleWithDoodle } from '../components'
```
Change:
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

- [ ] **Step 5: Update `sessionCard.ts`**

Change the import line from:
```ts
import { actions, body, button, doodleMark, el, paperCard, screen, titleWithDoodle } from '../components'
```
to:
```ts
import { actions, body, button, card, doodleMark, el, screen, titleWithDoodle } from '../components'
```

Change the `bentoTile` helper from:
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
to:
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

Change `bentoMetrics`'s calls from:
```ts
    bentoTile('mascot', 'sand', [mascotPeek()], { tape: true }),
    bentoTile('focus', 'amber-tint', tileMetric(s.focusMinutesLabel, formatFocusLine(m.focusMs, m.sittingMs), true), { tape: true }),
    bentoTile('duduk', null, tileMetric(s.sittingMinutesLabel, formatDuration(m.sittingMs))),
    bentoTile('away', 'sage-tint', tileMetric(s.awayLabel, formatDuration(m.awayMs)), { torn: 'b' }),
    bentoTile('uncertain', null, tileMetric(s.uncertainLabel, formatDuration(m.uncertainMs)), { torn: 'b' }),
```
to:
```ts
    bentoTile('mascot', 'sand', [mascotPeek()]),
    bentoTile('focus', 'amber-tint', tileMetric(s.focusMinutesLabel, formatFocusLine(m.focusMs, m.sittingMs), true)),
    bentoTile('duduk', null, tileMetric(s.sittingMinutesLabel, formatDuration(m.sittingMs))),
    bentoTile('away', 'sage-tint', tileMetric(s.awayLabel, formatDuration(m.awayMs))),
    bentoTile('uncertain', null, tileMetric(s.uncertainLabel, formatDuration(m.uncertainMs))),
```
(the sixth call, for `'observation'`, already passes only 3 arguments and needs no change).

Change:
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

Change:
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

- [ ] **Step 6: Update `ready.ts`**

Change:
```ts
    const cameraTile = el('div', { class: 'bento-tile bento-tile--plain ready-grid__camera' }, [status, preview, dot])
```
to:
```ts
    const cameraTile = el('div', { class: 'bento-tile ready-grid__camera' }, [status, preview, dot])
```

- [ ] **Step 7: Verify**

```bash
npx tsc --noEmit
npm test
grep -rn "paperCard\|card--paper\|tilt-a\|tilt-b\|tilt-c\|tilt-d\|tilt-e\|torn-edge\|torn-b\|paper-tape\|paper-grain\|paper-amber\|paper-sage\|bento-tile--plain\|HISTORY_TILTS" src/ index.html
```
Expected: `tsc` zero errors, `npm test` 86/86 passing, and the `grep` command produces **no output** — confirming every scrapbook reference is gone from both the CSS and TypeScript layers.

- [ ] **Step 8: Commit**

```bash
git add src/ui/components.ts src/ui/screens/welcome.ts src/ui/screens/consent.ts src/ui/screens/clarify.ts src/ui/screens/sessionCard.ts src/ui/screens/ready.ts
git commit -m "Remove paperCard() and every scrapbook call site, switching to plain card()"
```

---

### Task 3: Final verification pass

**Files:** none modified — this task only verifies.

- [ ] **Step 1: Full automated check**

```bash
npx tsc --noEmit
npm test
grep -rn "paperCard\|card--paper\|tilt-a\|tilt-b\|tilt-c\|tilt-d\|tilt-e\|torn-edge\|torn-b\|paper-tape\|paper-grain\|paper-amber\|paper-sage\|bento-tile--plain\|HISTORY_TILTS" src/ index.html
```
Expected: `tsc` zero errors, `npm test` 86/86 passing, `grep` zero matches.

- [ ] **Step 2: Confirm doodle marks are untouched**

```bash
grep -rn "doodleMark\|DoodleMarkName\|doodle-mark" src/ | wc -l
```
Expected: a nonzero count matching what existed before this plan (doodle marks are explicitly out of scope — this just confirms nothing was accidentally caught by the removal).

- [ ] **Step 3: Dev-server structural smoke check**

Same standing constraint as the prior pass: no browser-automation tool may be installed (it would violate CLAUDE.md's fixed dependency allowlist), so this checks that the right bytes are served, not that they render correctly.

```bash
npm run dev -- --port 5185 &
sleep 2
curl -s http://localhost:5185/src/styles/tokens.css | grep -o "\-\-tile-amber" | head -1
curl -s http://localhost:5185/src/styles/base.css | grep -o "tilt-a" | head -1
curl -s http://localhost:5185/src/ui/components.ts | grep -o "paperCard" | head -1
kill %1
```
Expected: the first command finds `--tile-amber` (new token present), the second and third commands find **nothing** (confirming `tilt-a` and `paperCard` are both fully gone from what's served).

- [ ] **Step 4: Record what still needs a human eye**

Report to the user: tsc/tests/grep/dev-server-serves-the-new-code all passed, but nobody has visually confirmed the deeper shadow and clearer tile colors actually look like "deep elevation" and "clear color" rather than either too subtle or too heavy, or that removing the tilt/torn edges didn't leave any screen looking sparse. Recommend clicking through Welcome → Consent → Ready → Calibration → a short session → Session Card before considering this pass done.
