# Session Popout Widget Design

**Status:** ready for implementation planning. Depends on nothing else landing first. Companion fix (the duration-string format used in reports) already landed separately in `src/ui/strings.ts`'s `formatDuration` — unrelated code path, not a dependency.

## Problem

The Work-phase session screen (`runWorkPhase` in `src/ui/screens/session.ts`) only exists inside the browser tab. A student who alt-tabs to another app, or has the browser window covered/minimized, loses all visibility into the countdown, the progress bar, and Hachiko's pose — exactly the ambient, low-pressure signal the whole product is built around. The ask: let those three elements float in a small always-on-top window that survives the browser being minimized or covered by other apps, without turning this into a second, non-browser application.

**Scope correction from the brainstorm chat:** I originally floated "work or break phase." `renderBreak` has neither a progress bar nor a Hachiko element — just a bare `setInterval` countdown (`session.ts:739-804`). There's no "timer + progress + dog" combo to mirror during Break, so this spec covers Work phase only. Break's countdown is unaffected.

## Why Document Picture-in-Picture, and its one hard limit

`documentPictureInPicture.requestWindow()` (Chrome/Edge) opens a real, separate, always-on-top OS window that a page can put arbitrary DOM into. It survives minimizing the main browser window and switching to entirely different apps — this is the same mechanism video sites use for their floating video controls. It does **not** survive the browser being fully quit; the popout window is owned by the tab that opened it and closes with it. That's an accepted, permanent limitation (confirmed with the user during brainstorming), not a bug to work around later.

No new dependency: `documentPictureInPicture` is a native browser API, feature-detected and absent from Firefox/Safari today. Unsupported browsers simply never see the popout button — pure progressive enhancement, zero behavior change for them.

One detail that de-risks this working at all: `src/perception/camera.ts` already uses `video.requestVideoFrameCallback()` instead of `requestAnimationFrame()` specifically because rAF throttles in backgrounded tabs (see that file's own comments, and CLAUDE.md's explicit ban on rAF for this exact reason). The detection loop this widget's data rides on was already built to keep running while the tab is hidden behind other windows — the popout doesn't need to solve that problem, it just needs to read the numbers that loop is already producing.

## 1. New module: `src/ui/popout.ts`

A small controller owning the popout window's lifecycle and its three display nodes. It creates its own fresh DOM (not a move/reparent of the main screen's elements) so the main screen keeps rendering normally whether or not the window is open — no visibility toggling, no risk of losing the main screen's live nodes if `close()` fires unexpectedly.

```ts
import type { FocusState } from '../engine/types'
import { HachikoView } from './hachiko'

export interface SessionPopout {
  readonly supported: boolean
  isOpen(): boolean
  open(): Promise<void>
  close(): void
  sync(timerText: string, progressFraction: number, state: FocusState, stirring: boolean): void
}

const POPOUT_WIDTH = 240
const POPOUT_HEIGHT = 280

const POPOUT_STYLE = `
  :root { color-scheme: dark; }
  body {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 16px;
    background: #14110F;
    font-family: system-ui, sans-serif;
    color: #FDF8F3;
  }
  .popout__timer { font-size: 28px; font-variant-numeric: tabular-nums; margin: 0; }
  .popout__progress { width: 100%; height: 6px; border-radius: 3px; background: #2B2622; overflow: hidden; }
  .popout__progress-fill { height: 100%; background: #FF7700; width: 0%; }
  .hachiko-pose { width: 96px; height: 96px; object-fit: contain; }
`

export function createSessionPopout(): SessionPopout {
  const supported = 'documentPictureInPicture' in window
  let pipWindow: Window | null = null
  let timerEl: HTMLParagraphElement | null = null
  let progressFill: HTMLDivElement | null = null
  let hachiko: HachikoView | null = null

  async function open(): Promise<void> {
    if (!supported || pipWindow) return
    // documentPictureInPicture is only defined when `supported` is true.
    const win = await (window as any).documentPictureInPicture.requestWindow({
      width: POPOUT_WIDTH,
      height: POPOUT_HEIGHT,
    })
    pipWindow = win
    const style = win.document.createElement('style')
    style.textContent = POPOUT_STYLE
    win.document.head.append(style)

    timerEl = win.document.createElement('p')
    timerEl.className = 'popout__timer'
    const progressFillEl = win.document.createElement('div')
    progressFillEl.className = 'popout__progress-fill'
    progressFill = progressFillEl
    const progressBar = win.document.createElement('div')
    progressBar.className = 'popout__progress'
    progressBar.append(progressFillEl)

    hachiko = new HachikoView()
    win.document.body.append(hachiko.element, timerEl, progressBar)

    win.addEventListener('pagehide', () => {
      pipWindow = null
      timerEl = null
      progressFill = null
      hachiko = null
    })
  }

  function close(): void {
    pipWindow?.close()
  }

  function sync(timerText: string, progressFraction: number, state: FocusState, stirring: boolean): void {
    if (!pipWindow) return
    if (timerEl) timerEl.textContent = timerText
    if (progressFill) progressFill.style.width = `${Math.min(1, Math.max(0, progressFraction)) * 100}%`
    hachiko?.setState(state, stirring)
  }

  return { supported, isOpen: () => pipWindow !== null, open, close, sync }
}
```

Notes on the sketch above:
- `HachikoView` (`src/ui/hachiko.ts`) is reused as-is, unmodified — creating a second instance and appending its `.element` into `pipWindow.document` works because the HTML spec's node-insertion algorithm auto-adopts a node into the target document when it's appended cross-document; no manual `document.adoptNode()` call needed, no fork of the pose/state-mapping logic.
- `documentPictureInPicture` has no shipped TypeScript DOM lib types yet in this project's TS target, hence the narrow, contained `as any` on the one line that calls `requestWindow` — everything else in the module is fully typed.
- The inline `POPOUT_STYLE` hardcodes the handful of token values it needs (`--night`, `--ink`, `--amber`, `--cream`) as literal hex, rather than linking the app's real stylesheet. The popout is a separate `Window`/`Document` that doesn't inherit the opener's CSS, and this widget only needs ~10 lines of styling — inlining is simpler and more robust than coupling to Vite's build-time asset paths (dev vs. prod URLs differ), at the cost of the palette drifting out of sync if `tokens.css` changes later. Acceptable for a widget this small.

## 2. Wiring into `runWorkPhase`

Three touch points, all inside the existing function (`src/ui/screens/session.ts`):

**a. Track last-known state, for the popout's initial sync on open.** The tick handler already computes `out.state` and `stirring` locally (`session.ts:669-675`) but nothing persists them between ticks today. Add two variables in `runWorkPhase`'s closure, declared alongside `remainingMs` near the top of the function: `let lastKnownState: FocusState = 'FOKUS'` and `let lastKnownStirring = false`.

**b. Create the controller and a toggle button**, alongside the existing `hachiko`/`timerEl`/`progressFill` declarations (`session.ts:362-368`):
```ts
const popout = createSessionPopout()
const popoutBtn = popout.supported
  ? button(s.popoutLabel, async () => {
      if (popout.isOpen()) {
        popout.close()
      } else {
        await popout.open()
        popout.sync(timerEl.textContent ?? '', 1 - remainingMs / totalMs, lastKnownState, lastKnownStirring)
      }
    })
  : null
```
`popoutBtn` is only appended into `sessionWrap`'s controls (`session.ts:459`, alongside `jedaBtn`/`selesaiBtn`) when non-null — unsupported browsers get the exact same DOM as today. The click handler calls `popout.open()` directly inside the event listener (not after an intervening `await` of anything else), since `requestWindow()` requires transient user activation.

**c. Feed the popout from the existing per-frame tick** (`session.ts:671-675`), immediately after the three lines it already mirrors:
```ts
timerEl.textContent = formatTimer(remainingMs)
progressFill.style.width = `${Math.min(1, Math.max(0, 1 - remainingMs / totalMs)) * 100}%`
stateLabel.textContent = s.stateLabels[out.state]
if (mentorState) mentorState.textContent = s.stateLabels[out.state]
hachiko.setState(out.state, stirring)
lastKnownState = out.state
lastKnownStirring = stirring
popout.sync(timerEl.textContent, 1 - remainingMs / totalMs, out.state, stirring)
```
`sync()` is a no-op when the window isn't open, so this costs nothing on the common path.

**d. Clean up on phase exit.** Wherever `runWorkPhase`'s promise resolves (work finishes, "Selesai" confirmed, etc.), call `popout.close()` so a popout never survives into the Break screen or Session Card with stale content.

## 3. Strings

One new label in `strings.ts`'s `session` block, e.g. `popoutLabel: 'Apungkan Hachiko'` — casual register, consistent with the rest of the session screen's copy. Exact wording is a copy detail, not a design decision; flag for review during implementation rather than bikeshedding here.

## Global Constraints

- No new npm dependency — `documentPictureInPicture` is a native, unprefixed browser API.
- No network calls — everything here is local DOM/window manipulation.
- No camera frames touch this code path at all — the popout only ever receives `FocusState` + a boolean + two display strings, never `Frame`/pixel data.
- `src/engine/` untouched — this is presentation-layer only, reading `EngineOutput` the tick handler already has.
- No red anywhere — `POPOUT_STYLE`'s hardcoded colors are literal copies of existing token values, none of them the excluded "Inferno" red.
- Plain DOM, no framework.

## Testing

- `createSessionPopout()` in an environment without `documentPictureInPicture` (the default in this project's jsdom-based vitest setup) reports `supported === false`, and `open()`/`sync()`/`close()` are all safe no-ops — this is directly testable without mocking the API.
- `sync()` before `open()` (or after `close()`/a `pagehide`) must not throw — testable by calling it against a fresh, never-opened controller.
- The `runWorkPhase` wiring (button only rendered when `popout.supported`, `sync()` called alongside the existing three tick-handler lines) is DOM plumbing fed by data the existing tests around `runWorkPhase` already exercise indirectly; no new engine tests needed.
- Same standing caveat as prior UI passes in this codebase: no browser-automation tool is in this project's dependency allowlist, so the actual floating-window behavior (does it really stay on top when minimized, does Hachiko's pose genuinely update while the tab is hidden) can't be verified by this session — flag for the user's own manual check in Chrome/Edge.

## Out of scope

- Break phase — no progress bar or Hachiko exists there today; not extending this spec to add them (that would be new scope, not wiring up existing UI).
- Any UI for the "browser fully closed" case — explicitly accepted as unsupported (see "hard limit" above).
- Syncing the popout's Hachiko pose transition animation (`hachiko-pose--enter` spring-in class, `hachiko.ts:146-156`) — `HachikoView.setState()` already does this for free since the popout reuses the same class unmodified.
- A settings toggle to auto-open the popout at session start — browser security requires a direct user gesture to call `requestWindow()`, so there is no "automatic" version of this; the button is the only entry point.
