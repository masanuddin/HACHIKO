# Ready Screen Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Framing (camera framing check), Media (declared study materials), and Ready (work duration + rounds-per-set) screens into one non-scrolling bento-style screen, with break durations becoming configurable and the camera visually expanding into the Calibration screen instead of a plain cut.

**Architecture:** One new screen module (`ready.ts`) absorbs the logic of the three screens it replaces. Two new small, reusable pieces support it: a "hybrid stepper" DOM component (`[-][input][+]` + presets) in `components.ts`, and a single-purpose FLIP-style transition helper (`transition.ts`) that lets the already-persistent `<video>` element's container visually grow from the Ready screen into Calibration. `session.ts`'s break-duration constants become parameters instead of fixed imports.

**Tech Stack:** TypeScript, Vite, Vitest, plain DOM (no framework). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-17-ready-screen-merge-design.md`

## Global Constraints

- No new npm dependency (allowed list stays `@mediapipe/tasks-vision`, `vite`, `typescript`, `vitest`).
- No network calls.
- `src/engine/` stays untouched and pure - this feature touches only `src/ui/` and one `main.ts` wiring change.
- User-facing strings: Indonesian, casual register, no `gagal`/`malas`/`salah`, no red anywhere, one accent (amber), one radius scale (already established tokens - reuse them).
- The multi-cycle "Fokus lagi?" loop and the long-break placement algorithm (`cycleInSet >= roundsPerSet` in `session.ts`) do **not** change - only how their inputs (`breakMs`, `longBreakMs`) are supplied.
- Camera preview geometry must stay exact - `calibration.ts`'s `BOX_ASPECT = 4/3` constant must keep matching `.camera-preview`'s actual aspect ratio, or the face-box overlay math breaks.
- `tsc --noEmit` and `npm test` must pass after every task.

---

### Task 1: Duration/break-ratio constants and pure helpers in `sessionConfig.ts`

**Files:**
- Modify: `src/ui/sessionConfig.ts`
- Test: `src/ui/sessionConfig.test.ts` (new file)

**Interfaces:**
- Produces: `DURATION_MIN_MS: number`, `DURATION_MAX_MS: number`, `BREAK_MAX_RATIO: number`, `LONG_BREAK_MAX_RATIO: number`, `clampDurationMs(rawMs: number, minMs: number, maxMs: number): number`, `maxBreakMs(workMs: number, ratio: number): number`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/sessionConfig.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { clampDurationMs, maxBreakMs, DURATION_MIN_MS, DURATION_MAX_MS, BREAK_MAX_RATIO, LONG_BREAK_MAX_RATIO } from './sessionConfig'

describe('clampDurationMs', () => {
  it('passes through a value already inside the range', () => {
    expect(clampDurationMs(25 * 60_000, DURATION_MIN_MS, DURATION_MAX_MS)).toBe(25 * 60_000)
  })

  it('clamps below the minimum up to the minimum', () => {
    expect(clampDurationMs(0, DURATION_MIN_MS, DURATION_MAX_MS)).toBe(DURATION_MIN_MS)
  })

  it('clamps above the maximum down to the maximum', () => {
    expect(clampDurationMs(999 * 60_000, DURATION_MIN_MS, DURATION_MAX_MS)).toBe(DURATION_MAX_MS)
  })

  it('does not round to whole minutes - fastdebug-style sub-minute values pass through clamping untouched', () => {
    expect(clampDurationMs(30_000, DURATION_MIN_MS, DURATION_MAX_MS)).toBe(30_000)
  })

  it('respects a caller-supplied max lower than DURATION_MAX_MS', () => {
    expect(clampDurationMs(20 * 60_000, DURATION_MIN_MS, 10 * 60_000)).toBe(10 * 60_000)
  })
})

describe('maxBreakMs', () => {
  it('is a ratio of the work duration when that is below the absolute ceiling', () => {
    expect(maxBreakMs(25 * 60_000, BREAK_MAX_RATIO)).toBe(25 * 60_000 * 0.5)
  })

  it('never exceeds DURATION_MAX_MS even for a long work duration', () => {
    expect(maxBreakMs(60 * 60_000, LONG_BREAK_MAX_RATIO)).toBe(DURATION_MAX_MS)
  })

  it('the default 5-minute short break and 15-minute long break both fit under a 25-minute work default', () => {
    const workMs = 25 * 60_000
    expect(5 * 60_000).toBeLessThanOrEqual(maxBreakMs(workMs, BREAK_MAX_RATIO))
    expect(15 * 60_000).toBeLessThanOrEqual(maxBreakMs(workMs, LONG_BREAK_MAX_RATIO))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/sessionConfig.test.ts`
Expected: FAIL - `clampDurationMs`, `maxBreakMs`, `DURATION_MIN_MS`, `DURATION_MAX_MS`, `BREAK_MAX_RATIO`, `LONG_BREAK_MAX_RATIO` are not exported yet.

- [ ] **Step 3: Add the constants and functions**

In `src/ui/sessionConfig.ts`, add after the existing `ROUNDS_PER_SET_OPTIONS`/`DEFAULT_ROUNDS_PER_SET` block (do not modify anything above it):

```ts
/**
 * Shared bounds for every duration stepper (work, short break, long
 * break) on the merged Ready screen - see the 2026-09-17 design spec.
 */
export const DURATION_MIN_MS = 1 * 60_000
export const DURATION_MAX_MS = 60 * 60_000

// Break-duration ceilings are a share of the chosen work duration, not
// a fixed number - a break shouldn't be able to outlast (or nearly
// outlast) the work block it follows.
export const BREAK_MAX_RATIO = 0.5
export const LONG_BREAK_MAX_RATIO = 2 / 3

/** Plain min/max clamp - deliberately does NOT round to whole minutes,
 * so a preset like FAST_DEBUG_WORK_MS (30s) still passes through
 * exactly instead of getting rounded up to a full minute. */
export function clampDurationMs(rawMs: number, minMs: number, maxMs: number): number {
  return Math.min(maxMs, Math.max(minMs, rawMs))
}

/** The effective ceiling for a break-duration stepper: a ratio of the
 * current work duration, but never above the shared absolute max. */
export function maxBreakMs(workMs: number, ratio: number): number {
  return Math.min(DURATION_MAX_MS, workMs * ratio)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/sessionConfig.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors

```bash
git add src/ui/sessionConfig.ts src/ui/sessionConfig.test.ts
git commit -m "Add duration clamp/break-ratio helpers for the Ready screen merge"
```

---

### Task 2: Hybrid Stepper and Disclosure DOM components in `components.ts`

**Files:**
- Modify: `src/ui/components.ts`

**Interfaces:**
- Consumes: `clampDurationMs` from `./sessionConfig` (Task 1), `formatDuration` from `./strings` (already exported today)
- Produces: `stepper(opts: { label: string; initialMs: number; minMs: number; maxMs: number; presetsMs: number[]; onChange: (ms: number) => void }): { element: HTMLDivElement; setMax: (newMaxMs: number) => void }`, `disclosure(summaryText: string, content: HTMLElement[]): { element: HTMLDivElement }`

No dedicated test file for this task - it's DOM-wiring code, and the existing `chipGroup`/`checkboxItem`/`field` helpers in this same file have no test files either (this codebase's convention: pure logic gets unit tests, DOM helpers get verified via `tsc` + manual browser check, see Task 11).

- [ ] **Step 1: Add the imports**

At the top of `src/ui/components.ts`, add:

```ts
import { clampDurationMs } from './sessionConfig'
import { formatDuration } from './strings'
```

- [ ] **Step 2: Add the `stepper()` function**

Append to `src/ui/components.ts`:

```ts
/**
 * `[-] [input] [+]` plus a row of preset buttons, for any duration in
 * milliseconds. Used for work/short-break/long-break duration on the
 * Ready screen - NOT for rounds-per-set, which stays the simple
 * preset-chip picker (`chipGroup`) it already was; a free-typed number
 * of rounds has no sensible general meaning past a handful of presets
 * (see the 2026-09-17 design spec's "Algorithm notes").
 */
export function stepper(opts: {
  label: string
  initialMs: number
  minMs: number
  maxMs: number
  presetsMs: number[]
  onChange: (ms: number) => void
}): { element: HTMLDivElement; setMax: (newMaxMs: number) => void } {
  let valueMs = opts.initialMs
  let maxMs = opts.maxMs

  const input = el('input', {
    type: 'text',
    inputmode: 'numeric',
    class: 'stepper__input',
  }) as HTMLInputElement

  function apply(ms: number): void {
    valueMs = clampDurationMs(ms, opts.minMs, maxMs)
    input.value = formatDuration(valueMs)
    opts.onChange(valueMs)
  }

  const minusBtn = el('button', { class: 'stepper__btn', type: 'button', 'aria-label': 'Kurangi' }, ['-'])
  const plusBtn = el('button', { class: 'stepper__btn', type: 'button', 'aria-label': 'Tambah' }, ['+'])

  minusBtn.addEventListener('click', () => apply(valueMs - 60_000))
  plusBtn.addEventListener('click', () => apply(valueMs + 60_000))

  // Long-press auto-repeat: the click handlers above already cover a
  // single tap; holding the button repeats every ACCELERATE_MS once
  // ACCELERATE_AFTER_MS has passed. Plain timers, no new dependency.
  const ACCELERATE_MS = 120
  const ACCELERATE_AFTER_MS = 600

  function holdRepeat(btn: HTMLButtonElement, direction: 1 | -1): void {
    let timeout: number | null = null
    let interval: number | null = null

    function stop(): void {
      if (timeout !== null) window.clearTimeout(timeout)
      if (interval !== null) window.clearInterval(interval)
      timeout = null
      interval = null
    }

    btn.addEventListener('pointerdown', () => {
      timeout = window.setTimeout(() => {
        interval = window.setInterval(() => apply(valueMs + direction * 60_000), ACCELERATE_MS)
      }, ACCELERATE_AFTER_MS)
    })
    btn.addEventListener('pointerup', stop)
    btn.addEventListener('pointerleave', stop)
  }

  holdRepeat(minusBtn, -1)
  holdRepeat(plusBtn, 1)

  input.addEventListener('blur', () => {
    const parsed = Number.parseInt(input.value, 10)
    if (Number.isNaN(parsed)) {
      input.value = formatDuration(valueMs)
      return
    }
    apply(parsed * 60_000)
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur()
  })

  const presetButtons = opts.presetsMs.map((presetMs) => {
    const btn = el('button', { class: 'preset-chip', type: 'button' }, [formatDuration(presetMs)])
    btn.addEventListener('click', () => apply(presetMs))
    return btn
  })

  const element = el('div', { class: 'stepper' }, [
    el('span', { class: 'metric__label' }, [opts.label]),
    el('div', { class: 'stepper__row' }, [minusBtn, input, plusBtn]),
    el('div', { class: 'stepper__presets' }, presetButtons),
  ])

  apply(valueMs)

  return {
    element,
    setMax: (newMaxMs: number) => {
      maxMs = newMaxMs
      apply(valueMs) // re-clamp against the new ceiling immediately
    },
  }
}

/**
 * A collapsed-by-default section - used for "Pengaturan istirahat" on
 * the Ready screen so the common case (just pick a duration and go)
 * doesn't get more crowded than the app already is.
 */
export function disclosure(summaryText: string, content: HTMLElement[]): { element: HTMLDivElement } {
  const chevron = el('span', { class: 'disclosure__chevron', 'aria-hidden': 'true' }, ['▸'])
  const summaryBtn = el(
    'button',
    { class: 'disclosure__summary', type: 'button', 'aria-expanded': 'false' },
    [chevron, summaryText],
  )
  const panel = el('div', { class: 'disclosure__panel' }, content)
  panel.hidden = true

  summaryBtn.addEventListener('click', () => {
    const opening = panel.hidden
    panel.hidden = !opening
    summaryBtn.setAttribute('aria-expanded', String(opening))
    summaryBtn.classList.toggle('disclosure__summary--open', opening)
  })

  return { element: el('div', { class: 'disclosure' }, [summaryBtn, panel]) }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/ui/components.ts
git commit -m "Add stepper() and disclosure() DOM components for the Ready screen"
```

---

### Task 3: FLIP transition helper

**Files:**
- Create: `src/ui/transition.ts`

**Interfaces:**
- Produces: `flipExpand(el: HTMLElement, fromRect: DOMRect): void`

No dedicated test - browser-API-heavy (`getBoundingClientRect`, `matchMedia`, inline style manipulation), same category as `src/perception/camera.ts` which also has no unit tests in this codebase. Verified manually in Task 11.

- [ ] **Step 1: Create the file**

```ts
// src/ui/transition.ts

/**
 * A single-purpose FLIP (First-Last-Invert-Play) transition: `el` is
 * already at its FINAL position and size in the DOM (its "Last" state).
 * `fromRect` is where the same visual content sat a moment ago on the
 * previous screen (its "First" state, e.g. the camera preview's bento
 * tile on the Ready screen). This inverts `el` back to that starting
 * rect with a transform, then animates the transform back to identity,
 * so it visually grows from the old position/size to the new one.
 *
 * Used once: Ready screen's camera preview expanding into Calibration's
 * full-screen preview. The underlying <video> element is the same DOM
 * node throughout every screen in this flow (kept attached so
 * requestVideoFrameCallback never stalls - see camera.ts/media.ts's
 * comments), so the live feed never blinks or reinitializes - only the
 * box around it visually changes size.
 */
export function flipExpand(el: HTMLElement, fromRect: DOMRect): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const toRect = el.getBoundingClientRect()
  if (toRect.width === 0 || toRect.height === 0) return

  const dx = fromRect.left - toRect.left
  const dy = fromRect.top - toRect.top
  const sx = fromRect.width / toRect.width
  const sy = fromRect.height / toRect.height

  el.style.transformOrigin = 'top left'
  el.style.transition = 'none'
  el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`

  // Force layout so the browser commits the "First" transform above
  // before the transition below is applied - without this the two
  // style writes would get batched into one and nothing would animate.
  el.getBoundingClientRect()

  requestAnimationFrame(() => {
    el.style.transition = 'transform var(--duration-slow) var(--ease-spring)'
    el.style.transform = 'none'
  })

  el.addEventListener(
    'transitionend',
    () => {
      el.style.transition = ''
      el.style.transformOrigin = ''
    },
    { once: true },
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/ui/transition.ts
git commit -m "Add flipExpand transition helper for the camera-preview handoff into Calibration"
```

---

### Task 4: CSS for the merged screen's grid, stepper, and disclosure

**Files:**
- Modify: `src/styles/base.css`

No test - pure CSS, verified visually in Task 11.

- [ ] **Step 1: Add the grid layout rules**

Append to `src/styles/base.css`, after the existing "Scrapbook / bento treatment" section (search for `.bento-tile--observation` to find the end of that block):

```css
/* ---- Ready screen merge (camera + streak + media + duration + rounds) ----
   A different grid shape from the Session Card's .bento (2 columns,
   not 4), sharing only the .bento-tile base look. The camera tile gets
   .bento-tile--plain (no torn edge/tilt - it's a live functional
   preview, not decoration) and a FIXED height, never aspect-ratio
   derived from its spanned rows - that combination caused a real bug
   during design (any relayout in the stepper tiles, even a text-width
   change from clicking +/-, nudged the camera box's computed size on
   every click). Fixed height sidesteps it entirely. */
.ready-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--space-4);
}

.ready-grid__streak {
  grid-column: 1 / 3;
  grid-row: 1;
  align-self: center;
}

.bento-tile--plain {
  clip-path: none;
}

.ready-grid__camera {
  grid-column: 1;
  grid-row: 2 / 4;
  height: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
}

.ready-grid__camera .camera-preview {
  width: auto;
  height: 210px;
  aspect-ratio: 4 / 3;
  flex-shrink: 0;
}

.ready-grid__duration {
  grid-column: 2;
  grid-row: 2;
}

.ready-grid__rounds {
  grid-column: 2;
  grid-row: 3;
}

.ready-grid__media {
  grid-column: 1 / 3;
  grid-row: 4;
}

.screen__actions--end {
  justify-content: flex-end;
}

@media (max-width: 720px) {
  .ready-grid {
    grid-template-columns: 1fr;
  }
  .ready-grid__streak,
  .ready-grid__camera,
  .ready-grid__duration,
  .ready-grid__rounds,
  .ready-grid__media {
    grid-column: 1;
    grid-row: auto;
  }
  .ready-grid__camera {
    height: auto;
  }
  .ready-grid__camera .camera-preview {
    width: 100%;
    height: auto;
  }
}
```

- [ ] **Step 2: Add the stepper component styles**

Append immediately after:

```css
/* ---- Hybrid stepper ([-][input][+] + presets) ---- */
.stepper {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.stepper__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.stepper__btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-pill);
  border: 1.5px solid var(--cream-border);
  background: var(--cream);
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.stepper__btn:hover {
  border-color: var(--amber);
}

.stepper__btn:active {
  transform: scale(0.94);
}

.stepper__input {
  width: 84px;
  text-align: center;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  border: 1.5px solid var(--cream-border);
  border-radius: var(--radius-sm);
  padding: var(--space-2);
  background: var(--cream);
  color: var(--ink);
  font-size: var(--text-sm);
  font-family: inherit;
}

.stepper__presets {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.preset-chip {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--ink-muted);
  border: 1px dashed var(--cream-border);
  border-radius: var(--radius-pill);
  padding: var(--space-1) var(--space-3);
  background: transparent;
  cursor: pointer;
}

.preset-chip:hover {
  border-color: var(--amber);
  color: var(--ink);
}

/* ---- Disclosure ("Pengaturan istirahat") ---- */
.disclosure {
  display: flex;
  flex-direction: column;
}

.disclosure__summary {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background: none;
  border: none;
  padding: var(--space-1) 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--ink-muted);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.disclosure__chevron {
  display: inline-block;
  transition: transform var(--duration-fast) var(--ease-standard);
}

.disclosure__summary--open .disclosure__chevron {
  transform: rotate(90deg);
}

.disclosure__panel {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-top: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px dashed var(--cream-border);
}

.disclosure__panel[hidden] {
  display: none;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/styles/base.css
git commit -m "Add CSS for the Ready screen's bento grid, stepper, and disclosure components"
```

---

### Task 5: Strings for the merged screen

**Files:**
- Modify: `src/ui/strings.ts`

- [ ] **Step 1: Remove now-dead copy**

In `src/ui/strings.ts`, in the `ready` section, remove the `title` and `body` fields (they were the dedicated Ready screen's dynamic heading and intro paragraph - the merged screen uses `framing.title` as its one static heading instead, and drops body copy entirely to fit the no-scroll density budget - see the design spec's Layout section). In the `framing` section, remove `body` and `continueLabel` (the merged screen has one combined "Mulai" button, not a separate "Posisi sudah pas" confirmation step).

Before:
```ts
  framing: {
    title: 'Cek posisi duduk',
    body: 'Pastikan wajahmu masuk ke dalam kotak, dan duduk seperti biasanya kamu belajar.',
    permissionPending: 'Meminta izin kamera...',
    permissionDenied:
      'Izin kamera ditolak. HACHIKO butuh kamera untuk memperhatikan posisi dudukmu. Muat ulang halaman dan izinkan aksesnya ya.',
    permissionError: 'Kamera belum bisa diakses. Coba periksa apakah laptop ini punya kamera yang aktif.',
    continueLabel: 'Posisi sudah pas',
    companionSessionCount: (n: number) => `Kamu sudah ${n} sesi bareng Hachiko.`,
    companionStreak: (days: number) => ` ${days} hari berturut-turut!`,
  },
```

After:
```ts
  framing: {
    title: 'Cek posisi duduk',
    permissionPending: 'Meminta izin kamera...',
    permissionDenied:
      'Izin kamera ditolak. HACHIKO butuh kamera untuk memperhatikan posisi dudukmu. Muat ulang halaman dan izinkan aksesnya ya.',
    permissionError: 'Kamera belum bisa diakses. Coba periksa apakah laptop ini punya kamera yang aktif.',
    companionSessionCount: (n: number) => `Kamu sudah ${n} sesi bareng Hachiko.`,
    companionStreak: (days: number) => ` ${days} hari berturut-turut!`,
  },
```

Before:
```ts
  ready: {
    title: (durationLabel: string) => `Siap fokus ${durationLabel}?`,
    body: 'Hachiko bakal nemenin dari sini. Begitu kamu tekan Mulai, sesi langsung berjalan.',
    durationLabel: 'Pilih lama sesi',
    roundsLabel: 'Berapa putaran sebelum istirahat panjang?',
    roundsChip: (n: number) => `${n} putaran`,
    continueLabel: 'Mulai',
  },
```

After (adds break-settings copy, keeps everything still in use):
```ts
  ready: {
    durationLabel: 'Pilih lama sesi',
    roundsLabel: 'Berapa putaran sebelum istirahat panjang?',
    roundsChip: (n: number) => `${n} putaran`,
    breakSettingsLabel: 'Pengaturan istirahat',
    shortBreakLabel: 'Istirahat pendek',
    longBreakLabel: 'Istirahat panjang',
    continueLabel: 'Mulai',
  },
```

- [ ] **Step 2: Grep for any other usages of the removed fields before proceeding**

Run: `grep -rn "framing\.body\|framing\.continueLabel\|ready\.title\|ready\.body" src/`
Expected: no matches outside `strings.ts` itself (the only call sites were in `framing.ts`/`ready.ts`, both being rewritten/deleted in Tasks 6-7). If this finds a match elsewhere, stop and re-check that call site before continuing - do not silently delete a string still in use.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: FAILS at this point - `framing.ts`, `media.ts`, and the current `ready.ts` still reference the removed fields. This is expected; Tasks 6-7 fix it. Do not treat this as a blocker for committing this step.

- [ ] **Step 4: Commit**

```bash
git add src/ui/strings.ts
git commit -m "Update strings.ts for the merged Ready screen (drop dead copy, add break-settings labels)"
```

---

### Task 6: Rewrite `ready.ts` as the merged screen

**Files:**
- Modify (full rewrite): `src/ui/screens/ready.ts`

**Interfaces:**
- Consumes: `stepper`, `disclosure`, `chipGroup`, `titleWithDoodle`, `actions`, `button`, `cameraDot`, `el`, `screen` from `./components` (2, and existing); `clampDurationMs`, `maxBreakMs`, `WORK_MS`, `WORK_DURATION_OPTIONS_MIN`, `FAST_DEBUG_WORK_MS`, `ROUNDS_PER_SET_OPTIONS`, `DEFAULT_ROUNDS_PER_SET`, `BREAK_MS`, `LONG_BREAK_MS`, `FAST_DEBUG_BREAK_MS`, `FAST_DEBUG_LONG_BREAK_MS`, `BREAK_MAX_RATIO`, `LONG_BREAK_MAX_RATIO`, `DURATION_MIN_MS`, `DURATION_MAX_MS`, `isFastDebugMode` from `../sessionConfig` (1, and existing); `startCamera`, `startPerceptionLoop`, `PerceptionLoopHandle` from `../../perception/camera`; `createFaceLandmarker` from `../../perception/face`; `createObjectDetector` from `../../perception/objects`; `createFaceDetector` from `../../perception/faceBox`; `PerceptionBundle` (type) from `../../perception/bundle`; `deriveCompanionState` from `../../storage/companion`; `listSessions` from `../../storage/sessions`; `Media` (type) from `../../engine/types`
- Produces: `interface ReadySetupResult { bundle: PerceptionBundle; video: HTMLVideoElement; declaredMedia: Media[]; workMs: number; rounds: number; breakMs: number; longBreakMs: number; cameraRect: DOMRect }`, `function renderReady(root: HTMLElement): Promise<ReadySetupResult>`

- [ ] **Step 1: Replace the entire file**

```ts
import { strings, formatDuration } from '../strings'
import {
  actions,
  button,
  cameraDot,
  chipGroup,
  disclosure,
  el,
  screen,
  stepper,
  titleWithDoodle,
} from '../components'
import { startCamera, startPerceptionLoop, type PerceptionLoopHandle } from '../../perception/camera'
import { createFaceLandmarker } from '../../perception/face'
import { createObjectDetector } from '../../perception/objects'
import { createFaceDetector } from '../../perception/faceBox'
import type { PerceptionBundle } from '../../perception/bundle'
import { deriveCompanionState } from '../../storage/companion'
import { listSessions } from '../../storage/sessions'
import type { Media } from '../../engine/types'
import {
  WORK_MS,
  WORK_DURATION_OPTIONS_MIN,
  FAST_DEBUG_WORK_MS,
  ROUNDS_PER_SET_OPTIONS,
  DEFAULT_ROUNDS_PER_SET,
  BREAK_MS,
  LONG_BREAK_MS,
  FAST_DEBUG_BREAK_MS,
  FAST_DEBUG_LONG_BREAK_MS,
  BREAK_MAX_RATIO,
  LONG_BREAK_MAX_RATIO,
  DURATION_MIN_MS,
  DURATION_MAX_MS,
  maxBreakMs,
  isFastDebugMode,
} from '../sessionConfig'

const MEDIA_OPTIONS: { value: Media; labelKey: keyof typeof strings.media.chips }[] = [
  { value: 'laptop', labelKey: 'laptop' },
  { value: 'phone', labelKey: 'phone' },
  { value: 'book', labelKey: 'book' },
  { value: 'paper', labelKey: 'paper' },
  { value: 'mixed', labelKey: 'mixed' },
  { value: 'other', labelKey: 'other' },
]

// Two-tone flame, same "fill from a CSS custom property" rule as every
// Hachiko pose - amber, never red, so it reads as warmth rather than
// urgency.
const FLAME_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18">
    <path d="M12 21c-4.4 0-7-2.8-7-6.5 0-3.2 2-5 3.5-7.5C10 5 10.5 3 12 2c.3 2.5-.5 4-.2 6 .3 2 2.2 2.5 2.2 4.5 0-1.5 1-2 1-3.5 1.5 1.5 3 4 3 6 0 3.7-2.6 6.5-6 6.5Z" fill="var(--amber)" />
    <path d="M12 21c-2.2 0-3.5-1.6-3.5-3.7 0-1.6 1-2.6 1.7-3.8.3.8.2 1.7 1 2.2.1-1 .6-1.4.9-2.2.7 1 1.4 2.2 1.4 3.4 0 2.3-1.3 4.1-1.5 4.1Z" fill="var(--amber-deep)" />
  </svg>
`

/**
 * The same quiet, positive-only "Hachiko remembers you" greeting from
 * the original Framing screen - a pill chip instead of a bare
 * paragraph. The flame only appears once a streak is genuinely
 * building (>=2 days).
 */
function streakChip(sessionCount: number, streakDays: number): HTMLDivElement {
  const s = strings.framing
  let text = s.companionSessionCount(sessionCount)
  const chip = el('div', { class: 'streak-chip ready-grid__streak' })
  if (streakDays >= 2) {
    const flame = el('span', { class: 'streak-chip__flame' })
    flame.innerHTML = FLAME_SVG
    chip.append(flame)
    text += s.companionStreak(streakDays)
  }
  chip.append(el('span', {}, [text]))
  return chip
}

export interface ReadySetupResult {
  bundle: PerceptionBundle
  video: HTMLVideoElement
  declaredMedia: Media[]
  workMs: number
  rounds: number
  breakMs: number
  longBreakMs: number
  /** Where the camera preview sat on screen right before this screen
   * was torn down - Calibration uses this to visually expand into
   * place instead of a plain cut. See src/ui/transition.ts. */
  cameraRect: DOMRect
}

/**
 * The merged camera-check + study-material + duration + rounds screen
 * (2026-09-17 design spec). Replaces the old Framing, Media, and Ready
 * screens - this is the only one of the three that still requests
 * camera permission and builds the PerceptionBundle; everything
 * downstream (Calibration onward) still receives the same `bundle` and
 * `video` by reference as before.
 */
export function renderReady(root: HTMLElement): Promise<ReadySetupResult> {
  return new Promise((resolve) => {
    const s = strings
    const { root: screenEl, content } = screen()

    const status = el('p', { class: 'note' }, [s.framing.permissionPending])
    const preview = el('div', { class: 'camera-preview' })
    const video = el('video', {})
    const targetBox = el('div', { class: 'camera-preview__target' })
    preview.append(video, targetBox)

    const dot = cameraDot(s.common.cameraActive)
    dot.style.visibility = 'hidden'

    const cameraTile = el('div', { class: 'bento-tile bento-tile--plain ready-grid__camera' }, [status, preview, dot])

    let bundle: PerceptionBundle | null = null
    let loop: PerceptionLoopHandle | null = null

    // --- Short/long break steppers (collapsed behind a disclosure) ---
    // Constructed BEFORE the work-duration stepper below: every
    // `stepper()` call invokes its own `onChange` once synchronously
    // during construction (see Task 2's `apply(valueMs)` at the end of
    // the function), and the work stepper's `onChange` calls back into
    // these two immediately - they must already exist by then, or this
    // throws "Cannot access before initialization".
    let breakMs = BREAK_MS
    let longBreakMs = LONG_BREAK_MS
    const shortBreakStepper = stepper({
      label: s.ready.shortBreakLabel,
      initialMs: breakMs,
      minMs: DURATION_MIN_MS,
      maxMs: maxBreakMs(WORK_MS, BREAK_MAX_RATIO),
      presetsMs: [BREAK_MS, ...(isFastDebugMode() ? [FAST_DEBUG_BREAK_MS] : [])],
      onChange: (ms) => {
        breakMs = ms
      },
    })
    const longBreakStepper = stepper({
      label: s.ready.longBreakLabel,
      initialMs: longBreakMs,
      minMs: DURATION_MIN_MS,
      maxMs: maxBreakMs(WORK_MS, LONG_BREAK_MAX_RATIO),
      presetsMs: [LONG_BREAK_MS, ...(isFastDebugMode() ? [FAST_DEBUG_LONG_BREAK_MS] : [])],
      onChange: (ms) => {
        longBreakMs = ms
      },
    })
    const breakSettings = disclosure(s.ready.breakSettingsLabel, [shortBreakStepper.element, longBreakStepper.element])

    // --- Work duration stepper ---
    let workMs = WORK_MS
    const workPresets = [
      ...WORK_DURATION_OPTIONS_MIN.map((min) => min * 60_000),
      ...(isFastDebugMode() ? [FAST_DEBUG_WORK_MS] : []),
    ]
    const workStepper = stepper({
      label: s.ready.durationLabel,
      initialMs: workMs,
      minMs: DURATION_MIN_MS,
      maxMs: DURATION_MAX_MS,
      presetsMs: workPresets,
      onChange: (ms) => {
        workMs = ms
        shortBreakStepper.setMax(maxBreakMs(workMs, BREAK_MAX_RATIO))
        longBreakStepper.setMax(maxBreakMs(workMs, LONG_BREAK_MAX_RATIO))
      },
    })

    // --- Rounds-per-set (unchanged preset-chip picker, just repositioned) ---
    let selectedRounds = DEFAULT_ROUNDS_PER_SET
    const { element: roundsChips } = chipGroup(
      ROUNDS_PER_SET_OPTIONS.map((n) => ({ value: String(n), label: s.ready.roundsChip(n) })),
      {
        multi: false,
        initial: String(selectedRounds),
        onChange: (values) => {
          selectedRounds = values.length > 0 ? Number(values[0]) : DEFAULT_ROUNDS_PER_SET
        },
      },
    )
    const roundsTile = el('div', { class: 'bento-tile bento-tile--sage-tint ready-grid__rounds' }, [
      el('span', { class: 'metric__label' }, [s.ready.roundsLabel]),
      roundsChips,
      breakSettings.element,
    ])

    // --- Media (unchanged multi-select chips + inline required error) ---
    const mediaError = el('p', { class: 'field__error' }, [''])
    mediaError.style.display = 'none'
    const { element: mediaChips, getSelected: getSelectedMedia } = chipGroup(
      MEDIA_OPTIONS.map((o) => ({ value: o.value, label: s.media.chips[o.labelKey] })),
      { multi: true },
    )
    const mediaTile = el('div', { class: 'bento-tile ready-grid__media' }, [
      el('span', { class: 'metric__label' }, [s.media.title]),
      mediaChips,
      mediaError,
    ])

    const durationTile = el('div', { class: 'bento-tile bento-tile--amber-tint ready-grid__duration' }, [
      workStepper.element,
    ])

    // --- Submit: hard-gated on camera+face (button stays disabled until
    // then, matching the old Framing screen's gate exactly); media is a
    // soft gate (inline error on click, matching the old Media screen). ---
    const continueBtn = button(
      s.ready.continueLabel,
      () => {
        if (!bundle) return
        const declaredMedia = getSelectedMedia() as Media[]
        if (declaredMedia.length === 0) {
          mediaError.textContent = s.media.requiredError
          mediaError.style.display = 'block'
          return
        }
        loop?.stop()
        const cameraRect = preview.getBoundingClientRect()
        root.replaceChildren()
        resolve({ bundle, video, declaredMedia, workMs, rounds: selectedRounds, breakMs, longBreakMs, cameraRect })
      },
      { disabled: true },
    )

    const grid = el('div', { class: 'ready-grid' }, [cameraTile, durationTile, roundsTile, mediaTile])

    const ctaRow = actions(continueBtn)
    ctaRow.classList.add('screen__actions--end')
    content.append(titleWithDoodle(s.framing.title), grid, ctaRow)

    root.replaceChildren(screenEl)

    // The streak chip is prepended into the grid (not built in above)
    // once we know whether it should show at all. If it doesn't, the
    // grid simply has an empty row 1 rather than reflowing everything
    // else - that only ever happens on a student's very first-ever
    // session.

    const companion = deriveCompanionState(listSessions(), Date.now())
    if (companion.totalSessions >= 1) {
      grid.prepend(streakChip(companion.totalSessions, companion.currentStreakDays))
    }

    void (async () => {
      try {
        const camera = await startCamera(video)
        dot.style.visibility = 'visible'
        status.textContent = ''
        status.style.display = 'none'

        const [faceLandmarker, objectDetector, faceDetector] = await Promise.all([
          createFaceLandmarker(),
          createObjectDetector(),
          createFaceDetector(),
        ])
        bundle = { camera, faceLandmarker, objectDetector, faceDetector }

        // Same slower-than-default rate as the old Framing screen: this
        // screen only checks faceFound to enable the button, nothing
        // time-sensitive, and detectForVideo runs synchronously - at the
        // default rate its periodic blocking was visible as stutter in
        // the live preview.
        loop = startPerceptionLoop(video, faceLandmarker, objectDetector, (tick) => {
          if (tick.face) continueBtn.disabled = !tick.face.faceFound
        }, 1000)
      } catch (err) {
        status.style.display = ''
        status.textContent =
          err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
            ? s.framing.permissionDenied
            : s.framing.permissionError
        console.error(err)
      }
    })()
  })
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: still fails - `framing.ts` and `media.ts` (Task 7 deletes them) and `main.ts`/`calibration.ts`/`session.ts` (Tasks 8-10) haven't been updated yet. Confirm the *only* remaining errors are in those files, not in `ready.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/ui/screens/ready.ts
git commit -m "Rewrite ready.ts as the merged camera+streak+media+duration+rounds screen"
```

---

### Task 7: Delete the now-absorbed Framing and Media screens

**Files:**
- Delete: `src/ui/screens/framing.ts`
- Delete: `src/ui/screens/media.ts`

- [ ] **Step 1: Confirm nothing else imports them**

Run: `grep -rn "from '.*screens/framing'\|from '.*screens/media'" src/`
Expected: only `src/main.ts` (fixed in Task 10 - do not fix it here, so the type errors from this deletion clearly point at the one remaining file that needs updating).

- [ ] **Step 2: Delete both files**

```bash
git rm src/ui/screens/framing.ts src/ui/screens/media.ts
```

- [ ] **Step 3: Commit**

```bash
git commit -m "Delete framing.ts and media.ts - fully absorbed into the merged ready.ts"
```

---

### Task 8: Thread the camera-expand transition into Calibration

**Files:**
- Modify: `src/ui/screens/calibration.ts`

**Interfaces:**
- Consumes: `flipExpand` from `../transition` (Task 3)
- Produces: `renderCalibration(root: HTMLElement, video: HTMLVideoElement, bundle: PerceptionBundle, fromRect: DOMRect): Promise<{ cone: Cone }>` (signature gains one parameter; return type unchanged)

- [ ] **Step 1: Add the import**

At the top of `src/ui/screens/calibration.ts`:

```ts
import { flipExpand } from '../transition'
```

- [ ] **Step 2: Add the parameter and call the transition**

Change:
```ts
export function renderCalibration(
  root: HTMLElement,
  video: HTMLVideoElement,
  bundle: PerceptionBundle,
): Promise<{ cone: Cone }> {
```
to:
```ts
export function renderCalibration(
  root: HTMLElement,
  video: HTMLVideoElement,
  bundle: PerceptionBundle,
  fromRect: DOMRect,
): Promise<{ cone: Cone }> {
```

Then, immediately after the existing `root.replaceChildren(screenEl)` line in this function (right after the `content.append(title(s.title), status, ring.element, countdown, preview, actions(continueBtn))` block), add:

```ts
    flipExpand(preview, fromRect)
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: the `renderCalibration` call site error moves to `main.ts` (fixed in Task 10) - confirm `calibration.ts` itself has no errors.

- [ ] **Step 4: Commit**

```bash
git add src/ui/screens/calibration.ts
git commit -m "Calibration screen expands the camera preview in from its prior on-screen position"
```

---

### Task 9: Make break durations parameters instead of fixed constants

**Files:**
- Modify: `src/ui/screens/session.ts`

**Interfaces:**
- Produces: `runSession(root, video, bundle, cone, declaredMedia, workMs, roundsPerSet, breakMs: number, longBreakMs: number): Promise<void>` (two new trailing parameters); `renderBreak` (internal, not exported) gains two parameters

- [ ] **Step 1: Update the sessionConfig import**

`BREAK_MS` and `LONG_BREAK_MS` are only read in `renderBreak` today, which is about to take them as parameters instead - remove both from the import list. `FAST_DEBUG_BREAK_MS`/`FAST_DEBUG_LONG_BREAK_MS` stay (fastdebug still overrides unconditionally).

Change:
```ts
import {
  BREAK_ABANDON_MS,
  BREAK_MS,
  EARLY_STOP_RATIO,
  EXTENSION_MS,
  FAST_DEBUG_BREAK_MS,
  FAST_DEBUG_LONG_BREAK_MS,
  LONG_BREAK_MS,
  NUDGE_AUTO_DISMISS_MS,
  STIRRING_RATIO,
  isFastDebugMode,
} from '../sessionConfig'
```
to:
```ts
import {
  BREAK_ABANDON_MS,
  EARLY_STOP_RATIO,
  EXTENSION_MS,
  FAST_DEBUG_BREAK_MS,
  FAST_DEBUG_LONG_BREAK_MS,
  NUDGE_AUTO_DISMISS_MS,
  STIRRING_RATIO,
  isFastDebugMode,
} from '../sessionConfig'
```

- [ ] **Step 2: Update `renderBreak`'s signature and body**

Change:
```ts
function renderBreak(root: HTMLElement, isLongBreak: boolean): Promise<{ continueSession: boolean }> {
  return new Promise((resolve) => {
    const s = strings.session
    const { root: screenEl, content } = screen()

    const breakMs = isLongBreak
      ? isFastDebugMode()
        ? FAST_DEBUG_LONG_BREAK_MS
        : LONG_BREAK_MS
      : isFastDebugMode()
        ? FAST_DEBUG_BREAK_MS
        : BREAK_MS
```
to:
```ts
function renderBreak(
  root: HTMLElement,
  isLongBreak: boolean,
  shortBreakMs: number,
  longBreakMs: number,
): Promise<{ continueSession: boolean }> {
  return new Promise((resolve) => {
    const s = strings.session
    const { root: screenEl, content } = screen()

    const breakMs = isLongBreak
      ? isFastDebugMode()
        ? FAST_DEBUG_LONG_BREAK_MS
        : longBreakMs
      : isFastDebugMode()
        ? FAST_DEBUG_BREAK_MS
        : shortBreakMs
```

(The local `const breakMs` inside the function body is unrelated to the new `longBreakMs`/`shortBreakMs` parameters and keeps its name - only its right-hand side changes.)

- [ ] **Step 3: Update `runSession`'s signature and its call to `renderBreak`**

Change:
```ts
export async function runSession(
  root: HTMLElement,
  video: HTMLVideoElement,
  bundle: PerceptionBundle,
  cone: Cone,
  declaredMedia: Media[],
  workMs: number,
  roundsPerSet: number,
): Promise<void> {
```
to:
```ts
export async function runSession(
  root: HTMLElement,
  video: HTMLVideoElement,
  bundle: PerceptionBundle,
  cone: Cone,
  declaredMedia: Media[],
  workMs: number,
  roundsPerSet: number,
  breakMs: number,
  longBreakMs: number,
): Promise<void> {
```

Change:
```ts
      const { continueSession } = await renderBreak(root, isLongBreak)
```
to:
```ts
      const { continueSession } = await renderBreak(root, isLongBreak, breakMs, longBreakMs)
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: the `runSession` call site error moves to `main.ts` (fixed in Task 10) - confirm `session.ts` itself has no errors.

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: PASS (this file has no dedicated test suite today, but confirm nothing else broke)

- [ ] **Step 6: Commit**

```bash
git add src/ui/screens/session.ts
git commit -m "runSession/renderBreak take break durations as parameters instead of fixed constants"
```

---

### Task 10: Wire it all together in `main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Update the imports**

Change:
```ts
import { renderFraming } from './ui/screens/framing'
import { renderCalibration } from './ui/screens/calibration'
import { renderMedia } from './ui/screens/media'
import { renderReady } from './ui/screens/ready'
import { runSession } from './ui/screens/session'
```
to:
```ts
import { renderCalibration } from './ui/screens/calibration'
import { renderReady } from './ui/screens/ready'
import { runSession } from './ui/screens/session'
```

- [ ] **Step 2: Update the flow inside `main()`**

Change:
```ts
  const { bundle, video } = await renderFraming(root)
  const { cone } = await renderCalibration(root, video, bundle)
  const { declaredMedia } = await renderMedia(root, video)
  const { workMs, rounds } = await renderReady(root, video)

  // runSession now owns the whole multi-cycle loop (Work -> Break ->
  // Work -> Break -> ...) internally, asking "Fokus lagi?" on its own
  // Break screen, and stops the camera itself once the student is done.
  await runSession(root, video, bundle, cone, declaredMedia, workMs, rounds)
```
to:
```ts
  const { bundle, video, declaredMedia, workMs, rounds, breakMs, longBreakMs, cameraRect } = await renderReady(root)
  const { cone } = await renderCalibration(root, video, bundle, cameraRect)

  // runSession now owns the whole multi-cycle loop (Work -> Break ->
  // Work -> Break -> ...) internally, asking "Fokus lagi?" on its own
  // Break screen, and stops the camera itself once the student is done.
  await runSession(root, video, bundle, cone, declaredMedia, workMs, rounds, breakMs, longBreakMs)
```

- [ ] **Step 3: Update the file-level comment**

The doc comment above `main()` currently says:

```ts
/**
 * The whole app is one linear flow, orchestrated here. Each screen
 * resolves a promise with what it collected; nothing routes by URL
 * except the `?debug` escape hatch to the perception spike's readout
 * (BUILD_PROMPTS P1's week-1 gate).
 *
 * Onboarding (S1/S2) runs once - "no accounts" means no login, not
 * re-entering your name and consent every time the page opens - and is
 * skipped on return visits once a profile exists in localStorage.
 */
```

Replace it with:

```ts
/**
 * The whole app is one linear flow, orchestrated here. Each screen
 * resolves a promise with what it collected; nothing routes by URL
 * except the `?debug` escape hatch to the perception spike's readout
 * (BUILD_PROMPTS P1's week-1 gate).
 *
 * Onboarding (S1/S2) runs once - "no accounts" means no login, not
 * re-entering your name and consent every time the page opens - and is
 * skipped on return visits once a profile exists in localStorage.
 *
 * renderReady (2026-09-17 merge) absorbs what used to be three
 * sequential screens (Framing, Media, Ready) into one - it's the one
 * that requests camera permission and returns the PerceptionBundle
 * every screen after it shares by reference. Its `cameraRect` return
 * value lets Calibration visually expand the camera preview into place
 * instead of a plain screen cut - see src/ui/transition.ts.
 */
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in the project

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "Wire the merged Ready screen into main.ts's flow"
```

---

### Task 11: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Final automated check**

Run: `npx tsc --noEmit && npm test`
Expected: both clean/passing

- [ ] **Step 2: Start the dev server and check the port it picked**

```bash
npm run dev > /tmp/hachiko-ready-merge.log 2>&1 &
sleep 2
tail -20 /tmp/hachiko-ready-merge.log
```

Note the `Local:` URL it prints (5173 if free, otherwise the next open port).

- [ ] **Step 3: Manually drive the flow in a browser**

Open the printed URL. If a profile already exists from previous testing, either use the "Hapus profil" option on the end screen first, or clear `localStorage` for the origin, so Welcome/Consent run and you reach the merged Ready screen fresh. Confirm:

- The merged screen fits without scrolling at a normal laptop window size (camera left, streak on top, duration+rounds stacked right, media below, "Mulai" bottom-right).
- Clicking the stepper's `-`/`+` does **not** visibly nudge the camera box's size (the bug found during design).
- Holding `-`/`+` down repeats after ~600ms.
- Typing a value like `999` into the duration input and blurring clamps it to 60 menit; typing `abc` reverts to the last valid value.
- Opening "Pengaturan istirahat" reveals the short/long break steppers at 5/15 menit; reducing work duration low enough (e.g. to 2 menit) clamps both break steppers down live.
- Tapping "Mulai" with no media selected shows the inline error and does not advance; selecting one and tapping again advances.
- The camera preview visually grows from its Ready-screen position into the full Calibration screen instead of a hard cut. Toggling "reduce motion" in OS accessibility settings and repeating the flow shows an instant cut instead (no animation).
- `?fastdebug` in the URL still shows the 30-second work preset and the whole multi-cycle loop still works end to end (Work → Break → "Fokus lagi?" → Work...).

- [ ] **Step 4: Stop the dev server**

```bash
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill
# repeat with whatever port Step 2 actually printed, if different
```

- [ ] **Step 5: Final commit (if Step 3 required any fixes)**

If manual testing in Step 3 surfaced anything needing a fix, make the fix, re-run Step 1, then:

```bash
git add -A
git commit -m "Fix issues found during manual verification of the Ready screen merge"
```

If nothing needed fixing, this task ends at Step 4 with no commit.
