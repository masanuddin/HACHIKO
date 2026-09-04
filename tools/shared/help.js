/**
 * HACHIKO — in-page help for the two engineering tools  (tools/shared)
 * ====================================================================
 * Written for the person in front of the camera, not for whoever wrote the
 * code. Every section answers one question and stops; each panel on screen has
 * a matching entry so nothing is left to be guessed at.
 *
 * Two rules kept these short:
 *   1. Explain what a number MEANS and when to distrust it, not how it is
 *      computed. The computation is in the source.
 *   2. If a control can destroy data or invalidate a result, say so plainly.
 */

/** Shared: the recording boundary, identical on both pages. */
const RECORDING = {
  id: 'recording',
  title: 'Camera vs recording',
  html: `
    <h3>Starting the camera records nothing</h3>
    <p>The camera runs continuously so you can watch the model work. That live
    view is <b>diagnostic only</b> — it is never saved, never exported, and
    never becomes evidence.</p>
    <p>Data is captured only inside an explicit trial window:</p>
    <table>
      <tr><td>CAMERA LIVE</td><td>Nothing is being recorded. Move around, check
        framing, watch the numbers — none of it is stored.</td></tr>
      <tr><td>COUNTDOWN</td><td>Your time to get into position. Still not
        recorded.</td></tr>
      <tr><td>RECORDING</td><td>The bounded window. Only frames here belong to
        the trial.</td></tr>
      <tr><td>SAVED</td><td>The window closed on its own and the trial was
        committed.</td></tr>
    </table>
    <p class="hint">Only the window between GO and auto-stop reaches the export.
    This is what separates a dataset you can publish from one contaminated by
    footage of the operator getting ready.</p>`,
};

/** Shared: trial mechanics. */
const TRIALS = {
  id: 'trials',
  title: 'Running a trial',
  html: `
    <h3>The loop</h3>
    <ol>
      <li>Choose a scenario and read its instruction.</li>
      <li>Press <b>Start Trial</b>.</li>
      <li>Wait through the countdown — get into position.</li>
      <li>At <b>GO</b>, perform the scenario and hold it.</li>
      <li>Recording stops on its own. The trial is saved.</li>
      <li>Repeat until <b>3 of 3</b>.</li>
    </ol>
    <table>
      <tr><td>Repetition</td><td>Every scenario is measured three times.
        Repetitions are counted for you — you never type a number.</td></tr>
      <tr><td>Abort</td><td>Cancels the attempt in progress. Nothing is saved
        and the repetition count does not move.</td></tr>
      <tr><td>Delete Last Trial</td><td>Permanently removes the trial you just
        recorded, along with all its data. The count rolls back.</td></tr>
    </table>
    <h3 style="margin-top:12px">When to delete</h3>
    <p>Use Delete Last Trial for an <b>immediate procedural mistake</b> — you
    started before you were ready, the wrong scenario was selected, someone
    walked through the shot.</p>
    <p><b>Do not delete a valid trial because the AI or model performed poorly
    or unexpectedly.</b> That is the result. Deleting it because you dislike it
    is how a benchmark stops measuring anything.</p>`,
};

/** Shared: privacy and the export shape. */
const PRIVACY = {
  id: 'privacy',
  title: 'Privacy & exports',
  html: `
    <h3>What leaves this page</h3>
    <p><b>No image, frame or video is ever stored or exported.</b> Exports
    contain numbers, labels and bounding-box geometry only. The camera preview
    exists on screen and nowhere else.</p>
    <h3 style="margin-top:12px">What you get</h3>
    <p>One button downloads a single <b>ZIP</b> holding <b>three files</b>. Each
    is readable on its own — you never need two files open to understand
    either.</p>
    <table>
      <tr><td>results.json</td><td>The complete structured record: config,
        scenario protocol, every trial and its raw samples. Nothing else is
        needed to reanalyse a session.</td></tr>
      <tr><td>trials.csv</td><td>One row per trial, carrying the session,
        calibration, scenario, expectation, metrics <em>and</em> the thresholds
        those metrics must be read against. Opens directly in Excel.</td></tr>
      <tr><td>telemetry.csv <span class="pend">debug</span></td>
        <td>Per-frame time series inside each recorded window. Every row names
        its session, trial, scenario and repetition.</td></tr>
      <tr><td>summary.csv <span class="pend">benchmark</span></td>
        <td>The model-comparison table: completion, metrics, rank.</td></tr>
    </table>
    <p>Deleted trials are absent from all three — no tombstone, no hidden
    row.</p>`,
};

/** Shared: the camera preview contract. */
const CAMERA = {
  id: 'camera',
  title: 'The camera preview',
  html: `
    <h3>What you see is what the AI reads</h3>
    <p>The preview shows the <b>exact frame</b> sent to the model — same
    resolution, uncropped. The header states the live resolution; the request is
    <b>640×480</b>, and the model consumes the video element directly with no
    resize step.</p>
    <p>This matters because framing is a real variable. If the preview were
    cropped, you would be judging a shot the model never sees.</p>
    <table>
      <tr><td>Mirrored</td><td>The preview is flipped for comfort, like a
        mirror. <b>Inference runs on the unflipped frame</b>, so yaw keeps a
        well-defined sign. Only the display is mirrored.</td></tr>
      <tr><td>Black bars</td><td>If your camera cannot deliver 4:3, the frame is
        letterboxed rather than cropped. Nothing is hidden from you.</td></tr>
    </table>`,
};

/** Debug Harness help. */
export const DEBUG_HELP = [
  {
    id: 'purpose',
    title: 'What this page is for',
    html: `
      <h3>Debug Harness</h3>
      <p>This is primarily a <b>live monitoring and debugging</b> tool: watch
      the face pipeline work, in real time, and see exactly why it reached the
      state it did.</p>
      <p>Verification trials are an <em>additional</em> capability for collecting
      standardised evidence. They are not the purpose of the page — live
      monitoring works with no scenario selected at all.</p>
      <h3 style="margin-top:12px">What it covers</h3>
      <p>The <b>face-based</b> pipeline only: head pose, eye features,
      calibration, the temporal rules, and the resulting state.</p>
      <p>The physical-presence and phone models have not been chosen yet — they
      are still being compared on the Benchmark page. Those panels read
      <b>PENDING BAKE-OFF</b> and take no part in the state.</p>`,
  },
  CAMERA,
  {
    id: 'layout',
    title: 'Reading the screen',
    html: `
      <h3>Three columns, three questions</h3>
      <table>
        <tr><td>LEFT — Operate</td><td>What am I running? Camera, calibration,
          and the Verification Trial controls.</td></tr>
        <tr><td>CENTRE — Observe</td><td>What is the AI concluding? The state,
          the evidence behind it, and whether the face is observable.</td></tr>
        <tr><td>RIGHT — Understand</td><td>Why is it behaving that way? Every
          measurement, the rule that reads it, and its timer.</td></tr>
      </table>
      <h3 style="margin-top:12px">Every panel</h3>
      <table>
        <tr><td>Calibration</td><td>Your neutral baseline. Relative values
          (Δ Baseline, EAR relative) are measured against it, so they read
          <b>Requires calibration</b> until it exists.</td></tr>
        <tr><td>AI Result</td><td>The state, its primary reason, and how long it
          has held. This is the conclusion — the panels on the right explain it
          rather than repeat it.</td></tr>
        <tr><td>Evidence</td><td>Which signals are active right now, split into
          STRONG and SUPPORT. Bars show how far each timer has run.</td></tr>
        <tr><td>Face signal</td><td>Whether a face is present, whether head pose
          is usable, and whether eye evidence is eligible. If any is false, the
          rules above it cannot be trusted.</td></tr>
        <tr><td>Verification Trial</td><td>Optional structured capture. Choose
          Scenario and View Progress open on demand so the catalogue does not
          occupy the dashboard.</td></tr>
      </table>`,
  },
  {
    id: 'states',
    title: 'What the states mean',
    html: `
      <table>
        <tr><td>FOKUS</td><td>Attention is on the screen. This is the default
          and the assumption when evidence is weak.</td></tr>
        <tr><td>TERALIH</td><td>Attention is away. Requires <b>one STRONG
          signal</b> sustained past its timer — never support evidence
          alone.</td></tr>
        <tr><td>TIDAK_HADIR</td><td>Nobody is observable. The face has been
          missing long enough that no judgement about attention is
          possible.</td></tr>
      </table>
      <h3 style="margin-top:12px">Strong vs support</h3>
      <p>This distinction is structural, not cosmetic.</p>
      <table>
        <tr><td>STRONG</td><td>Yaw, pitch up, eye closure. Any one of these,
          held long enough, can trigger TERALIH on its own.</td></tr>
        <tr><td>SUPPORT</td><td>Pitch down, head tilt. <b>Can never trigger
          TERALIH alone.</b> Reading a book is head-down and attentive; a
          support signal at 100% is expected and harmless.</td></tr>
      </table>`,
  },
  {
    id: 'inspector',
    title: 'Signal Inspector',
    html: `
      <h3>Measurement → rule → persistence → result</h3>
      <p>Each row follows one signal along that chain, so you never have to hold
      a threshold in your head while reading a number.</p>
      <table>
        <tr><td>Raw</td><td>Direct measurement from the frame.</td></tr>
        <tr><td>Δ Base</td><td>Relative to your calibrated neutral. This is what
          the rules actually compare.</td></tr>
        <tr><td>Smoothed</td><td>Noise-reduced value the rules read.</td></tr>
        <tr><td>Role</td><td>STRONG, SUPPORT, or a plain measurement that two
          rules interpret.</td></tr>
        <tr><td>Persistence</td><td>How long the condition has <em>continuously</em>
          held, against the window it must reach. It resets when the condition
          breaks — briefly satisfying a rule is not evidence.</td></tr>
        <tr><td>Status</td><td>Whether the rule is currently active.</td></tr>
      </table>
      <h3 style="margin-top:12px">Head Tilt</h3>
      <p>Derived from the head-pose <b>roll</b> angle. Roll is the internal and
      exported name; <b>Head Tilt</b> is what it means behaviourally. It is
      supporting evidence only.</p>
      <h3 style="margin-top:12px">Pitch interpretation</h3>
      <p>Pitch is measured <b>once</b>, then read by two rules with opposite
      meanings: looking <em>up</em> is STRONG evidence of distraction, looking
      <em>down</em> is SUPPORT only. That is why the measurement appears once and
      the interpretations sit in their own table.</p>
      <h3 style="margin-top:12px">Eye decision</h3>
      <p>EAR is always measured, but only <em>trusted</em> when the geometry
      allows it. At an extreme head angle the eye foreshortens and EAR stops
      meaning what we think it means, so the rule reports
      <b>Eligible: NO</b> with the exact gating reason.</p>`,
  },
  {
    id: 'placeholders',
    title: 'When a value is missing',
    html: `
      <h3>Every blank says why</h3>
      <p>A dash tells you nothing. Each absent value names its condition
      instead, so you know whether to act, wait, or investigate.</p>
      <table>
        <tr><td>Waiting for camera</td><td>No frame has arrived yet.</td></tr>
        <tr><td>No face</td><td>Nothing to measure.</td></tr>
        <tr><td>Signal invalid</td><td>A face is there, but head-pose extraction
          failed. Different problem from "no face".</td></tr>
        <tr><td>Requires calibration</td><td>Measurable, but needs a baseline to
          be relative. Press Calibrate.</td></tr>
        <tr><td>Collecting…</td><td>Valid, but not enough samples yet.</td></tr>
        <tr><td>Not applicable</td><td>The rule cannot be evaluated in this
          state, so a timer would be misleading.</td></tr>
        <tr><td><b>Unavailable</b></td><td><b>Should exist and does not.</b> This
          is the only one that means something is wrong — worth
          chasing.</td></tr>
      </table>
      <p class="hint">When one condition blocks a whole table, it is stated once
      above the table and the rows are hidden — rather than repeating the same
      phrase in twenty cells.</p>`,
  },
  RECORDING,
  TRIALS,
  {
    id: 'runtime',
    title: 'Runtime & health',
    html: `
      <table>
        <tr><td>FPS</td><td>Processing rate. A sustained drop usually means the
          delegate fell back to CPU.</td></tr>
        <tr><td>Inference p50 / p95</td><td>Median and tail latency over recent
          frames. <b>p95 is what makes the UI feel slow</b>, not the
          average.</td></tr>
        <tr><td>Delegate</td><td>GPU or CPU. Set at model load.</td></tr>
        <tr><td>Live session range</td><td>Min and max observed since the camera
          started or was reset. Monitoring only — never recorded trial
          data.</td></tr>
        <tr><td>Sanity</td><td><code>nonFinite</code> and <code>wrapSuspect</code>
          must both stay 0. Anything else means an angle has wrapped near ±180°
          and the pose extraction is suspect.</td></tr>
      </table>`,
  },
  PRIVACY,
];

/** Perception Model Benchmark help. */
export const BENCH_HELP = [
  {
    id: 'purpose',
    title: 'What this page is for',
    html: `
      <h3>Perception model benchmark</h3>
      <p>Inspect perception models live, collect standardised benchmark trials,
      and compare candidates. Trial capture matters, but the page is built first
      for <b>looking at what a model actually does</b> — a confidence number
      alone never tells you whether the detector found the right object.</p>
      <p>It decides which perception model HACHIKO ships, for two questions:</p>
      <table>
        <tr><td>Person / presence</td><td>Is the user still physically there
          when the face detector loses them?</td></tr>
        <tr><td>Phone</td><td>Is a phone visible? Contextual only — it never
          changes the AI state.</td></tr>
      </table>
      <h3 style="margin-top:12px">Official method: full evaluation</h3>
      <p><b>Every candidate is evaluated on every assigned scenario</b>, with
      three repetitions each. There is no early elimination and no staged
      screening. A model is never dropped on the strength of a subset.</p>
      <p>Ranking and the final recommendation come from the complete collected
      evidence. A candidate with missing scenarios is reported as
      <b>INCOMPLETE</b> and is not ranked at all.</p>`,
  },
  CAMERA,
  {
    id: 'layout',
    title: 'Reading the screen',
    html: `
      <h3>Three columns, three questions</h3>
      <table>
        <tr><td>LEFT — Model &amp; capture</td><td>Which model am I testing, and
          which standardised trial am I recording?</td></tr>
        <tr><td>CENTRE — Inspect</td><td>What is this model seeing right
          now?</td></tr>
        <tr><td>RIGHT — Analyse</td><td>How does it compare with the other
          candidates?</td></tr>
      </table>
      <h3 style="margin-top:12px">Every panel</h3>
      <table>
        <tr><td>Candidate model</td><td>Selection only. Loading a model resets
          the live buffers.</td></tr>
        <tr><td>Model overview</td><td>Identity and runtime health, kept
          <b>above</b> the detection tables so it never drifts down the page as
          the detection count changes.</td></tr>
        <tr><td>Live target output</td><td>The HACHIKO-relevant classes. The
          selected task is PRIMARY; the other stays visible as SECONDARY
          context and never affects a trial result.</td></tr>
        <tr><td>Model output details</td><td>The strongest raw classes, capped
          at five. This is where misclassification shows up.</td></tr>
        <tr><td>Benchmark capture</td><td>Bounded evidence collection. Change
          Scenario and View Benchmark Progress open on demand.</td></tr>
      </table>`,
  },
  {
    id: 'inspector',
    title: 'Live Model Inspector',
    html: `
      <h3>What the model sees, right now</h3>
      <p>The inspector runs whenever the camera is on, with or without a trial.
      Everything it shows is <b>diagnostic only</b> — nothing here is saved
      unless a trial is recording.</p>
      <table>
        <tr><td>Current / Peak</td><td>Confidence for the class your task is
          about, now and at its highest this session.</td></tr>
        <tr><td>Camera overlay</td><td>Boxes and labels over the preview. The
          fastest way to catch a detector that is confident about the
          <em>wrong</em> object. No frame is stored.</td></tr>
        <tr><td>Model output details</td><td>Top raw classes with their role:
          TARGET, SECONDARY, or COMPETITOR.</td></tr>
        <tr><td>Competitor</td><td>The strongest class that is neither person
          nor phone. When it scores near your target, class separation is
          weak — that is a real finding.</td></tr>
        <tr><td>Latency p50 / p95</td><td>Median and tail inference time over
          recent frames.</td></tr>
      </table>
      <h3 style="margin-top:12px">Pose Lite is different</h3>
      <p>Pose Landmarker reports <b>body geometry, not object classes</b>. It has
      no notion of "cell phone" and no comparable confidence score, so it gets
      its own readout — landmark counts and usable ratio. Nothing is
      fabricated to fill an object-detector table.</p>`,
  },
  RECORDING,
  {
    id: 'flow',
    title: 'Running the benchmark',
    html: `
      <h3>Candidate by candidate</h3>
      <ol>
        <li>Start the camera.</li>
        <li>Pick a candidate model.</li>
        <li>Pick a task — Person or Phone. (Pose Lite is presence-only.)</li>
        <li><b>Change Scenario</b> to pick one; work through them all, three
          repetitions each.</li>
        <li>When every scenario is done, the candidate/task shows COMPLETE.</li>
        <li>Move to the next candidate and repeat.</li>
        <li><b>View Benchmark Progress</b> shows every candidate and task.</li>
        <li>Export when the whole matrix is complete.</li>
      </ol>
      <p class="hint">The <b>Next action</b> line always names the scenario to
      run next, so you never have to work out where you left off.</p>`,
  },
  TRIALS,
  {
    id: 'scenario',
    title: 'Scenario Results',
    html: `
      <h3>One condition, every candidate</h3>
      <p>Answers "on this specific condition, how did each model do". The
      metrics change with the scenario type, because the question does.</p>
      <table>
        <tr><td>Positive scenario</td><td>The target <b>must</b> be found.
          Reports how often it was, and the median of each repetition's peak
          score.</td></tr>
        <tr><td>Negative control</td><td>The target must <b>not</b> be found.
          Reports how often the model fired anyway, and the highest score it
          reached while the target was absent.</td></tr>
      </table>
      <p>Showing "detection rate" on a negative control would read backwards, so
      the columns switch instead.</p>
      <h3 style="margin-top:12px">Partial results</h3>
      <p>A rate always carries its denominator. One repetition reads
      <b>100% (1/1) PRELIM</b> — never a bare 100%, which would look like a
      finished result.</p>`,
  },
  {
    id: 'reading',
    title: 'Model Comparison',
    html: `
      <h3>Across everything required</h3>
      <table>
        <tr><td>Coverage</td><td>Required scenarios completed. Ranking is
          impossible until this is full.</td></tr>
        <tr><td>Recall</td><td>How often the target was found when
          present.</td></tr>
        <tr><td>Specificity</td><td>How often the model correctly stayed silent
          on the negative controls.</td></tr>
        <tr><td>FP / FN</td><td>False positives on negatives, false negatives on
          positives.</td></tr>
        <tr><td>Discriminability</td><td>How cleanly the score separates present
          from absent, <b>for this model</b>.</td></tr>
        <tr><td>Status</td><td>PRELIM means partial evidence. Only COMPLETE
          candidates are ranked.</td></tr>
      </table>
      <h3 style="margin-top:12px">One caveat that matters</h3>
      <p><b>Confidence scores are not comparable between model families.</b> They
      are not calibrated to a shared scale, so a model scoring 0.20 is not
      automatically worse than one scoring 0.60. Judge on recall, specificity
      and separation instead — and never compare Pose Lite's landmark ratio
      against an object detector's confidence.</p>
      <h3 style="margin-top:12px">Missing vs not applicable</h3>
      <p>"Awaiting negative-control data" means <em>go collect it</em>. That is
      different from a metric that genuinely does not apply, and the tables keep
      the two apart.</p>`,
  },
  PRIVACY,
];

export default { DEBUG_HELP, BENCH_HELP };
