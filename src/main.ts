import { loadProfile, saveProfile } from './storage/profile'
import { renderWelcome } from './ui/screens/welcome'
import { renderConsent } from './ui/screens/consent'
import { renderFraming } from './ui/screens/framing'
import { renderCalibration } from './ui/screens/calibration'
import { renderMedia } from './ui/screens/media'
import { renderReady } from './ui/screens/ready'
import { runSession } from './ui/screens/session'
import { WORK_MS } from './ui/sessionConfig'

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
  await renderReady(root, video, WORK_MS)

  // Repeat loop: "Ulangi sesi" on the Session Card starts a fresh Pomodoro
  // reusing the same calibration (cone), camera stream, and perception
  // bundle - never re-running onboarding, framing, calibration, media, or
  // ready. The camera is stopped exactly once, after the student finally
  // chooses "Selesai".
  let repeat = true
  while (repeat) {
    repeat = await runSession(root, video, bundle, cone, declaredMedia)
  }

  bundle.camera.stop()
  root.replaceChildren()
  const wrap = document.createElement('div')
  wrap.className = 'screen'
  const message = document.createElement('p')
  message.className = 'screen__body'
  message.textContent = 'Sesi selesai. Muat ulang halaman untuk mulai sesi baru.'
  wrap.append(message)
  root.append(wrap)
}

main().catch((err) => {
  console.error(err)
  const root = document.getElementById('app')
  if (root) {
    root.textContent = 'Ada kendala saat menjalankan HACHIKO. Coba muat ulang halaman.'
  }
})
