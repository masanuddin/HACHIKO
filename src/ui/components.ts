/**
 * Small, framework-free DOM helpers shared by every screen. Plain DOM per
 * CLAUDE.md - no JSX, no virtual DOM, no template strings for markup
 * (keeps attributes safe without an escaping layer to maintain).
 */

type Attrs = Record<string, string | undefined>

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue
    if (key === 'class') node.className = value
    else node.setAttribute(key, value)
  }
  for (const child of children) {
    node.append(child instanceof Node ? child : document.createTextNode(child))
  }
  return node
}

export interface ScreenShell {
  root: HTMLElement
  content: HTMLDivElement
}

/**
 * The standard cream (or night) centered-column screen wrapper. `<main>`
 * is correct here (not a generic div) because #app always holds exactly
 * one screen at a time - each screen IS the page's main content region
 * for as long as it's mounted.
 */
export function screen(opts: { night?: boolean } = {}): ScreenShell {
  const root = el('main', { class: opts.night ? 'screen screen--night' : 'screen' })
  const content = el('div', { class: 'screen__content' })
  root.append(content)
  return { root, content }
}

export function title(text: string): HTMLHeadingElement {
  return el('h1', { class: 'screen__title' }, [text])
}

export function body(text: string): HTMLParagraphElement {
  return el('p', { class: 'screen__body' }, [text])
}

export function button(
  label: string,
  onClick: () => void,
  opts: { variant?: 'primary' | 'secondary'; disabled?: boolean } = {},
): HTMLButtonElement {
  const b = el('button', {
    class: `button button--${opts.variant ?? 'primary'}`,
    type: 'button',
  }, [label])
  if (opts.disabled) b.disabled = true
  b.addEventListener('click', onClick)
  return b
}

export function actions(...children: HTMLElement[]): HTMLDivElement {
  return el('div', { class: 'screen__actions' }, children)
}

export function cameraDot(label: string): HTMLSpanElement {
  return el('span', { class: 'camera-dot' }, [label])
}

export function card(...children: (Node | string)[]): HTMLDivElement {
  return el('div', { class: 'card' }, children)
}

/**
 * The scrapbook variant of `card()` - torn top edge, optional tilt and
 * tape - kept as a separate function (not a `card()` option) so every
 * existing `card(...)` call in session.ts (the night, focus-block
 * screen) renders exactly as before. Only used by the daylight screens.
 */
export function paperCard(
  children: (Node | string)[],
  opts: { tilt?: 'a' | 'b' | 'c' | 'd' | 'e'; torn?: 'b'; tape?: boolean } = {},
): HTMLDivElement {
  const classes = ['card', 'card--paper']
  if (opts.tilt) classes.push(`tilt-${opts.tilt}`)
  if (opts.torn === 'b') classes.push('torn-b')
  if (opts.tape) classes.push('paper-tape')
  return el('div', { class: classes.join(' ') }, children)
}

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

/** Multi- or single-select chip group. Returns the element and a getter. */
export function chipGroup(
  options: { value: string; label: string }[],
  opts: { multi?: boolean; initial?: string; onChange?: (values: string[]) => void } = {},
): { element: HTMLDivElement; getSelected: () => string[] } {
  const selected = new Set<string>()
  if (opts.initial) selected.add(opts.initial)
  const group = el('div', { class: 'chip-group', role: 'group' })

  const chips = options.map((opt) => {
    const chip = el('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': selected.has(opt.value) ? 'true' : 'false',
    }, [opt.label])

    chip.addEventListener('click', () => {
      const isSelected = selected.has(opt.value)
      if (isSelected) {
        selected.delete(opt.value)
        chip.setAttribute('aria-pressed', 'false')
      } else {
        if (!opts.multi) {
          selected.clear()
          for (const c of chips) c.setAttribute('aria-pressed', 'false')
        }
        selected.add(opt.value)
        chip.setAttribute('aria-pressed', 'true')
      }
      opts.onChange?.(Array.from(selected))
    })

    group.append(chip)
    return chip
  })

  return { element: group, getSelected: () => Array.from(selected) }
}

export function field(
  labelText: string,
  input: HTMLInputElement,
  opts: { errorText?: string } = {},
): { element: HTMLDivElement; showError: (show: boolean) => void } {
  const wrap = el('div', { class: 'field' })
  const labelEl = el('label', {}, [labelText])
  const errorEl = el('p', { class: 'field__error' }, [opts.errorText ?? ''])
  errorEl.style.display = 'none'
  wrap.append(labelEl, input, errorEl)

  return {
    element: wrap,
    showError: (show: boolean) => {
      errorEl.style.display = show ? 'block' : 'none'
    },
  }
}

export function textInput(placeholder: string): HTMLInputElement {
  return el('input', { type: 'text', placeholder }) as HTMLInputElement
}

export function checkboxItem(labelText: string): { element: HTMLDivElement; checkbox: HTMLInputElement } {
  const id = `chk-${Math.random().toString(36).slice(2, 9)}`
  const checkbox = el('input', { type: 'checkbox', id }) as HTMLInputElement
  const labelEl = el('label', { for: id }, [labelText])
  const wrap = el('div', { class: 'consent-item' }, [checkbox, labelEl])
  return { element: wrap, checkbox }
}
