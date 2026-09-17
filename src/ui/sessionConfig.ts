/**
 * Pomodoro durations, in one place so the 2-minute demo build (PRD §15.2)
 * is a one-line change. Swap WORK_MS to `2 * 60_000` for the demo build;
 * leave BREAK_MS as-is or shorten it too if the stage slot is tight.
 */
export const WORK_MS = 25 * 60_000
export const BREAK_MS = 5 * 60_000

// Classic-Pomodoro long break: without a cap, the Break screen's
// "Fokus lagi" loop could otherwise repeat forever with only ever a
// short break in between. Every ROUNDS_PER_SET-th break becomes this
// long one instead, then the round count resets for the next set.
export const LONG_BREAK_MS = 15 * 60_000

// Far longer than anyone would plausibly sit on the Break screen while
// still intending to continue - a safety net so a student who walks
// away and never comes back doesn't lose an already-completed cycle's
// data forever, not a nudge shown to them.
export const BREAK_ABANDON_MS = 10 * 60_000

/**
 * Preset work durations offered on the Ready screen (minutes). The
 * default is WORK_MS (25 min); the selection is in-memory only and
 * reused for every cycle within a multi-cycle sitting (the Break
 * screen's loop), without ever re-showing Ready mid-sitting.
 */
export const WORK_DURATION_OPTIONS_MIN = [15, 25, 50]

/**
 * How many work rounds happen before a long break, offered on the Ready
 * screen alongside the duration chips. Default 4 matches the classic
 * Pomodoro technique; the selection is in-memory only, same reuse rule
 * as WORK_DURATION_OPTIONS_MIN above.
 */
export const ROUNDS_PER_SET_OPTIONS = [1, 2, 3, 4]
export const DEFAULT_ROUNDS_PER_SET = 4

/**
 * ?fastdebug in the URL swaps in a 30-second work/break pair on the
 * Ready screen, so the multi-cycle loop can be iterated on without
 * waiting through a real block. Invisible without that query param -
 * never shown or reachable by a student. Checked at call time (not
 * cached) so it always reflects the current URL.
 */
export function isFastDebugMode(): boolean {
  return new URLSearchParams(location.search).has('fastdebug')
}

export const FAST_DEBUG_WORK_MS = 30_000
export const FAST_DEBUG_BREAK_MS = 30_000
export const FAST_DEBUG_LONG_BREAK_MS = 60_000

/**
 * Adaptive pacing thresholds (from the ADHD-focused brainstorming pass).
 * The app only ever OFFERS an early break or an extension - it never
 * shortens or lengthens the timer on its own. See src/ui/pacing.ts for
 * the pure decision functions these feed.
 */

// Don't offer an early break before this share of the block has elapsed,
// so a rough first minute can't trigger it.
export const EARLY_BREAK_MIN_ELAPSED_RATIO = 1 / 3

// Below this share of the block elapsed, "Selesai" is treated as
// stopping well short of the committed time - the confirm card shows a
// neutral (not sad) mascot reaction instead of the plain text-only
// version. Same ratio as EARLY_BREAK_MIN_ELAPSED_RATIO, kept as its own
// named constant since the two checks mean different things.
export const EARLY_STOP_RATIO = 1 / 3

// Share of elapsed time spent in TERALIH/UNCERTAIN/MENGANTUK that counts
// as "this block isn't working right now."
export const EARLY_BREAK_STRUGGLE_RATIO = 0.5

// How long a clean, uninterrupted FOKUS streak right before the timer
// ends has to be before we ask "want to keep going?" instead of just
// cutting the block off mid-flow.
export const EXTENSION_WINDOW_MS = 3 * 60_000

// How much time "Lanjut 10 menit lagi" actually adds.
export const EXTENSION_MS = 10 * 60_000

// Fraction of the engine's own toDistractedMs after which Hachiko's
// stirring pose appears, foreshadowing a possible wake before the engine
// has committed to TERALIH.
export const STIRRING_RATIO = 0.5

// Not shown to the student - the early-break/extension nudges only ever
// offer, never impose (see pacing.ts), so an ignored one silently
// defaults to its declined outcome instead of blocking the session at
// 0:00 forever. Same "silent safety net" style as BREAK_ABANDON_MS.
export const NUDGE_AUTO_DISMISS_MS = 25 * 1000
