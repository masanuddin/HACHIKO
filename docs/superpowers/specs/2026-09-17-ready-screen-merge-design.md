# Ready screen merge: camera + streak + media + duration + rounds on one page

Status: approved design, not yet implemented (paused mid-brainstorm for
the mascot-asset integration work, which shipped first).

## Why

Onboarding before a session currently runs four screens back to back on
a return visit (Framing → Calibration → Media → Ready), five on a first
visit (+ Welcome, Consent). The goal here is to cut that down by merging
Framing (camera framing check, "Cek posisi duduk"), Media (declared
study materials), and Ready (work duration + rounds-per-set) into a
single non-scrolling screen. Calibration stays its own screen
immediately after - it needs the full viewport for the spotlight
overlay and 15s countdown - but the camera visually expands into it
instead of a plain cut, so the transition doesn't feel like the app
lost track of what was just on screen.

Screens *not* touched by this spec: Welcome, Consent (still separate,
first-visit only), Calibration (layout unchanged, only how it's entered
changes), Clarify, the Session (night, focus) screen's actual
`FocusEngine`/`HachikoView` wiring, Break screen's UI (only the break
*durations* it reads become configurable, not its own layout).

## Layout

Confirmed via the visual-companion mockup (`ready-merge-v3-fixed.html`
in `.superpowers/brainstorm/`):

```
┌─────────────────────────────────────────────┐
│  streak chip (full width)                    │
├───────────────────────────┬───────────────────┤
│                           │ Pilih lama sesi   │
│   camera preview          │ [-] 25 menit [+]  │
│   (landscape, upright,    │ 15 / 25 / 50      │
│   NOT tilted/torn-edge -  ├───────────────────┤
│   functional geometry)    │ Berapa putaran    │
│                           │ [1] [2] [3] [4]   │
│                           │ ▸ Pengaturan       │
│                           │   istirahat        │
├───────────────────────────┴───────────────────┤
│  media chips (full width, multi-select)       │
├───────────────────────────────────────────────┤
│                                       [Mulai]  │
└─────────────────────────────────────────────┘
```

- Camera tile: **fixed pixel height**, not `aspect-ratio` derived from
  its spanned grid rows. The mockup hit a real bug where deriving the
  camera's height from two `auto`-sized rows created a feedback loop -
  any relayout in the stepper tiles (even a text-width change from
  clicking +/-) nudged the camera's computed size on every click. Fixed
  height decouples it entirely.
- "Pengaturan istirahat" (break settings) is a collapsed disclosure,
  closed by default, holding the short-break and long-break duration
  steppers. Closed-by-default keeps the common case (just pick a
  duration and go) from getting more crowded than the current app.
- No `mascotPeek()` on this screen - there wasn't room for it in the
  approved layout, and the live camera feed already gives the screen
  presence the mascot peek exists to provide elsewhere.
- Mobile (<768px per the codebase's existing breakpoint convention):
  camera tile and the two disclosure fields collapse to full width,
  stacked; media chips already wrap. The "no scrolling" goal is a
  laptop-viewport target (this app's actual use case - a webcam on a
  laptop during homework); on a genuinely narrow phone-height viewport,
  falling back to a normal scrolling column is an acceptable, expected
  exception rather than something to force-fit.

## New component: Hybrid Stepper

`[-] [input] [+]` plus a row of preset buttons. Used for work duration,
short-break duration, and long-break duration. **Not** used for
rounds-per-set - that stays the existing simple preset-chip picker
(`ROUNDS_PER_SET_OPTIONS = [1,2,3,4]`, unchanged), since a free-typed
number for "how many rounds before a long break" doesn't have a
sensible generalization once you go past a handful of presets (see
"Algorithm notes" below for why this was explicitly decided against).

```ts
// src/ui/components.ts
export function stepper(opts: {
  label: string
  valueMs: number
  minMs: number
  maxMs: number
  presetsMin: number[]
  onChange: (ms: number) => void
}): { element: HTMLDivElement; setValue: (ms: number) => void; setMax: (maxMs: number) => void }
```

- `-`/`+` buttons increment/decrement by 1 minute; held down (pointerdown
  + a repeat interval, released on pointerup/pointerleave) auto-repeats,
  accelerating after ~600ms - plain `setInterval`/`setTimeout`, no new
  dependency.
- The input is `inputmode="numeric"` (numeric keyboard on mobile,
  plain text input on desktop - no `<input type="number">` since that
  brings native spinner UI we don't want next to our own buttons).
- On blur or Enter: parse the typed value, clamp to `[minMs/60000,
  maxMs/60000]`, round to the nearest whole minute, discard non-numeric
  input entirely (revert to the last valid value rather than guessing
  intent from garbage input).
- Preset buttons call `onChange` directly with that preset's value.
- `setMax` exists so the break-duration steppers can have their ceiling
  recomputed live as the work-duration stepper changes (see Validation).

## Validation

- Work duration: 1-60 minutes, presets 15/25/50 (matches
  `WORK_DURATION_OPTIONS_MIN` today).
- Short-break duration: 1-60 minutes **and** ≤ 50% of the current work
  duration, preset 5 (matches `BREAK_MS` today).
- Long-break duration: 1-60 minutes **and** ≤ 66% (2/3) of the current
  work duration, preset 15 (matches `LONG_BREAK_MS` today).
- The break steppers' effective max is `min(60, workMinutes * ratio)`,
  recomputed on every work-duration change via `setMax`. If the
  currently-set break value now exceeds the new max, clamp it down
  immediately (silent clamp, no error text - this is a live constraint
  following the work duration, not a mistake the student made).
- Today's defaults (5 / 15 against a 25-minute default work duration)
  already satisfy both ratios (20% and 60%), so no default-value
  changes are needed - only the *ceiling* is new.
- Media: unchanged - at least one chip required, same inline
  `requiredError` text as today, shown near the media tile.

## Camera-expand transition (Ready → Calibration)

The `<video>` element is already passed by reference across every
screen in this flow (kept attached to the DOM the whole time so
`requestVideoFrameCallback` never stalls - see the existing comments in
`media.ts`/`ready.ts`). That means a FLIP transition is possible without
touching the perception loop: the live feed never stops, only the box
around it visually grows.

```ts
// src/ui/transition.ts (new, small, single-purpose)
export function flipExpand(el: HTMLElement, fromRect: DOMRect): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const toRect = el.getBoundingClientRect()
  const dx = fromRect.left - toRect.left
  const dy = fromRect.top - toRect.top
  const sx = fromRect.width / toRect.width
  const sy = fromRect.height / toRect.height
  el.style.transformOrigin = 'top left'
  el.style.transition = 'none'
  el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
  el.getBoundingClientRect() // force reflow before transitioning
  requestAnimationFrame(() => {
    el.style.transition = `transform var(--duration-slow) var(--ease-spring)`
    el.style.transform = 'none'
  })
  el.addEventListener('transitionend', () => {
    el.style.transition = ''
    el.style.transformOrigin = ''
  }, { once: true })
}
```

- The merged Ready screen captures `cameraPreviewEl.getBoundingClientRect()`
  right before resolving (before `root.replaceChildren()` clears it) and
  includes it in its resolved value.
- `main.ts` passes that rect into `renderCalibration`, which calls
  `flipExpand(preview, fromRect)` right after mounting its own
  `.camera-preview` element.
- Reduced motion: no-op, preview just appears at full size immediately
  - same collapse-to-instant rule as every other animation in this
    codebase.
- This is the single highest-uncertainty piece of this spec (the first
  cross-screen shared-element transition in the codebase). If it turns
  out janky in practice (e.g. the video's `object-fit: cover` cropping
  shifts oddly mid-scale), the fallback is a plain crossfade
  (opacity 0→1 on the new preview, no transform) - acceptable to drop
  down to during implementation if the FLIP version doesn't hold up,
  without changing anything else in this spec.

## Algorithm notes: rounds-per-set and break duration (no changes)

Worth stating explicitly since this spec went through several wrong
turns before landing here: **the long-break placement logic is
unchanged.** It's still `cycleInSet >= roundsPerSet` in
`runSession` (session.ts), which already matches the real, verified
classic Pomodoro Technique (long break after every 4th round, repeating
- confirmed via web search mid-brainstorm) when `roundsPerSet` is left
at its default of 4. Earlier ideas about a fixed total round count
shown in a pre-start alert, or a "long break in the middle of the set"
placement, were explored and explicitly abandoned - CLAUDE.md's
documented decision that the multi-cycle loop never commits to an
upfront total stands, unchanged. "Fokus lagi?" keeps asking after every
single break, exactly as it does today.

The only actual change to `runSession`/`renderBreak` is that
`BREAK_MS`/`LONG_BREAK_MS` stop being fixed constants read directly
inside `renderBreak` and become parameters threaded through from the
merged Ready screen's choices (fastdebug mode still overrides both
unconditionally, same as today).

## Files touched

- **New**: `src/ui/screens/ready.ts` (rewritten - absorbs Framing +
  Media + today's Ready into one `renderReady` returning
  `{ bundle, video, declaredMedia, workMs, roundsPerSet, breakMs,
  longBreakMs, cameraRect }`), `src/ui/transition.ts` (the FLIP helper).
- **Deleted**: `src/ui/screens/framing.ts`, `src/ui/screens/media.ts` -
  fully absorbed, not kept around as dead code.
- **Edited**: `main.ts` (one call replaces three; `renderCalibration`
  and `runSession` get new parameters), `session.ts` (`renderBreak`
  takes `breakMs`/`longBreakMs` params instead of importing the
  constants directly), `calibration.ts` (accepts and applies
  `fromRect` via `flipExpand`), `components.ts` (new `stepper()`
  helper), `sessionConfig.ts` (new `BREAK_MAX_RATIO = 0.5`,
  `LONG_BREAK_MAX_RATIO = 2 / 3`, `DURATION_MIN_MIN = 1`,
  `DURATION_MAX_MIN = 60` constants), `tokens.css`/`base.css` (stepper
  component styling, reusing existing chip/button/paper-card tokens -
  no new colors).

## Testing

- `tsc --noEmit`, `npm test` (existing suites plus new unit coverage
  for the stepper's clamping logic and the break-duration ratio caps -
  pure functions, testable without DOM).
- Manual pass via `npm run dev`: confirm the merged screen fits without
  scrolling at a ~720px-tall viewport, the camera-expand transition
  plays once and settles cleanly, reduced-motion collapses it to an
  instant cut, and fastdebug mode (`?fastdebug`) still overrides break
  durations regardless of what was picked.
