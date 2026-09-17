import { deleteProfile, loadProfile, saveProfile } from './storage/profile'
import { deleteAllSessions } from './storage/sessions'
import { strings } from './ui/strings'
import { actions, body, button, card, el, screen, title } from './ui/components'
import { renderWelcome } from './ui/screens/welcome'
import { renderConsent } from './ui/screens/consent'
import { renderCalibration } from './ui/screens/calibration'
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
 *
 * renderReady (2026-09-17 merge) absorbs what used to be three
 * sequential screens (Framing, Media, Ready) into one - it's the one
 * that requests camera permission and returns the PerceptionBundle
 * every screen after it shares by reference. Its `cameraRect` return
 * value lets Calibration visually expand the camera preview into place
 * instead of a plain screen cut - see src/ui/transition.ts.
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

  const { bundle, video, declaredMedia, workMs, rounds, breakMs, longBreakMs, cameraRect } = await renderReady(root)
  const { cone } = await renderCalibration(root, video, bundle, cameraRect)

  // runSession now owns the whole multi-cycle loop (Work -> Break ->
  // Work -> Break -> ...) internally, asking "Fokus lagi?" on its own
  // Break screen, and stops the camera itself once the student is done.
  await runSession(root, video, bundle, cone, declaredMedia, workMs, rounds, breakMs, longBreakMs)

  renderEndScreen(root)
}

/**
 * The final, dead-end state after "Selesai". Offers a reload and one
 * destructive action - delete the stored profile - behind an inline
 * confirmation. "Hapus profil" clears both `hachiko.profile.v1` and the
 * whole session history, so the next flow starts from zero (Welcome +
 * Consent) with no stale "sesi bareng Hachiko" count; telemetry stays.
 */
function renderEndScreen(root: HTMLElement): void {
  const s = strings.endScreen
  const { root: screenEl, content } = screen()
  const slot = el('div')

  function showActions(): void {
    slot.replaceChildren(
      actions(
        button(s.reloadLabel, () => location.reload(), { variant: 'secondary' }),
        button(s.deleteProfileLabel, showConfirm, { variant: 'secondary' }),
      ),
    )
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
            deleteAllSessions()
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
