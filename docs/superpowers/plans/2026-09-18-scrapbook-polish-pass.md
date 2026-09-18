# Scrapbook Polish Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five concrete causes behind "too plain, bad UX writing" — placeholder doodle marks, too-subtle scrapbook texture, a broken font fetch, three under-styled screens, and inconsistent copy register — across the daylight screens.

**Architecture:** Pure CSS/DOM/copy changes. One new small component (`doodleMark`) replaces a placeholder one (`doodleSlot`); token/CSS values get stronger; one build-time asset-fetch URL gets corrected; three screens gain a `paperCard` wrap they were missing; `strings.ts` gets a targeted copy pass. No new files, no engine/perception/storage changes, no new dependencies.

**Tech Stack:** Plain TypeScript DOM, CSS custom properties, Vite, Vitest — unchanged from the rest of the repo.

**Spec:** `docs/superpowers/specs/2026-09-18-scrapbook-polish-pass-design.md`

## Global Constraints

- No new npm dependencies — the allowed list is exactly `@mediapipe/tasks-vision`, `vite`, `typescript`, `vitest`.
- No network calls from the shipped app. The font-URL fix in Task 3 only touches a build-time (`predev`/`prebuild`) fetch script, not runtime code.
- `src/engine/` is untouched by this plan.
- No red anywhere in the UI. Every color value used below is composed from the existing palette (`--cream`, `--sand`, `--amber`, `--amber-deep`, `--ink`, `--ink-muted`, `--sage`, `--night`) via `color-mix()` — never a new hex or hue.
- No `gagal`, `malas`, or `salah` in any user-facing string. Task 4 fixes the one pre-existing violation.
- Session (night) screen's visuals are untouched by this plan; only its copy is in scope, and per the spec its copy needs no changes.
- Plain DOM only — no JSX, no template-string markup for element trees (inline SVG strings assigned via `.innerHTML` are the one established exception, already used by `calibration.ts`'s `progressRing()`).
- Definition of done for every task: `npx tsc --noEmit` passes, `npm test` passes (86 tests, no new ones needed — this plan changes no pure logic), no new dependency appears in `package.json`, nothing outside the task's stated files changes.

---

### Task 1: `doodleMark()` component + wire it into every call site

**Files:**
- Modify: `src/ui/components.ts:98-126`
- Modify: `src/styles/base.css:351-372`
- Modify: `src/ui/screens/calibration.ts:107`
- Modify: `src/ui/screens/welcome.ts:30`
- Modify: `src/ui/screens/consent.ts:30`
- Modify: `src/ui/screens/ready.ts:321`
- Modify: `src/ui/screens/sessionCard.ts:2,64,247`
- Modify: `src/ui/screens/clarify.ts:37`

**Interfaces:**
- Produces: `type DoodleMarkName = 'squiggle' | 'sparkle' | 'swirl' | 'paw' | 'scribble-circle'`; `doodleMark(name: DoodleMarkName, opts?: { size?: string }): HTMLDivElement`; `titleWithDoodle(text: string, mark: DoodleMarkName): HTMLDivElement` (signature change — now requires a mark argument). Task 5 consumes this signature in `welcome.ts`, `consent.ts`, and `clarify.ts`.

- [ ] **Step 1: Replace `doodleSlot`/`titleWithDoodle` in `components.ts`**

In `src/ui/components.ts`, replace this block (lines 98-126):

```ts
/**
 * A dashed placeholder slot for hand-supplied art (doodle marks,
 * mascot, bento-tile imagery) - the user is providing their own assets,
 * so this stands in for them rather than any hand-rolled SVG. Purely
 * decorative; always aria-hidden.
 */
export function doodleSlot(
  label: string,
  opts: { shape?: 'box' | 'circle'; size?: string } = {},
): HTMLDivElement {
  const slot = el(
    'div',
    { class: `doodle-slot${opts.shape === 'circle' ? ' doodle-slot--circle' : ''}`, 'aria-hidden': 'true' },
    [label],
  )
  if (opts.size) {
    slot.style.width = opts.size
    slot.style.height = opts.size
  }
  return slot
}

/** A screen title paired with a small inline doodle-mark placeholder -
 * the one consistent scrapbook touch every daylight screen shares, even
 * ones (calibration, framing) whose main content can't be tilted
 * without breaking the live camera preview's geometry. */
export function titleWithDoodle(text: string): HTMLDivElement {
  return el('div', { class: 'title-row' }, [title(text), doodleSlot('doodle')])
}
```

with:

```ts
export type DoodleMarkName = 'squiggle' | 'sparkle' | 'swirl' | 'paw' | 'scribble-circle'

const DOODLE_MARK_SVG: Record<DoodleMarkName, string> = {
  squiggle: `<svg viewBox="0 0 32 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M2 11c3-8 6-8 9 0s6 8 9 0 6-8 9 0"/></svg>`,
  sparkle: `<svg viewBox="0 0 32 32" fill="currentColor"><path d="M16 2c0 6.5 1 9 2.5 10.5S25 15 30 16c-6.5 0-9 1-10.5 2.5S16 25 16 30c0-6.5-1-9-2.5-10.5S8 17 2 16c6.5 0 9-1 10.5-2.5S16 8 16 2z"/></svg>`,
  swirl: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20c0 5 4 8 9 8s9-4 9-9-3-8-7-8-6 2-6 6 3 5 6 5 4-1.5 4-3.5"/><path d="M20 17l3 2-1 3.5"/></svg>`,
  paw: `<svg viewBox="0 0 32 32" fill="currentColor"><ellipse cx="16" cy="22" rx="8" ry="6.5"/><ellipse cx="6" cy="12" rx="3" ry="4" transform="rotate(-15 6 12)"/><ellipse cx="13" cy="7" rx="3" ry="4"/><ellipse cx="20" cy="7" rx="3" ry="4"/><ellipse cx="27" cy="12" rx="3" ry="4" transform="rotate(15 27 12)"/></svg>`,
  'scribble-circle': `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6c-8-3-16 2-16 10s7 12 13 10 9-8 7-14c-1-3-4-4-4-4"/></svg>`,
}

/**
 * A small hand-drawn-style decorative mark (never informational - always
 * aria-hidden). Fixed, deterministic per call site, same "no
 * Math.random()" rule the tilt tokens and confetti pattern already
 * follow - each screen picks its mark explicitly, nothing rotates at
 * runtime.
 */
export function doodleMark(name: DoodleMarkName, opts: { size?: string } = {}): HTMLDivElement {
  const mark = el('div', { class: 'doodle-mark', 'aria-hidden': 'true' })
  mark.innerHTML = DOODLE_MARK_SVG[name]
  if (opts.size) {
    mark.style.width = opts.size
    mark.style.height = opts.size
  }
  return mark
}

/** A screen title paired with a small hand-drawn decorative mark - the
 * one consistent scrapbook touch every daylight screen shares, even
 * ones (calibration, framing) whose main content can't be tilted
 * without breaking the live camera preview's geometry. */
export function titleWithDoodle(text: string, mark: DoodleMarkName): HTMLDivElement {
  return el('div', { class: 'title-row' }, [title(text), doodleMark(mark)])
}
```

- [ ] **Step 2: Replace the CSS in `base.css`**

Replace this block (lines 351-372):

```css
/* Placeholder slot for hand-supplied art (doodle marks, mascot,
   bento-tile imagery) - dashed box + small label, aria-hidden. Not
   final art; swap the element for a real <img>/<svg> when the asset
   exists. */
.doodle-slot {
  border: 1.5px dashed color-mix(in srgb, var(--ink-muted) 55%, transparent);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--ink-muted) 5%, transparent);
  color: var(--ink-muted);
  font-size: var(--text-xs);
  line-height: 1.2;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-1) var(--space-2);
  flex-shrink: 0;
}

.doodle-slot--circle {
  border-radius: 50%;
}
```

with:

```css
/* Small hand-drawn-style decorative mark - see doodleMark() in
   components.ts. Purely decorative, always aria-hidden. */
.doodle-mark {
  width: 28px;
  height: 28px;
  color: var(--ink-muted);
  flex-shrink: 0;
  display: inline-flex;
}

.doodle-mark svg {
  width: 100%;
  height: 100%;
  display: block;
}
```

- [ ] **Step 3: Update every `titleWithDoodle`/`doodleSlot` call site**

In `src/ui/screens/calibration.ts`, change line 107 from:
```ts
    content.append(titleWithDoodle(s.title), status, ring.element, countdown, preview, actions(cancelBtn, continueBtn))
```
to:
```ts
    content.append(titleWithDoodle(s.title, 'sparkle'), status, ring.element, countdown, preview, actions(cancelBtn, continueBtn))
```

In `src/ui/screens/welcome.ts`, change line 30 from:
```ts
      titleWithDoodle(s.title),
```
to:
```ts
      titleWithDoodle(s.title, 'paw'),
```

In `src/ui/screens/consent.ts`, change line 30 from:
```ts
      titleWithDoodle(s.title),
```
to:
```ts
      titleWithDoodle(s.title, 'squiggle'),
```

In `src/ui/screens/ready.ts`, change line 321 from:
```ts
    content.append(titleWithDoodle(s.framing.title), grid, ctaRow)
```
to:
```ts
    content.append(titleWithDoodle(s.framing.title, 'swirl'), grid, ctaRow)
```

In `src/ui/screens/clarify.ts`, change line 37 from:
```ts
      titleWithDoodle(s.title),
```
to:
```ts
      titleWithDoodle(s.title, 'scribble-circle'),
```

In `src/ui/screens/sessionCard.ts`:
- Change the import on line 2 from:
```ts
import { actions, body, button, doodleSlot, el, paperCard, screen, titleWithDoodle } from '../components'
```
  to:
```ts
import { actions, body, button, doodleMark, el, paperCard, screen, titleWithDoodle } from '../components'
```
- Change line 64 (inside `bentoMetrics`) from:
```ts
      doodleSlot('doodle', { size: '36px' }),
```
  to:
```ts
      doodleMark('paw', { size: '36px' }),
```
- Change line 247 (inside `renderSessionCard`) from:
```ts
      titleWithDoodle(s.title),
```
  to:
```ts
      titleWithDoodle(s.title, 'squiggle'),
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm test
```
Expected: both succeed — `tsc` with zero errors, `npm test` with all 86 existing tests passing (no test file changes in this task).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components.ts src/styles/base.css src/ui/screens/calibration.ts src/ui/screens/welcome.ts src/ui/screens/consent.ts src/ui/screens/ready.ts src/ui/screens/sessionCard.ts src/ui/screens/clarify.ts
git commit -m "Replace placeholder doodle boxes with real hand-drawn SVG marks"
```

---

### Task 2: Strengthen the scrapbook signature (tilt, grain, tape)

**Files:**
- Modify: `src/styles/tokens.css:97-101,119`
- Modify: `src/styles/base.css` (the `.paper-tape::after` rule)

**Interfaces:** None — pure CSS custom-property and rule changes, no code consumes anything new here.

- [ ] **Step 1: Bump the tilt tokens**

In `src/styles/tokens.css`, change:
```css
  --tilt-a: -1.2deg;
  --tilt-b: 1deg;
  --tilt-c: -0.8deg;
  --tilt-d: 1.3deg;
  --tilt-e: -0.4deg;
```
to:
```css
  --tilt-a: -2.4deg;
  --tilt-b: 2deg;
  --tilt-c: -1.6deg;
  --tilt-d: 2.6deg;
  --tilt-e: -0.8deg;
```

- [ ] **Step 2: Strengthen the paper-grain noise**

In the same file, in the `--paper-grain` data-URI on line 119, find the substring `0 0 0 0.045 0` (the `feColorMatrix` alpha row) and replace it with `0 0 0 0.1 0`. Everything else in that line (the RGB rows tinting the noise to `--ink`, the turbulence filter itself) is unchanged.

- [ ] **Step 3: Add a shadow to the washi-tape strip**

In `src/styles/base.css`, find:
```css
.paper-tape::after {
  content: '';
  position: absolute;
  top: 10px;
  left: 50%;
  width: 52px;
  height: 20px;
  background: var(--tape-color);
  border: 1px solid var(--tape-border);
  transform: translateX(-50%) rotate(-4deg);
  opacity: 0.85;
  pointer-events: none;
}
```
and change it to:
```css
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
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm test
```
Expected: both succeed unchanged (CSS-only task — nothing here is type-checked or unit-tested, this just confirms the task didn't accidentally break a TS file).

- [ ] **Step 5: Commit**

```bash
git add src/styles/tokens.css src/styles/base.css
git commit -m "Strengthen the scrapbook tilt, paper-grain, and tape shadow"
```

---

### Task 3: Fix the broken font-fetch URLs

**Files:**
- Modify: `tools/fetch-assets.mjs`

**Interfaces:** None. This only changes which bytes land at the existing local paths `public/fonts/PlusJakartaSans-Variable.woff2` and `public/fonts/Inter-Variable.woff2`, which `src/styles/base.css`'s `@font-face` rules already reference unchanged.

**Context:** Both current URLs 404 — the upstream repos renamed their variable-font files (confirmed by inspecting each repo's file tree). The app has been silently falling back to the system font stack the whole time. This keeps Plus Jakarta Sans as the chosen display face (PRD §4 names it deliberately) — it's a URL fix, not a font swap.

- [ ] **Step 1: Fix the two URLs**

In `tools/fetch-assets.mjs`, find:
```js
  {
    dest: join(root, 'public', 'fonts', 'PlusJakartaSans-Variable.woff2'),
    url: 'https://github.com/tokotype/PlusJakartaSans/raw/master/fonts/webfonts/PlusJakartaSans-VariableFont_wght.woff2',
    required: false,
  },
  {
    dest: join(root, 'public', 'fonts', 'Inter-Variable.woff2'),
    url: 'https://github.com/rsms/inter/raw/master/docs/font-files/Inter-Variable.woff2',
    required: false,
  },
```
and replace with:
```js
  {
    dest: join(root, 'public', 'fonts', 'PlusJakartaSans-Variable.woff2'),
    url: 'https://github.com/tokotype/PlusJakartaSans/raw/master/fonts/webfonts/PlusJakartaSans%5Bwght%5D.woff2',
    required: false,
  },
  {
    dest: join(root, 'public', 'fonts', 'Inter-Variable.woff2'),
    url: 'https://github.com/rsms/inter/raw/master/docs/font-files/InterVariable.woff2',
    required: false,
  },
```

- [ ] **Step 2: Verify the fonts actually download now**

```bash
rm -f public/fonts/PlusJakartaSans-Variable.woff2 public/fonts/Inter-Variable.woff2
node tools/fetch-assets.mjs
ls -la public/fonts/
```
Expected: the `ls` output lists both `PlusJakartaSans-Variable.woff2` and `Inter-Variable.woff2`, each with a nonzero size (real variable-font files are typically 50KB-300KB), and the command's own output contains no `failed to download optional asset` line for either font.

- [ ] **Step 3: Run the full verification**

```bash
npx tsc --noEmit
npm test
```
Expected: both succeed unchanged — this task touches no TypeScript.

- [ ] **Step 4: Commit**

```bash
git add tools/fetch-assets.mjs
git commit -m "Fix stale font-fetch URLs so Plus Jakarta Sans/Inter actually load"
```

Note: `public/fonts/*.woff2` are git-ignored (same as the MediaPipe model files) — only the script change is committed here, not the downloaded font files themselves.

---

### Task 4: UX writing pass on `strings.ts`

**Files:**
- Modify: `src/ui/strings.ts`

**Interfaces:** None — every change is a string literal value; no key is renamed, added, or removed, so nothing that reads `strings.*` needs to change.

**Context:** Two registers apply: student-facing screens get a warmer, more casual, occasionally first-person ("aku" = Hachiko) voice; Consent stays plain and clear because its reader is the parent, not the student. Destructive-action copy stays plain everywhere. Session's own copy and Clarify's title/body (lifted from PRD §8) are already at the target bar and are not touched by this task — only the specific keys below change. This task also fixes the one pre-existing banned-word violation (`optionMixed`).

- [ ] **Step 1: Welcome screen copy**

In `src/ui/strings.ts`, in the `welcome` block, change:
```ts
    title: 'Selamat datang di HACHIKO',
```
to:
```ts
    title: 'Halo, aku Hachiko!',
```

Change:
```ts
    body: 'HACHIKO menemani kamu belajar. Kamera laptopmu memperhatikan posisi dudukmu, dan seekor anjing digital tidur saat kamu fokus, lalu bangun saat perhatianmu teralih.',
```
to:
```ts
    body: 'Aku bakal nemenin kamu belajar. Kamera laptop kamu ngeliatin posisi dudukmu, terus aku tidur waktu kamu fokus dan bangun kalau kamu mulai teralih.',
```

Change:
```ts
    browserNote: 'HACHIKO berjalan paling baik di Chrome atau Edge di laptop.',
```
to:
```ts
    browserNote: 'HACHIKO paling enak dipakai di Chrome atau Edge, di laptop.',
```

Change:
```ts
    noAccountNote: 'Tidak perlu akun. Nama ini cuma disimpan di laptopmu sendiri.',
```
to:
```ts
    noAccountNote: 'Nggak perlu akun. Nama ini cuma kesimpen di laptop kamu sendiri.',
```

- [ ] **Step 2: Framing and Calibration copy**

In the `framing` block, change:
```ts
    body: 'Pastikan wajahmu masuk ke dalam kotak, dan duduk seperti biasanya kamu belajar.',
```
to:
```ts
    body: 'Pastikan wajahmu masuk ke kotak, terus duduk kayak biasa kamu belajar ya.',
```

In the `calibration` block, change:
```ts
    body: 'Duduk seperti biasanya kamu belajar. HACHIKO sedang mengenali posisi normalmu.',
```
to:
```ts
    body: 'Duduk kayak biasa kamu belajar ya. Aku lagi ngapalin posisi dudukmu yang normal.',
```

and change:
```ts
    done: 'Sudah selesai. Yuk lanjut.',
```
to:
```ts
    done: 'Beres! Yuk lanjut.',
```

- [ ] **Step 3: Ready screen labels**

In the `ready` block, change:
```ts
    durationLabel: 'Pilih lama sesi',
```
to:
```ts
    durationLabel: 'Berapa lama kamu mau fokus?',
```

Change:
```ts
    breakSettingsLabel: 'Pengaturan istirahat',
```
to:
```ts
    breakSettingsLabel: 'Atur istirahat',
```

Change:
```ts
    timelineTitle: 'Pola sesimu',
```
to:
```ts
    timelineTitle: 'Alur sesimu',
```

- [ ] **Step 4: Fix the banned word in Clarify**

In the `clarify` block, change:
```ts
    optionMixed: 'Salah Deteksi',
```
to:
```ts
    optionMixed: 'Deteksinya Meleset',
```

- [ ] **Step 5: Session Card metric labels**

In the `sessionCard` block, change:
```ts
    focusMinutesLabel: 'Menit fokus',
```
to:
```ts
    focusMinutesLabel: 'Waktu fokus',
```

Change:
```ts
    awayLabel: 'Waktu Away',
```
to:
```ts
    awayLabel: 'Waktu Absen',
```

Change:
```ts
    uncertainLabel: 'Belum jelas',
```
to:
```ts
    uncertainLabel: 'Waktu belum jelas',
```

(Do not touch `session.stateLabels.UNCERTAIN`, which is a different key that also has the value `'Belum jelas'` — that one stays unchanged per the spec, since the live session state label must stay neutral.)

- [ ] **Step 6: End screen copy**

In the `endScreen` block, change:
```ts
    doneTitle: 'Sesi selesai',
```
to:
```ts
    doneTitle: 'Sesi selesai!',
```

- [ ] **Step 7: Verify**

```bash
npx tsc --noEmit
npm test
grep -rn "gagal\|malas\|salah" -i src/
```
Expected: `tsc` and `npm test` succeed unchanged (86 tests — `strings.test.ts` only tests `formatDuration`/`formatFocusLine`, neither of which changed). The `grep` command must produce **no output** — this is the banned-word check from CLAUDE.md's Definition of Done, and after Step 4 there should be zero matches anywhere in `src/`.

- [ ] **Step 8: Commit**

```bash
git add src/ui/strings.ts
git commit -m "Rewrite Welcome/Calibration/Ready/Session Card copy for a warmer, consistent voice"
```

---

### Task 5: Wrap Welcome, Consent, and Clarify in paper cards

**Files:**
- Modify: `src/ui/screens/welcome.ts`
- Modify: `src/ui/screens/consent.ts`
- Modify: `src/ui/screens/clarify.ts`

**Interfaces:**
- Consumes: `titleWithDoodle(text: string, mark: DoodleMarkName)` from Task 1 (already applied to these three files' title lines) and the existing `paperCard(children: (Node | string)[], opts?: { tilt?: 'a'|'b'|'c'|'d'|'e'; torn?: 'b'; tape?: boolean }): HTMLDivElement` from `components.ts` (unchanged by this plan).

**Context:** These three screens are still a plain vertical stack. This task wraps their core content in a tilted `paperCard`, matching the treatment Ready/Calibration/Session Card already have — light touch, no grid restructuring, since each of these is a single-focus interaction (one field, one set of checkboxes, one decision).

- [ ] **Step 1: Welcome — wrap the intro copy in a paper card**

In `src/ui/screens/welcome.ts`, change the import line from:
```ts
import { actions, body, button, el, field, screen, textInput, titleWithDoodle } from '../components'
```
to:
```ts
import { actions, body, button, el, field, paperCard, screen, textInput, titleWithDoodle } from '../components'
```

Change the `content.append(...)` call from:
```ts
    content.append(
      mascotPeek(),
      titleWithDoodle(s.title, 'paw'),
      body(s.body),
      el('p', { class: 'screen__body' }, [s.browserNote]),
      nameField.element,
      actions(button(s.continueLabel, submit)),
      el('p', { class: 'note' }, [s.noAccountNote]),
    )
```
to:
```ts
    content.append(
      mascotPeek(),
      titleWithDoodle(s.title, 'paw'),
      paperCard([body(s.body), el('p', { class: 'screen__body' }, [s.browserNote])], { tilt: 'a', tape: true }),
      nameField.element,
      actions(button(s.continueLabel, submit)),
      el('p', { class: 'note' }, [s.noAccountNote]),
    )
```

(If Task 1 has not yet landed when you read this file, the title line will instead read `titleWithDoodle(s.title)` with one argument — that's Task 1's job, not this task's; this task assumes Task 1 is already committed, which it is by the time this task is dispatched.)

- [ ] **Step 2: Consent — wrap the checkboxes in a paper card**

In `src/ui/screens/consent.ts`, `paperCard` is already imported — no import change needed. Change:
```ts
      el('div', {}, [permission.element, camera.element, noReport.element]),
```
to:
```ts
      paperCard([permission.element, camera.element, noReport.element], { tilt: 'd', torn: 'b' }),
```

- [ ] **Step 3: Clarify — wrap the three real options in a paper card**

In `src/ui/screens/clarify.ts`, change the import line from:
```ts
import { actions, body, button, el, screen, titleWithDoodle } from '../components'
```
to:
```ts
import { actions, body, button, el, paperCard, screen, titleWithDoodle } from '../components'
```

Change the `content.append(...)` call from:
```ts
    content.append(
      titleWithDoodle(s.title, 'scribble-circle'),
      body(s.body),
      actions(
        button(s.optionBook, () => choose('book')),
        button(s.optionPhone, () => choose('phone')),
        button(s.optionMixed, () => choose('mixed')),
        button(s.optionSkip, () => choose(null), { variant: 'secondary' }),
      ),
      autoNote,
    )
```
to:
```ts
    content.append(
      titleWithDoodle(s.title, 'scribble-circle'),
      body(s.body),
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
      actions(button(s.optionSkip, () => choose(null), { variant: 'secondary' })),
      autoNote,
    )
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm test
```
Expected: both succeed — all 86 tests still pass (no logic changed, only DOM structure).

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/welcome.ts src/ui/screens/consent.ts src/ui/screens/clarify.ts
git commit -m "Wrap Welcome/Consent/Clarify content in the scrapbook paper-card treatment"
```

---

### Task 6: Final verification pass

**Files:** none modified — this task only verifies.

- [ ] **Step 1: Full automated check**

```bash
npx tsc --noEmit
npm test
grep -rn "gagal\|malas\|salah" -i src/
```
Expected: `tsc` zero errors, `npm test` 86/86 passing, `grep` zero matches.

- [ ] **Step 2: Confirm the fonts are actually present**

```bash
ls -la public/fonts/
```
Expected: both `PlusJakartaSans-Variable.woff2` and `Inter-Variable.woff2` are present with nonzero size (from Task 3).

- [ ] **Step 3: Dev-server structural smoke check**

This project's hard dependency cap (`@mediapipe/tasks-vision`, `vite`, `typescript`, `vitest` only) means no browser-automation tool (Playwright, Puppeteer, etc.) may be installed to screenshot the running app — doing so would violate CLAUDE.md's "no new dependencies" constraint even as a dev-only/transient install. Do the best available automated check instead:

```bash
npm run dev -- --port 5183 &
sleep 2
curl -s http://localhost:5183/src/ui/components.ts | grep -o "doodle-mark" | head -1
curl -s http://localhost:5183/src/ui/strings.ts | grep -o "Halo, aku Hachiko" | head -1
curl -s http://localhost:5183/src/ui/strings.ts | grep -o "Deteksinya Meleset" | head -1
kill %1
```
Expected: each `grep -o` prints the matched string once, confirming the new component and copy are actually present in what the dev server serves (not just in source that failed to load). This is a structural check only — it does **not** confirm the pages render correctly, look right, or are free of layout breakage.

- [ ] **Step 4: Record what still needs a human eye**

Report to the user (this is a note for whoever runs this task, not a code change): tsc/tests/grep/dev-server-serves-the-new-code all passed, but nobody has visually confirmed the seven doodle marks render correctly, the strengthened tilt/tape/grain looks right rather than excessive, or that Welcome/Consent/Clarify's new paper-card wrapping doesn't clip or overlap at any viewport width. Recommend the user open the app in a real browser and click through Welcome → Consent → Ready → Calibration → a short session → Session Card before considering this pass fully done.
