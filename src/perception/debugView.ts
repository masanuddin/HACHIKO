/**
 * The week-1 gate from BUILD_PROMPTS P1. Not a product screen - reachable
 * only via `?debug` (see main.ts) - so it can afford a plain readout
 * instead of the calm, sparse language the rest of the app uses. Verify
 * here, by hand, on a real laptop:
 *   1. Turning your head changes yaw; nodding changes pitch (AI-Engine
 *      canonical signs, validated in AI-Engine).
 *   2. Holding up a phone makes "cell phone" appear within ~2s.
 *   3. EAR moves with eye closure; earRelative appears once the 5s AI
 *      baseline settles.
 *   4. Background the tab for 60s, come back - the loop kept running.
 */

export async function mountDebugView(root: HTMLElement): Promise<void> {
  root.innerHTML = ''
  root.className = 'screen'

  const content = document.createElement('div')
  content.className = 'screen__content'
  content.style.maxWidth = '860px'
  root.appendChild(content)

  const title = document.createElement('h1')
  title.className = 'screen__title'
  title.textContent = 'HACHIKO — Debug Perception'
  content.appendChild(title)

  const status = document.createElement('p')
  status.className = 'screen__body'
  status.textContent = 'Meminta izin kamera...'
  content.appendChild(status)

  const previewWrap = document.createElement('div')
  previewWrap.className = 'camera-preview'
  const video = document.createElement('video')
  previewWrap.append(video)
  content.appendChild(previewWrap)

  const readout = document.createElement('pre')
  readout.style.cssText =
    'font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; ' +
    'white-space: pre-wrap; background: var(--sand); border-radius: var(--radius-md); padding: var(--space-4);'
  content.appendChild(readout)

  try {
    const [{ startCamera, startPerceptionLoop }, { createAiRuntime }] = await Promise.all([
      import('./camera'),
      import('./aiRuntime'),
    ])

    await startCamera(video)
    status.textContent = 'Kamera aktif. Memuat model...'

    const runtime = await createAiRuntime()
    status.textContent = 'Model siap. Gerakkan kepalamu untuk memverifikasi arah yaw/pitch.'

    let calibrationStarted = false
    let lastObjectLabels = '(none)'
    let lastFrameReadout = ''

    startPerceptionLoop(video, runtime.ai, runtime.faceEngine, runtime.objectEngine, (tick) => {
      if (!calibrationStarted) {
        // The 5s AI baseline feeds earRelative; started on the first tick so
        // this standalone debug view behaves like the product flow.
        runtime.ai.startCalibration(tick.timestampMs)
        calibrationStarted = true
      }

      const t = tick.telemetry
      const m = t.measurement
      const toDeg = (v: number | null) => (v === null ? 'null' : `${v.toFixed(1)}°`)
      const ear = m.earMean === null ? 'null' : m.earMean.toFixed(3)
      const earRelative = t.calibrated.earRelative === null ? 'null' : t.calibrated.earRelative.toFixed(2)
      const eyeBlink = tick.frame.eyeBlink === null ? 'null' : tick.frame.eyeBlink.toFixed(2)

      if (t.objects.detectorRan) {
        const labels = t.objects.detections.map((d) => d.category)
        lastObjectLabels = labels.length ? labels.join(', ') : '(none)'
      }

      lastFrameReadout = [
        `faceFound : ${m.facePresent}`,
        `presence  : ${t.presence.status}`,
        `yaw       : ${toDeg(m.yawRaw)}`,
        `pitch     : ${toDeg(m.pitchRaw)}`,
        `roll      : ${toDeg(m.rollRaw)}`,
        `EAR mean  : ${ear}`,
        `earRelative: ${earRelative}`,
        `eyeBlink  : ${eyeBlink}`,
        `objects   : ${lastObjectLabels}`,
        `phonePresent: ${t.objects.phonePresent}`,
        `personPresent: ${t.objects.primaryPersonPresent}`,
      ].join('\n')

      readout.textContent = lastFrameReadout
    })
  } catch (err) {
    status.textContent =
      err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
        ? 'Izin kamera ditolak. Muat ulang halaman dan izinkan akses kamera untuk melanjutkan.'
        : `Perception layer belum bisa jalan: ${err instanceof Error ? err.message : String(err)}`
    console.error(err)
  }
}
