/**
 * Pomodoro durations, in one place so the 2-minute demo build (PRD §15.2)
 * is a one-line change. Swap WORK_MS to `2 * 60_000` for the demo build;
 * leave BREAK_MS as-is or shorten it too if the stage slot is tight.
 */
export const WORK_MS = 25 * 60_000
export const BREAK_MS = 5 * 60_000

/**
 * Preset work durations offered on the Ready screen (minutes). The
 * default is WORK_MS (25 min); the selection is in-memory only and
 * reused across "Ulangi sesi" without re-showing Ready.
 */
export const WORK_DURATION_OPTIONS_MIN = [15, 25, 50]

/**
 * Adaptive pacing thresholds (from the ADHD-focused brainstorming pass).
 * The app only ever OFFERS an early break or an extension - it never
 * shortens or lengthens the timer on its own. See src/ui/pacing.ts for
 * the pure decision functions these feed.
 */

// Don't offer an early break before this share of the block has elapsed,
// so a rough first minute can't trigger it.
export const EARLY_BREAK_MIN_ELAPSED_RATIO = 1 / 3

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
