import { strings } from '../strings'
import { actions, body, button, chipGroup, el, field, screen, textInput, title } from '../components'
import type { Media } from '../../engine/types'

const OPTIONS: { value: Media; labelKey: keyof typeof strings.media.chips }[] = [
  { value: 'laptop', labelKey: 'laptop' },
  { value: 'phone', labelKey: 'phone' },
  { value: 'book', labelKey: 'book' },
  { value: 'paper', labelKey: 'paper' },
  { value: 'other', labelKey: 'other' },
]

export function renderMedia(root: HTMLElement, video: HTMLVideoElement): Promise<{ declaredMedia: Media[]; studyTopic?: string }> {
  return new Promise((resolve) => {
    const s = strings.media
    const { root: screenEl, content } = screen()

    const errorEl = el('p', { class: 'field__error' }, [''])
    errorEl.style.display = 'none'

    const { element: chips, getSelected } = chipGroup(
      OPTIONS.map((o) => ({ value: o.value, label: s.chips[o.labelKey] })),
      { multi: true },
    )

    // Optional, free-form study topic. Metadata only - never feeds CV.
    const topicInput = textInput(s.topicPlaceholder)
    const topicField = field(s.topicLabel, topicInput)

    const submit = () => {
      const declaredMedia = getSelected() as Media[]
      if (declaredMedia.length === 0) {
        errorEl.textContent = s.requiredError
        errorEl.style.display = 'block'
        return
      }
      const studyTopic = topicInput.value.trim()
      root.replaceChildren()
      resolve({ declaredMedia, ...(studyTopic ? { studyTopic } : {}) })
    }

    // This screen doesn't show the live feed, but `video` MUST stay
    // attached to the document somewhere - requestVideoFrameCallback
    // fires when a frame is composited, and a fully detached element is
    // never composited. Losing this for the whole time the student
    // spends on this screen is exactly what silently killed the
    // perception loop before it ever reached the session screen.
    const hiddenVideo = el('div', { class: 'visually-hidden' }, [video])

    content.append(title(s.title), body(s.body), chips, topicField.element, errorEl, actions(button(s.continueLabel, submit)), hiddenVideo)
    root.replaceChildren(screenEl)
  })
}
