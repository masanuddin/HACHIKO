import { strings } from '../strings'
import { actions, body, button, card, el, screen, titleWithDoodle } from '../components'
import type { ClarificationAnswer } from '../../storage/sessions'

// Retunable if the pace feels wrong in practice - not a structural
// constant. Kept short: this is a low-stakes either/or/skip question,
// and "no answer" already resolves to the same benign outcome as Lewati.
const AUTO_SKIP_MS = 10_000

/**
 * The one clarification card per break (PRD §8). Shown only when the
 * caller has already checked there was uncertain time this session; no
 * answer, or "Lewati," leaves those minutes uncertain rather than
 * coercing them into a verdict. Auto-skips after AUTO_SKIP_MS of no
 * interaction, same outcome as tapping Lewati, so a kid who's already
 * mentally moved on isn't stuck here waiting - the countdown is shown,
 * not silent, so nothing jumps unannounced.
 */
export function renderClarify(root: HTMLElement): Promise<ClarificationAnswer | null> {
  return new Promise((resolve) => {
    const s = strings.clarify
    const { root: screenEl, content } = screen()

    let settled = false
    let remainingMs = AUTO_SKIP_MS
    const autoNote = el('p', { class: 'note' }, [s.autoSkipNote(Math.ceil(remainingMs / 1000))])

    const choose = (answer: ClarificationAnswer | null) => {
      if (settled) return
      settled = true
      window.clearInterval(interval)
      root.replaceChildren()
      resolve(answer)
    }

    content.append(
      titleWithDoodle(s.title, 'scribble-circle'),
      body(s.body),
      card(
        actions(
          button(s.optionBook, () => choose('book')),
          button(s.optionPhone, () => choose('phone')),
          button(s.optionMixed, () => choose('mixed')),
        ),
      ),
      actions(button(s.optionSkip, () => choose(null), { variant: 'secondary' })),
      autoNote,
    )

    root.replaceChildren(screenEl)

    const interval = window.setInterval(() => {
      remainingMs -= 1000
      if (remainingMs <= 0) {
        choose(null)
        return
      }
      autoNote.textContent = s.autoSkipNote(Math.ceil(remainingMs / 1000))
    }, 1000)
  })
}
