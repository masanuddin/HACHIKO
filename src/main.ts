import { deleteProfile, loadProfile, saveProfile } from './storage/profile'
import { strings } from './ui/strings'
import { actions, body, button, card, el, screen, title } from './ui/components'
import { renderWelcome } from './ui/screens/welcome'
import { renderConsent } from './ui/screens/consent'
import { renderFraming } from './ui/screens/framing'
import { renderCalibration } from './ui/screens/calibration'
import { renderMedia } from './ui/screens/media'
import { renderReady } from './ui/screens/ready'
import { runSession } from './ui/screens/session'

/**
 * The whole app is one linear flow, orchestrated here. Each screen
 * resolves a promise with what it collected; nothing routes by URL
 * except the `?debug` escape hatch to the perception spike's readout
 * (BUILD_PROMPTS P1's week-1 gate).
 *
 * Onboarding (S1/S2) runs once - "no accounts" means no login, not
 * re-entering your name and consent every time the page opens - and is
 * skipped on return visits once a profile exists in localStorage.
 */
async function main(): Promise<void> {
  const root = document.getElementById('app')
  if (!root) throw new Error('#app root not found')

  if (new URLSearchParams(location.search).has('debug')) {
    const { mountDebugView } = await import('./perception/debugView')
    await mountDebugView(root)
    return
  }

  let profile = loadProfile()

  if (!profile) {
    const { name } = await renderWelcome(root)
    const { guardianName } = await renderConsent(root)
    profile = { name, guardianName, consentedAt: Date.now() }
    saveProfile(profile)
  }

  const { bundle, video } = await renderFraming(root)
  const { cone } = await renderCalibration(root, video, bundle)
  const { declaredMedia } = await renderMedia(root, video)
  const workMs = await renderReady(root, video)

  // Repeat loop: "Ulangi sesi" on the Session Card starts a fresh Pomodoro
  // reusing the same calibration (cone), camera stream, and perception
  // bundle - never re-running onboarding, framing, calibration, media, or
  // ready. The chosen work duration is reused too (in-memory only). The
  // camera is stopped exactly once, after the student finally chooses
  // "Selesai".
  let repeat = true
  while (repeat) {
    repeat = await runSession(root, video, bundle, cone, declaredMedia, workMs)
  }

  bundle.camera.stop()
  renderEndScreen(root)
}

/**
 * The final, dead-end state after "Selesai". Offers a single destructive
 * action - delete the stored profile - behind an inline confirmation.
 * Deleting the profile only clears `hachiko.profile.v1`; session history
 * and telemetry stay. Reloading re-enters onboarding (Welcome + Consent).
 */
function renderEndScreen(root: HTMLElement): void {
  const s = strings.endScreen
  const { root: screenEl, content } = screen()
  const slot = el('div')

  function showActions(): void {
    slot.replaceChildren(actions(button(s.deleteProfileLabel, showConfirm, { variant: 'secondary' })))
  }

  function showConfirm(): void {
    slot.replaceChildren(
      card(
        el('h2', { class: 'card__title' }, [s.deleteProfileConfirmTitle]),
        body(s.deleteProfileConfirmBody),
        actions(
          button(s.deleteProfileConfirmCancel, showActions, { variant: 'secondary' }),
          button(s.deleteProfileConfirmYes, () => {
            deleteProfile()
            location.reload()
          }),
        ),
      ),
    )
  }

  showActions()

  content.append(title(s.doneTitle), body(s.doneMessage), slot)
  root.replaceChildren(screenEl)
}

main().catch((err) => {
  console.error(err)
  const root = document.getElementById('app')
  if (root) {
    root.textContent = 'Ada kendala saat menjalankan HACHIKO. Coba muat ulang halaman.'
  }
})
