/**
 * A single-purpose FLIP (First-Last-Invert-Play) transition: `el` is
 * already at its FINAL position and size in the DOM (its "Last" state).
 * `fromRect` is where the same visual content sat a moment ago on the
 * previous screen (its "First" state, e.g. the camera preview's bento
 * tile on the Ready screen). This inverts `el` back to that starting
 * rect with a transform, then animates the transform back to identity,
 * so it visually grows from the old position/size to the new one.
 *
 * Used once: Ready screen's camera preview expanding into Calibration's
 * full-screen preview. The underlying <video> element is the same DOM
 * node throughout every screen in this flow (kept attached so
 * requestVideoFrameCallback never stalls - see camera.ts/media.ts's
 * comments), so the live feed never blinks or reinitializes - only the
 * box around it visually changes size.
 */
export function flipExpand(el: HTMLElement, fromRect: DOMRect): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const toRect = el.getBoundingClientRect()
  if (toRect.width === 0 || toRect.height === 0) return

  const dx = fromRect.left - toRect.left
  const dy = fromRect.top - toRect.top
  const sx = fromRect.width / toRect.width
  const sy = fromRect.height / toRect.height

  el.style.transformOrigin = 'top left'
  el.style.transition = 'none'
  el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`

  // Force layout so the browser commits the "First" transform above
  // before the transition below is applied - without this the two
  // style writes would get batched into one and nothing would animate.
  el.getBoundingClientRect()

  requestAnimationFrame(() => {
    el.style.transition = 'transform var(--duration-slow) var(--ease-spring)'
    el.style.transform = 'none'
  })

  el.addEventListener(
    'transitionend',
    () => {
      el.style.transition = ''
      el.style.transformOrigin = ''
    },
    { once: true },
  )
}
