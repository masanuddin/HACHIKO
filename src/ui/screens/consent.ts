import { strings } from '../strings'
import { actions, body, button, checkboxItem, el, field, paperCard, screen, textInput, titleWithDoodle } from '../components'
import { mascotPeek } from '../hachiko'

export function renderConsent(root: HTMLElement): Promise<{ guardianName: string }> {
  return new Promise((resolve) => {
    const s = strings.consent
    const { root: screenEl, content } = screen()

    const permission = checkboxItem(s.checkboxPermission)
    const camera = checkboxItem(s.checkboxCamera)
    const noReport = checkboxItem(s.checkboxNoReport)

    const nameInput = textInput(s.guardianNamePlaceholder)
    const nameField = field(s.guardianNameLabel, nameInput, { errorText: s.requiredError })

    const submit = () => {
      const allChecked = permission.checkbox.checked && camera.checkbox.checked && noReport.checkbox.checked
      const guardianName = nameInput.value.trim()
      if (!allChecked || !guardianName) {
        nameField.showError(true)
        return
      }
      root.replaceChildren()
      resolve({ guardianName })
    }

    content.append(
      mascotPeek(),
      titleWithDoodle(s.title, 'squiggle'),
      body(s.intro),
      paperCard([el('h2', { class: 'card__title' }, [s.cameraExplainerTitle]), body(s.cameraExplainer)], {
        tilt: 'b',
        tape: true,
      }),
      el('div', {}, [permission.element, camera.element, noReport.element]),
      nameField.element,
      actions(button(s.continueLabel, submit)),
    )

    root.replaceChildren(screenEl)
  })
}
