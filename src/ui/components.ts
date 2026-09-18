/**
 * Small, framework-free DOM helpers shared by every screen. Plain DOM per
 * CLAUDE.md - no JSX, no virtual DOM, no template strings for markup
 * (keeps attributes safe without an escaping layer to maintain).
 */

import { clampDurationMs } from './sessionConfig'
import { formatDuration } from './strings'

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

export type DoodleMarkName = 'squiggle' | 'sparkle' | 'swirl' | 'paw' | 'scribble-circle'

const DOODLE_MARK_SVG: Record<DoodleMarkName, string> = {
  squiggle: `<svg viewBox="0 0 32 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M2 11c3-8 6-8 9 0s6 8 9 0 6-8 9 0"/></svg>`,
  sparkle: `<svg viewBox="0 0 32 32" fill="currentColor"><path d="M16 2c0 6.5 1 9 2.5 10.5S25 15 30 16c-6.5 0-9 1-10.5 2.5S16 25 16 30c0-6.5-1-9-2.5-10.5S8 17 2 16c6.5 0 9-1 10.5-2.5S16 8 16 2z"/></svg>`,
  swirl: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20c0 5 4 8 9 8s9-4 9-9-3-8-7-8-6 2-6 6 3 5 6 5 4-1.5 4-3.5"/><path d="M20 17l3 2-1 3.5"/></svg>`,
  paw: `<svg viewBox="0 0 32 32" fill="currentColor"><ellipse cx="16" cy="22" rx="8" ry="6.5"/><ellipse cx="6" cy="12" rx="3" ry="4" transform="rotate(-15 6 12)"/><ellipse cx="13" cy="7" rx="3" ry="4"/><ellipse cx="20" cy="7" rx="3" ry="4"/><ellipse cx="27" cy="12" rx="3" ry="4" transform="rotate(15 27 12)"/></svg>`,
  'scribble-circle': `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6c-8-3-16 2-16 10s7 12 13 10 9-8 7-14c-1-3-4-4-4-4"/></svg>`,
}

/**
 * A small hand-drawn-style decorative mark (never informational - always
 * aria-hidden). Fixed, deterministic per call site, same "no
 * Math.random()" rule the tilt tokens and confetti pattern already
 * follow - each screen picks its mark explicitly, nothing rotates at
 * runtime.
 */
export function doodleMark(name: DoodleMarkName, opts: { size?: string } = {}): HTMLDivElement {
  const mark = el('div', { class: 'doodle-mark', 'aria-hidden': 'true' })
  mark.innerHTML = DOODLE_MARK_SVG[name]
  if (opts.size) {
    mark.style.width = opts.size
    mark.style.height = opts.size
  }
  return mark
}

/** A screen title paired with a small hand-drawn decorative mark - the
 * one consistent decorative touch every daylight screen shares. */
export function titleWithDoodle(text: string, mark: DoodleMarkName): HTMLDivElement {
  return el('div', { class: 'title-row' }, [title(text), doodleMark(mark)])
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

  // Trusted values (presets, the initial value) are set exactly as
  // given, bypassing the min/max clamp entirely - a preset like
  // FAST_DEBUG_WORK_MS (30s) is deliberately below DURATION_MIN_MS
  // (1 minute), and clamping it here would silently round it up to a
  // full minute, defeating its whole purpose. Only interactive nudging
  // (+/-, typed input, and a work-duration change re-clamping the break
  // steppers via setMax) goes through applyClamped.
  function setRaw(ms: number): void {
    valueMs = ms
    input.value = formatDuration(valueMs)
    opts.onChange(valueMs)
  }

  function applyClamped(ms: number): void {
    setRaw(clampDurationMs(ms, opts.minMs, maxMs))
  }

  const minusBtn = el('button', { class: 'stepper__btn', type: 'button', 'aria-label': 'Kurangi' }, ['-'])
  const plusBtn = el('button', { class: 'stepper__btn', type: 'button', 'aria-label': 'Tambah' }, ['+'])

  minusBtn.addEventListener('click', () => applyClamped(valueMs - 60_000))
  plusBtn.addEventListener('click', () => applyClamped(valueMs + 60_000))

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
        interval = window.setInterval(() => applyClamped(valueMs + direction * 60_000), ACCELERATE_MS)
      }, ACCELERATE_AFTER_MS)
    })
    btn.addEventListener('pointerup', stop)
    btn.addEventListener('pointerleave', stop)
  }

  holdRepeat(minusBtn, -1)
  holdRepeat(plusBtn, 1)

  input.addEventListener('blur', () => {
    // If the field wasn't actually edited, leave it alone. formatDuration()
    // renders sub-minute values in SECONDS ("30 detik" for the fastdebug
    // preset) but typed input is always interpreted as whole MINUTES below -
    // without this early return, merely focusing and blurring the field
    // without retyping anything would reparse "30 detik" as 30 and
    // reinterpret it as 30 minutes, silently destroying the exact
    // sub-minute value setRaw/applyClamped exists to protect.
    if (input.value === formatDuration(valueMs)) return
    const parsed = Number.parseInt(input.value, 10)
    if (Number.isNaN(parsed)) {
      input.value = formatDuration(valueMs)
      return
    }
    applyClamped(parsed * 60_000)
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur()
  })

  const presetButtons = opts.presetsMs.map((presetMs) => {
    const btn = el('button', { class: 'preset-chip', type: 'button' }, [formatDuration(presetMs)])
    btn.addEventListener('click', () => setRaw(presetMs))
    return btn
  })

  const element = el('div', { class: 'stepper' }, [
    el('span', { class: 'metric__label' }, [opts.label]),
    el('div', { class: 'stepper__row' }, [minusBtn, input, plusBtn]),
    el('div', { class: 'stepper__presets' }, presetButtons),
  ])

  setRaw(valueMs)

  return {
    element,
    setMax: (newMaxMs: number) => {
      maxMs = newMaxMs
      // Deliberate rough edge: if valueMs currently sits below
      // DURATION_MIN_MS via a preset (only possible for the fastdebug
      // 30s presets), this re-clamp silently normalizes it back up to
      // the minimum. Accepted trade-off for a hidden dev-only shortcut
      // rather than adding a "this came from a preset" tracking flag.
      applyClamped(valueMs)
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
