import { strings } from '../strings'
import { actions, body, button, card, el, field, screen, textInput, titleWithDoodle } from '../components'
import { mascotPeek } from '../hachiko'

export function renderWelcome(root: HTMLElement): Promise<{ name: string }> {
  return new Promise((resolve) => {
    const s = strings.welcome
    const { root: screenEl, content } = screen()

    const input = textInput(s.namePlaceholder)
    const nameField = field(s.nameLabel, input, { errorText: s.nameError })

    const submit = () => {
      const name = input.value.trim()
      if (!name) {
        nameField.showError(true)
        return
      }
      root.replaceChildren()
      resolve({ name })
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit()
    })
    input.addEventListener('input', () => nameField.showError(false))

    content.append(
      mascotPeek(),
      titleWithDoodle(s.title, 'paw'),
      card(body(s.body), el('p', { class: 'screen__body' }, [s.browserNote])),
      nameField.element,
      actions(button(s.continueLabel, submit)),
      el('p', { class: 'note' }, [s.noAccountNote]),
    )

    root.replaceChildren(screenEl)
    input.focus()
  })
}
