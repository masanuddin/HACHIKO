# Head Pose Convention — HACHIKO AI v0.2

Head pose is the signal most likely to be silently wrong, so this document
states the convention explicitly and gives a procedure to verify it on your rig.

## Source of the angles

We do **not** use `solvePnP`. MediaPipe Face Landmarker already solves the rigid
head transform internally and exposes it via
`outputFacialTransformationMatrixes: true`, returning a 4×4 matrix per face.

The Python research harness ([baseline_detection.py](../baseline_detection.py),
`get_head_pose`) instead fed 6 landmarks into `cv2.solvePnP` with a guessed focal
length (`focal_length = w`), zero distortion coefficients, and a generic 3D head
model, then ran the result through `cv2.decomposeProjectionMatrix`. That returned
an un-normalized Euler branch: **98.5% of the pitch values in
[log_20260820_112600.csv](../log_20260820_112600.csv) sat within 40° of ±180°**,
with a median of −167.75°. Only 4 of 5,609 rows landed in a plausible
[−45°, 45°] range. Those values were unusable.

Using MediaPipe's matrix removes the guessed intrinsics, the extra solve, and
the wrap bug in one step.

## Pipeline

```
facialTransformationMatrixes[0]        4x4, flat `data` + rows/columns
  -> detectMatrixLayout()              infer column-major vs row-major
  -> rotationFromMatrix()              extract the 3x3 rotation block
  -> isValidRotationMatrix()           reject reflections / scaled / degenerate
  -> rotationMatrixToEuler()           intrinsic Y-X-Z decomposition
  -> normalizeAngleDeg()               force into (-180, 180]
  -> plausibility gate                 reject |yaw|>90, |pitch|>75, |roll|>75
```

Every stage can reject. **A rejection never becomes 0°** — it returns
`poseValid: false` with `yawRaw/pitchRaw/rollRaw = null` and a machine-readable
`poseInvalidReason`. This is the single most important difference from the
Python harness, whose `get_head_pose` returned `0.0, 0.0` when `solvePnP`
failed, making "solve failed" indistinguishable from "looking straight ahead".

## Decomposition

Intrinsic **Y-X-Z** (yaw about Y, then pitch about X, then roll about Z), the
natural parameterisation for a head. Expanding `R = Ry(yaw)·Rx(pitch)·Rz(roll)`:

```
R[1][2] = -sin(pitch)
R[0][2] =  sin(yaw)   * cos(pitch)      R[2][2] = cos(yaw)   * cos(pitch)
R[1][0] =  cos(pitch) * sin(roll)       R[1][1] = cos(pitch) * cos(roll)
```

giving

```
pitch = asin(-R[1][2])
yaw   = atan2(R[0][2], R[2][2])
roll  = atan2(R[1][0], R[1][1])
```

These are verified by exact round-trip tests over composed rotations in
[tests/math.test.js](../tests/math.test.js) (`rotationMatrixToEuler round-trips
combined rotations`).

**Gimbal lock** (pitch → ±90°, i.e. looking straight up or down) is detected
explicitly: yaw absorbs the rotation and roll is pinned to 0, rather than
emitting the wrapped ±180° artefact.

## Units and range

- All angles in **degrees**.
- All angles normalized to **(−180, 180]**.
- After the plausibility gate, valid values satisfy |yaw| ≤ 90, |pitch| ≤ 75,
  |roll| ≤ 75.

## Sign convention

Right-handed, camera facing the user, on the **unmirrored** frame. This is the
**canonical** convention: every value downstream of `HeadPoseExtractor` —
`yawRaw`/`pitchRaw`/`rollRaw`, the calibrated deltas, smoothing, evidence,
state, telemetry — already obeys it.

| Axis | Positive means | Student action |
|---|---|---|
| `yaw` > 0 | turns toward their own **left** (appears on the right of an unmirrored frame) | looking left |
| `pitch` > 0 | looks **up** | chin raised |
| `pitch` < 0 | looks **down** | reading, writing, notes |
| `roll` > 0 | tilts head toward their own **right** shoulder | head tilt |

### Canonicalization boundary — `invertPitch: true`

**A real Gate-1 webcam run showed MediaPipe reports pitch with the OPPOSITE
sign to this convention on the test rig:**

| Physical action | Device pitch delta | Canonical pitch delta |
|---|---|---|
| LOOK UP | −46.4° | **+46.4°** |
| LOOK DOWN | +21.8° | **−21.8°** |

`config.headPose.invertPitch` is therefore set to `true`. It is applied once,
inside `HeadPoseExtractor`, which is **the single canonicalization boundary**.

This matters because v0.2 evidence is directional: upward pitch is STRONG
(may trigger TERALIH), downward pitch is SUPPORT-only (never can). Left
uncorrected, the two were exactly swapped — looking down at a book accumulated
STRONG evidence while looking up was treated as study-compatible.

**Never compensate for a device's axis direction anywhere else.** If a
different camera reports the opposite raw sign, re-run Gate 1 and flip this
flag — do not touch the comparisons in `EvidenceEngine`.

Yaw and roll were verified unchanged (`invertYaw`/`invertRoll` remain `false`).

### Why mirroring matters

The debug preview is mirrored via CSS (`video.mirror`) purely for user comfort —
people expect a mirror. **The frame handed to MediaPipe is never mirrored.**

The Python harness called `cv2.flip(frame, 1)` *before* inference
([baseline_detection.py:162](../baseline_detection.py#L162)), which negates yaw.
Because its rule used `abs(yaw)` the error was invisible, but the sign
convention was undefined — and v0.1 reports signed `yaw_raw`, so it must be
well-defined. Keeping inference on the unflipped frame is what makes the table
above meaningful.

## Manual verification procedure

Sign conventions must be confirmed on real hardware, not assumed. Run
`npm run dev`, open the harness, click **Start Camera**, then **Calibrate**, and
check the raw values:

| Action | Expect | Failure means |
|---|---|---|
| Face the screen | yaw ≈ 0, pitch ≈ 0, roll ≈ 0 (after calibration, deltas ≈ 0) | camera or seating badly off-axis |
| Turn head **left** | `yaw_raw` goes **positive** | set `invertYaw: true` |
| Turn head **right** | `yaw_raw` goes **negative** | set `invertYaw: true` |
| Look **up** | `pitch_raw` goes **positive** | set `invertPitch: true` |
| Look **down** | `pitch_raw` goes **negative** | set `invertPitch: true` |
| Tilt toward **right** shoulder | `roll_raw` goes **positive** | set `invertRoll: true` |
| Cover the camera | `Pose` shows `INVALID (NO_FACE)`, angles show `—`, **never 0.0** | pose-validity regression |

All three inversion switches live in `headPose` in
[src/ai/config.js](../src/ai/config.js). Changing them requires no code edits.

## Matrix layout

MediaPipe returns `MatrixData`: a flat `data` array plus `rows`/`columns`. The
proto's documented packing is **column-major**, but `matrixLayout: 'auto'`
(the default) infers it from the data instead of trusting the documentation:
a rigid transform stores translation in the last column (flat indices 12–14) or
the last row (3, 7, 11), and whichever complementary triple is ≈0 identifies the
layout. Override with `'column-major'` / `'row-major'` if needed.
