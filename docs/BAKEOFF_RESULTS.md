# HACHIKO v0.3 — Perception Bake-off Results

> **STATUS: TEMPLATE — PENDING LIVE EXECUTION.**
> No rows are filled in. Run the matrix on real hardware and paste the exported
> JSON / fill this table. Do not wire any model into production until it is done.

## Why this bake-off exists

Gate-4 diagnostics on the production candidate (EfficientDet-Lite0 **INT8**)
showed the detector *working* but not *accurate enough*:

- a real frontal seated person peaked around **~0.11** confidence
- a large, clearly visible phone often produced **no detection at all**
- irrelevant classes appeared at **comparable** confidence

A person at 0.11 is indistinguishable from noise, so no threshold change can
rescue it. That is a model-capability problem.

## How to run

```bash
npm run bench:assets     # downloads the 4 candidates into public/assets/bench/
npm run dev              # then open http://localhost:5173/benchmark.html
```

For each candidate: load it, hold each scenario steady ~3 s, press the scenario
button. The peak observation over the window is recorded. Negative controls
(`empty_frame`, `no_phone`) measure false positives — do not skip them.

`*` marks HACHIKO-critical scenarios, weighted **double** in scoring.

## Results

| Model | Task | Scenario | Detected? | Max score | False positive? | Inference ms |
|---|---|---|---|---|---|---|
| edl0-f16 | person | frontal_seated |  |  |  |  |
| edl0-f16 | person | closer |  |  |  |  |
| edl0-f16 | person | farther |  |  |  |  |
| edl0-f16 | person | upper_body_only |  |  |  |  |
| edl0-f16 | person | extreme_yaw * |  |  |  |  |
| edl0-f16 | person | back_facing * |  |  |  |  |
| edl0-f16 | person | face_covered * |  |  |  |  |
| edl0-f16 | person | reading_writing * |  |  |  |  |
| edl0-f16 | person | empty_frame * |  |  |  |  |
| edl0-f16 | phone | screen_portrait |  |  |  |  |
| edl0-f16 | phone | screen_landscape |  |  |  |  |
| edl0-f16 | phone | back_portrait |  |  |  |  |
| edl0-f16 | phone | back_landscape |  |  |  |  |
| edl0-f16 | phone | near_camera |  |  |  |  |
| edl0-f16 | phone | study_distance * |  |  |  |  |
| edl0-f16 | phone | on_desk * |  |  |  |  |
| edl0-f16 | phone | partly_occluded * |  |  |  |  |
| edl0-f16 | phone | no_phone * |  |  |  |  |
| edl2-f16 | person | frontal_seated |  |  |  |  |
| edl2-f16 | person | closer |  |  |  |  |
| edl2-f16 | person | farther |  |  |  |  |
| edl2-f16 | person | upper_body_only |  |  |  |  |
| edl2-f16 | person | extreme_yaw * |  |  |  |  |
| edl2-f16 | person | back_facing * |  |  |  |  |
| edl2-f16 | person | face_covered * |  |  |  |  |
| edl2-f16 | person | reading_writing * |  |  |  |  |
| edl2-f16 | person | empty_frame * |  |  |  |  |
| edl2-f16 | phone | screen_portrait |  |  |  |  |
| edl2-f16 | phone | screen_landscape |  |  |  |  |
| edl2-f16 | phone | back_portrait |  |  |  |  |
| edl2-f16 | phone | back_landscape |  |  |  |  |
| edl2-f16 | phone | near_camera |  |  |  |  |
| edl2-f16 | phone | study_distance * |  |  |  |  |
| edl2-f16 | phone | on_desk * |  |  |  |  |
| edl2-f16 | phone | partly_occluded * |  |  |  |  |
| edl2-f16 | phone | no_phone * |  |  |  |  |
| ssd-mnv2-f32 | person | frontal_seated |  |  |  |  |
| ssd-mnv2-f32 | person | closer |  |  |  |  |
| ssd-mnv2-f32 | person | farther |  |  |  |  |
| ssd-mnv2-f32 | person | upper_body_only |  |  |  |  |
| ssd-mnv2-f32 | person | extreme_yaw * |  |  |  |  |
| ssd-mnv2-f32 | person | back_facing * |  |  |  |  |
| ssd-mnv2-f32 | person | face_covered * |  |  |  |  |
| ssd-mnv2-f32 | person | reading_writing * |  |  |  |  |
| ssd-mnv2-f32 | person | empty_frame * |  |  |  |  |
| ssd-mnv2-f32 | phone | screen_portrait |  |  |  |  |
| ssd-mnv2-f32 | phone | screen_landscape |  |  |  |  |
| ssd-mnv2-f32 | phone | back_portrait |  |  |  |  |
| ssd-mnv2-f32 | phone | back_landscape |  |  |  |  |
| ssd-mnv2-f32 | phone | near_camera |  |  |  |  |
| ssd-mnv2-f32 | phone | study_distance * |  |  |  |  |
| ssd-mnv2-f32 | phone | on_desk * |  |  |  |  |
| ssd-mnv2-f32 | phone | partly_occluded * |  |  |  |  |
| ssd-mnv2-f32 | phone | no_phone * |  |  |  |  |
| pose-lite | pose | frontal_seated |  |  |  |  |
| pose-lite | pose | closer |  |  |  |  |
| pose-lite | pose | farther |  |  |  |  |
| pose-lite | pose | upper_body_only |  |  |  |  |
| pose-lite | pose | extreme_yaw * |  |  |  |  |
| pose-lite | pose | back_facing * |  |  |  |  |
| pose-lite | pose | face_covered * |  |  |  |  |
| pose-lite | pose | reading_writing * |  |  |  |  |
| pose-lite | pose | empty_frame * |  |  |  |  |

## Per-candidate summary

| Candidate | Person recall | Phone recall | False positives | Mean true score | Median ms | p95 ms | Size |
|---|---|---|---|---|---|---|---|
| edl0-f16 |  |  |  |  |  |  | 7.25 MB |
| edl2-f16 |  |  |  |  |  |  | 12.14 MB |
| ssd-mnv2-f32 |  |  |  |  |  |  | 11.32 MB |
| pose-lite (presence only) |  | n/a |  |  |  |  | 5.78 MB |

## Decision

The harness computes this live from the trials, using the documented rules:

- **Rule 1** — one detector adequate for BOTH tasks -> `ONE_MODEL`
- **Rule 2** — phone adequate, person not, pose adequate -> `SPLIT_MODEL`
- **Rule 3** — never trade reliability for one-model elegance;
  high recall at unusable confidence (e.g. 0.11) does **not** count as adequate

Bars: recall >= 0.85 on weighted scenarios, mean true confidence >= 0.35.

**Recommendation:** _pending live data_

## Notes / observations

_Record here: lighting, distance, framing, any class that competed with the
target at similar confidence, and whether the UI stuttered._
