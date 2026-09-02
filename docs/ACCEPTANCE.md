# Manual Acceptance Protocol — HACHIKO AI v0.2

The automated suite (`npm test`, **156 tests**) proves the pipeline logic with
synthetic measurements. It cannot prove that **MediaPipe's real output** on
**real faces** behaves as expected. That is what this protocol is for.

> ## STATUS: GATE 1 RUN — TWO DEFECTS FOUND AND FIXED. GATES 2–3 PENDING RE-RUN.
>
> A real Gate-1 webcam run was performed and found two defects, both now fixed:
>
> 1. **Pitch sign was inverted.** Physical LOOK UP produced a device pitch delta
>    of −46.4°, LOOK DOWN +21.8° — the opposite of the canonical convention. This
>    swapped PITCH_UP (strong) and PITCH_DOWN (support), so looking down at a book
>    accumulated strong evidence. Fixed at the single canonicalization boundary
>    via `headPose.invertPitch: true`.
>
> 2. **EAR is unreliable at non-frontal pose.** With eyes fully OPEN, earRelative
>    read 0.667 looking up and **0.220** looking down — below any usable closure
>    threshold. Extreme yaw gave asymmetric readings (L 1.053 vs R 0.557). Fixed
>    with an `eyeEvidenceEligible` geometry gate; EAR stays measured and logged
>    at all angles but only counts as evidence when near-frontal.
>
> 3. **Genuine closed eyes were rejected as invalid.** A real frontal closure
>    measured L=0.016 R=0.016 (earRelative 0.040) with a valid near-frontal
>    pose, but was reported `eyeEvidenceEligible: false / EAR_IMPLAUSIBLE` and
>    stayed FOKUS. A physiological lower bound of 0.02 rejected exactly the
>    condition the feature exists to detect. The lower bound is removed:
>    validity now rejects only impossible values (negative / non-finite / above
>    the upper bound), while `EAR_RELATIVE_THRESHOLD` still decides whether a
>    valid low reading counts as closure.
>
> **Gates 2–3 must be re-run on hardware to confirm all three fixes.**

## Setup

```bash
npm install
npm run assets      # copies WASM + face_landmarker.task into public/assets/
npm run dev         # http://localhost:5173
```

Click **Download CSV** and **Download Analysis** at the end — those files are
the evidence. CSV column prefixes:

| Prefix | Meaning |
|---|---|
| `m_` | raw measurement |
| `c_` | calibrated (relative to this session's baseline) |
| `t_` | temporal (smoothed) |
| `e_` | evidence flags (`*_support` can never trigger TERALIH) |
| `d_` | **derived prediction — NOT ground truth** |
| `g_` | **ground truth — human annotation, never an engine input** |

The `d_`/`g_` split is the core discipline: the old Python CSV's bare `status`
column was routinely misread as a label. Never conflate the two.

---

## GATE 1 — Sign convention

**Do this first.** Every later gate assumes the signs are confirmed.

Start the camera and watch the raw values. Do **not** calibrate yet.

| Action | Expect | If wrong |
|---|---|---|
| Face the screen | yaw/pitch/roll all ≈ 0 | camera or seating badly off-axis |
| Turn head **left** | `yaw_raw` **positive** | set `invertYaw: true` |
| Turn head **right** | `yaw_raw` **negative** | set `invertYaw: true` |
| Look **up** | `pitch_raw` **positive** | set `invertPitch: true` |
| Look **down** | `pitch_raw` **negative** | set `invertPitch: true` |
| Tilt toward **right** shoulder | `roll_raw` **positive** | set `invertRoll: true` |
| Cover the camera | Pose `INVALID (NO_FACE)`, angles `—`, **never 0.0** | pose-validity regression |

Switches live in `headPose` in [src/ai/config.js](../src/ai/config.js).

> **Pitch sign is load-bearing in v0.2.** Upward pitch is STRONG evidence;
> downward pitch is SUPPORT-only. An inverted pitch axis would invert that
> asymmetry and make the system fire on reading — the exact failure v0.2 exists
> to prevent. Fix it once here via `invertPitch`, never by flipping comparisons
> in `EvidenceEngine`.

Record from the **Gate 7 — observed ranges** panel:

- [ ] Yaw range wide and monotonic through the turn
- [ ] Pitch range wide and monotonic
- [ ] Roll range wide and monotonic
- [ ] EAR clearly drops on closure
- [ ] **Anomalies: `nonFinite 0 · wrapSuspect 0`** ← must be zero

`wrapSuspect` counts values within 40° of ±180°. Any non-zero count means the
v0.1 pitch-wrap defect has returned.

---

## GATE 2 — Calibration

Sit normally, look at the screen, click **Calibrate**, hold still 5 s.

- [ ] Status reaches `VALID`
- [ ] Baseline yaw/pitch plausible for your seating (need not be 0)
- [ ] Baseline EAR typically 0.20–0.35
- [ ] Sample count ≳ 120 of ~150 frames

If `FAILED`, the reason is shown. Do not proceed — without a baseline the
engine will never report TERALIH, by design.

---

## GATE 3 — Behavioural acceptance

Tag each scenario with the buttons in the **Scenario ground truth** panel (or
keys `1`–`0`, `Esc` for NONE) *before* performing it. Hold each for the
duration shown.

| # | Scenario tag | Hold | Expected | Expected reason |
|---|---|---|---|---|
| 1 | `SCREEN_NORMAL` | 30 s | `FOKUS` | `NONE` |
| 2 | `READ_BOOK` | 30 s | `FOKUS` | `NONE` |
| 3 | `WRITE_NOTES` | 30 s | `FOKUS` | `NONE` |
| 4 | `LOOK_LEFT_SHORT` | 0.8 s | `FOKUS` | `NONE` |
| 5 | `LOOK_LEFT_LONG` | 6 s | `TERALIH` | `YAW` |
| 6 | `LOOK_RIGHT_LONG` | 6 s | `TERALIH` | `YAW` |
| 7 | `LOOK_UP_SHORT` | 0.9 s | `FOKUS` | `NONE` |
| 8 | `LOOK_UP_LONG` | 8 s | `TERALIH` | `PITCH_UP` |
| 9 | `LOOK_DOWN_LONG` | 15 s | **`FOKUS`** | `NONE` |
| 10 | `HEAD_TILT` | 12 s | **`FOKUS`** | `NONE` |
| 11 | `NORMAL_BLINK` | 30 s | `FOKUS` | `NONE` |
| 12 | `EYES_CLOSED_LONG` | 8 s | `TERALIH` | `EYE_CLOSURE` |
| 13 | `FACE_OCCLUDED_SHORT` | 1.2 s | `FOKUS` (hold) | `NONE` |
| 14 | `ABSENT` | 6 s | `TIDAK_HADIR` | `ABSENCE` |
| 15 | `RETURN` | 4 s | `FOKUS` | `NONE` |
| 16 | `TILT_LEFT` | 12 s | **`FOKUS`** | `NONE` |
| 17 | `TILT_RIGHT` | 12 s | **`FOKUS`** | `NONE` |
| 18 | `EXTREME_YAW_HELD_5S` | 5 s | `TERALIH` (`YAW`) | **not** `TIDAK_HADIR` |

Return to `SCREEN_NORMAL` for ~3 s between scenarios so the state settles.

### New in this run — re-verify the two fixes

**#4/#5 (look up / look down) are now the pitch-sign regression check.**
Look up must show `pitch_raw` **positive** and can reach TERALIH with reason
`PITCH_UP`. Look down must show `pitch_raw` **negative** and must stay FOKUS.
If these are reversed, `invertPitch` is wrong for your camera — fix the flag,
never the comparisons.

**Watch the `eye evidence` readout** (in the evidence panel). During look-up,
look-down and extreme yaw it must read `ineligible (…)`, and the eye bar must
stay empty even though EAR is visibly low. During frontal closure it must read
`eligible` and the bar must fill.

**#12 `EYES_CLOSED_LONG` is the regression check for the closed-eye fix.**
Close both eyes, facing the camera, for 8 s. Required:

- `eye evidence` reads **`eligible`** (previously `ineligible (EAR_IMPLAUSIBLE)`)
- `EAR L`/`EAR R` show the real near-zero values (~0.01–0.03) — still logged
- the eye bar fills over ~3 s
- state becomes **`TERALIH` / `EYE_CLOSURE`**

If it still reads `EAR_IMPLAUSIBLE`, the validity floor has returned.
Then blink normally for 30 s (#11): eligible throughout, but **always FOKUS** —
persistence, not validity, is what keeps blinks from triggering.

**#18 `EXTREME_YAW_HELD_5S` is a deliberate probe, not a pass/fail scenario.**
Hold an extreme head turn for 5 s while remaining physically present, then
record whether the engine ever reports `TIDAK_HADIR`. A live run showed
`facePresent: true` alongside ~582 ms of accumulated absence evidence — that
value is retained evidence, not current missing time, and is expected (see
`FaceMissingTracker`). But simulation shows a *sustained flicker* (repeated
dropouts each followed by less than `FACE_PRESENT_RECOVER_MS` of detection)
can accumulate to a false absence. **Only recommend an absence-rule change if
you can reproduce a false `TIDAK_HADIR` here.**

**#16/#17 validate roll independently of yaw.** Tilt the head toward each
shoulder while facing the camera. Roll is SUPPORT-only, so both must stay
FOKUS; the roll bar may fill, which is correct and expected.

### The rows that matter most

**#2, #3, #9, #10 must stay FOKUS.** These are the support-only guarantees.
Reading, writing, head-down and head-tilt are all study-compatible; a system
that flags them punishes exactly the behaviour it should reward.

This is not a hypothetical. Replaying the historical Python log through this
engine shows head pose alone cannot separate the two head-down behaviours:

| Manual tag | TERALIH under v0.1 rules |
|---|---|
| `baca_buku` (reading) | 31.1% |
| `pegang_hp` (phone) | 24.8% |

Reading was flagged *more* than phone use. Closing that gap is v0.3's job (the
phone detector), not something a pitch threshold can fake.

### Reference — same scenarios under simulation

Driving the engine with synthetic measurements gives **22/22** expected
outcomes and these detection delays. Live results should be in the same range;
large deviations indicate a measurement problem, not a rule problem.

| Scenario | Simulated delay |
|---|---|
| `LOOK_LEFT_LONG` → TERALIH | 2300 ms |
| `LOOK_RIGHT_LONG` → TERALIH | 2333 ms |
| `LOOK_UP_LONG` → TERALIH | 2867 ms |
| `EYES_CLOSED_LONG` → TERALIH | 3800 ms |
| `ABSENT` → TIDAK_HADIR | 1967 ms |

---

## Recording template

Copy into the report. **Do not fill in from simulation — only from hardware.**

```
Device / camera / lighting:
Browser + version:
Delegate (GPU/CPU):

GATE 1 — sign convention
  turn left   -> yaw_raw ......  (expect +)   pass/fail
  turn right  -> yaw_raw ......  (expect -)   pass/fail
  look up     -> pitch_raw ....  (expect +)   pass/fail
  look down   -> pitch_raw ....  (expect -)   pass/fail
  tilt right  -> roll_raw .....  (expect +)   pass/fail
  cover lens  -> INVALID, not 0.0             pass/fail
  anomalies: nonFinite .....  wrapSuspect .....   (both must be 0)
  invert flags needed: yaw ..... pitch ..... roll .....

GATE 2 — calibration
  status .....  baseline yaw ..... pitch ..... roll ..... EAR .....
  samples ...../.....

GATE 3 — behavioural acceptance
 #  Scenario Truth        Expected     AI Result    Correct  Reason        Delay   Notes
 1  SCREEN_NORMAL         FOKUS        ...........  .......  ...........  ......  ......
 ...

PERFORMANCE
  FPS        p50 .....  p95 .....
  inference  p50 .....  p95 .....   (from Download Analysis)

FALSE TRANSITIONS
  false TERALIH episodes:      .....  (during SCREEN_NORMAL/READ_BOOK/WRITE_NOTES/
                                       LOOK_DOWN_LONG/HEAD_TILT/NORMAL_BLINK)
  false TIDAK_HADIR episodes:  .....  (during FACE_OCCLUDED_SHORT)
  total transitions:           .....  (from analysis.transitionCount)
```

## Anomalies to watch for

- Angles reading exactly `0.0` while the face is invisible → pose-validity regression.
- `wrapSuspect > 0` → the ±180° wrap bug has returned.
- `LOOK_DOWN_LONG` or `HEAD_TILT` producing TERALIH → tier model broken, or
  pitch sign inverted. Check Gate 1 before touching any rule.
- State flipping more than ~twice in a stable 30 s → hysteresis too weak.
- `EAR rel` ≈ 1.0 with eyes clearly shut → bad baseline; recalibrate.
- FPS < 15 → note the delegate; feeds the v0.5 low-end target.
