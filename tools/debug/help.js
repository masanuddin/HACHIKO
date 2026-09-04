/**
 * HACHIKO — Debug Harness in-page help  (tools/debug)
 * ===================================================
 * Written for a teammate who did not build the AI. Kept out of the HTML so the
 * dashboard stays scannable; help opens in a drawer on demand.
 *
 * Exported as data so tests can assert the workflow is actually covered.
 */

export const DEBUG_HELP = [
  {
    id: 'quickstart',
    title: 'Quick start',
    html: `
      <h3>Run a session in 6 steps</h3>
      <ol>
        <li><b>Start Camera</b>.</li>
        <li>Sit normally, then press <b>Calibrate</b> and hold still for 5 s.
            Wait for <code>VALID</code> in the header.</li>
        <li>Pick a scenario label in <b>Test guide</b> (right column).</li>
        <li>Read its instruction in <b>Current scenario</b>, then perform it.</li>
        <li>Watch the centre column: state, evidence bars, presence.</li>
        <li>Press <b>Export Session</b> when finished.</li>
      </ol>
      <p class="hint">Without a valid calibration the engine will never report
      TERALIH — that is deliberate, not a bug. Thresholds are relative to
      <em>your</em> neutral posture.</p>`,
  },
  {
    id: 'reading',
    title: 'What am I looking at?',
    html: `
      <h3>Centre column, top to bottom</h3>
      <table>
        <tr><td>State</td><td>The public AI output: FOKUS / TERALIH / TIDAK_HADIR.</td></tr>
        <tr><td>Primary reason</td><td>Which evidence caused the current state.</td></tr>
        <tr><td>State signal</td><td>Whether the behavioural reading is currently
            reliable. "NOT OBSERVABLE" means we cannot see the face well enough to judge.</td></tr>
        <tr><td>Strong evidence</td><td>yaw, pitch-up, eye closure. Each can trigger
            TERALIH on its own once its bar fills.</td></tr>
        <tr><td>Support evidence</td><td>pitch-down, roll. Measured and shown, but they
            can <b>never</b> trigger TERALIH — reading and head-tilt look identical to them.</td></tr>
        <tr><td>Presence</td><td>Whether the user is physically observable at all.</td></tr>
        <tr><td>Phone</td><td>Contextual event stream. Never changes the state.</td></tr>
      </table>
      <p class="hint">A filled STRONG bar changes the state. A filled SUPPORT bar
      never does — it stays muted on purpose.</p>`,
  },
  {
    id: 'signals',
    title: 'Signal glossary',
    html: `
      <table>
        <tr><td>Yaw</td><td>Left/right head rotation. Positive = turning to your own left.</td></tr>
        <tr><td>Pitch</td><td>Head up/down. Positive = looking up.</td></tr>
        <tr><td>Roll</td><td>Head tilt toward a shoulder.</td></tr>
        <tr><td>EAR</td><td>Eye Aspect Ratio — how open the eye is. Lower = more closed.</td></tr>
        <tr><td>EAR relative</td><td>EAR compared to <em>your</em> calibrated baseline.</td></tr>
        <tr><td>Eye evidence</td><td>Whether EAR is trustworthy right now. At extreme head
            angles the eye is foreshortened and EAR becomes meaningless, so it is
            marked <code>ineligible</code> and cannot trigger anything.</td></tr>
        <tr><td>Δ (delta)</td><td>Difference from your calibrated neutral posture.</td></tr>
        <tr><td>Smoothed</td><td>The value after noise filtering. This is what the rules use.</td></tr>
        <tr><td>Both missing</td><td>How long face AND person have both been unobservable.</td></tr>
      </table>`,
  },
  {
    id: 'rules',
    title: 'Testing rules',
    html: `
      <h3>Keep the session valid</h3>
      <ul>
        <li>Calibrate first, and re-calibrate if you change seat or lighting.</li>
        <li>Select the scenario label <b>before</b> performing it.</li>
        <li>Hold each scenario long enough — persistence windows are seconds, not frames.</li>
        <li>Do not change thresholds mid-session.</li>
        <li>Ground-truth labels are <b>annotation only</b>. They are recorded beside
            the prediction and can never influence it.</li>
        <li>Reading, writing, head-down and head-tilt <b>must stay FOKUS</b>. If they
            do not, that is a finding worth reporting.</li>
      </ul>`,
  },
  {
    id: 'export',
    title: 'Export',
    html: `
      <h3>Debug Harness exports</h3>
      <table>
        <tr><td>Export Session</td><td>Both files at once. Use this by default.</td></tr>
        <tr><td>JSON session</td><td>Full per-frame telemetry plus the config that produced it.</td></tr>
        <tr><td>CSV telemetry</td><td>One row per frame, for spreadsheet analysis.</td></tr>
        <tr><td>Analysis</td><td>Distributions, transitions, detection delays, ground-truth comparison.</td></tr>
      </table>
      <p style="margin-top:10px"><b>Column prefixes:</b>
        <code>m_</code> raw measurement · <code>c_</code> calibrated ·
        <code>t_</code> temporal · <code>e_</code> evidence ·
        <code>d_</code> derived prediction · <code>g_</code> ground truth.</p>
      <p class="hint">Debug telemetry and Bake-off trial data are different
      experiment types. Do not merge the two CSVs.</p>
      <p class="hint">No webcam image, frame or video is ever stored or exported.</p>`,
  },
];

/**
 * Per-scenario instruction and expected behaviour, keyed by ScenarioTruth label.
 * Describes what the tester should DO and what they should SEE, without
 * asserting a guaranteed outcome — thresholds are provisional.
 */
export const SCENARIO_GUIDE = {
  SCREEN_NORMAL: {
    instruction: 'Sit normally and look at the screen for ~30 s.',
    expected: 'State stays FOKUS. No evidence bar should fill. This is the false-positive check.',
  },
  READ_BOOK: {
    instruction: 'Look down at a book on the desk for ~30 s.',
    expected: 'Pitch-down SUPPORT bar may fill. State must remain FOKUS — reading is study-compatible.',
  },
  WRITE_NOTES: {
    instruction: 'Write in a notebook for ~30 s.',
    expected: 'Pitch-down and possibly roll support may fill. State must remain FOKUS.',
  },
  LOOK_LEFT_SHORT: {
    instruction: 'Glance left for under 1 s, then return.',
    expected: 'Yaw bar starts filling but should not complete. State stays FOKUS.',
  },
  LOOK_LEFT_LONG: {
    instruction: 'Turn your head left and hold ~6 s.',
    expected: 'Yaw STRONG evidence fills. State may become TERALIH with reason YAW.',
  },
  LOOK_RIGHT_LONG: {
    instruction: 'Turn your head right and hold ~6 s.',
    expected: 'Same as look-left — yaw is non-directional. State may become TERALIH with reason YAW.',
  },
  LOOK_UP_SHORT: {
    instruction: 'Glance up for under 1 s.',
    expected: 'Pitch-up bar starts but should not complete. State stays FOKUS.',
  },
  LOOK_UP_LONG: {
    instruction: 'Look up and hold ~8 s.',
    expected: 'Pitch-up STRONG evidence fills. State may become TERALIH with reason PITCH_UP.',
  },
  LOOK_DOWN_LONG: {
    instruction: 'Look down and hold ~15 s.',
    expected: 'Pitch-down SUPPORT fills but state must stay FOKUS at any depth or duration.',
  },
  HEAD_TILT: {
    instruction: 'Tilt your head toward a shoulder and hold ~12 s.',
    expected: 'Roll SUPPORT fills. State must remain FOKUS.',
  },
  TILT_LEFT: {
    instruction: 'Tilt toward your left shoulder, facing the camera, ~12 s.',
    expected: 'Roll support only. FOKUS. Validates roll independently of yaw.',
  },
  TILT_RIGHT: {
    instruction: 'Tilt toward your right shoulder, facing the camera, ~12 s.',
    expected: 'Roll support only. FOKUS.',
  },
  NORMAL_BLINK: {
    instruction: 'Blink naturally for ~30 s.',
    expected: 'Eye evidence stays eligible, but blinks are far too short to persist. Always FOKUS.',
  },
  EYES_CLOSED_LONG: {
    instruction: 'Close both eyes, facing roughly forward, for more than 3 s.',
    expected: 'Eye evidence eligible; eye-closure bar fills. State may become TERALIH / EYE_CLOSURE.',
  },
  FACE_OCCLUDED_SHORT: {
    instruction: 'Cover your face with a hand for ~1 s, body still visible.',
    expected: 'State is held. Must NOT become TIDAK_HADIR.',
  },
  ABSENT: {
    instruction: 'Leave the camera frame entirely for ~6 s.',
    expected: 'Both-missing timer fills; state should then become TIDAK_HADIR with reason ABSENCE.',
  },
  RETURN: {
    instruction: 'Return to the frame and sit normally.',
    expected: 'Presence recovers; state returns to FOKUS.',
  },
  EXTREME_YAW_HELD_5S: {
    instruction: 'Turn far enough that the face is lost, body still visible, hold 5 s.',
    expected: 'Presence should read PRESENT_FACE_UNAVAILABLE. Must NOT become TIDAK_HADIR — '
            + 'this is the v0.3 fix. Record whether it does.',
  },
  NONE: {
    instruction: 'No scenario selected — free observation.',
    expected: 'Nothing is annotated. Pick a label before a measured run.',
  },
};

export default DEBUG_HELP;
