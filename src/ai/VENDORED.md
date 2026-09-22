# VENDORED — HACHIKO AI Core

## Provenance

- **Source repository/path**: `AI-Engine/src/ai/**` (the standalone HACHIKO AI/CV
  engine repository).
- **Vendored into**: `HACHIKO/src/ai/**`.
- **Method**: plain file copy, **byte-identical**. No git history was merged
  (no `git merge`, no subtree), no files were rewritten to TypeScript, and no
  algorithms, thresholds, calibration, smoothing, temporal logic, or
  phone-context semantics were modified.
- **Integration provenance date**: 2026-09-22 (AI freeze integration; source
  state = AI-Engine commit `c474982` "freeze perception config: YOLO26n
  person/phone at 0.30").
- **Previous provenance**: 2026-09-14, AI-Engine commit `4a7e90b` "AI Engine
  Fix phone detection", package `hachiko-ai@0.2.1`.

## Frozen configuration carried by this copy

Two component freezes, both decided in AI-Engine from DEVELOPMENT evidence
and re-copied here unchanged. They are NOT tunable from this repository.

**Behavioral** (AI-Engine `6f6c55c`)

| parameter | value |
|---|---|
| strong yaw | 25° / 1500 ms |
| pitch-up | 30° / 2000 ms |
| pitch-down (SUPPORT only) | 10° / 2000 ms |
| roll (SUPPORT only) | 22° / 2000 ms |
| relative EAR | 0.70 / 3000 ms |
| eye eligibility \|pitch\| | 10° |
| eye eligibility \|yaw\| | 20° |
| EAR L/R ratio guard | 1.6 |
| invalid grace | 1000 ms |
| face-missing entry | 2000 ms |
| face-present recovery | 500 ms |
| state recovery | 750 ms |
| EMA α | 0.35 |

**Perception** (AI-Engine `c474982`), from 270 evaluable DEVELOPMENT trials

| parameter | value |
|---|---|
| model | `yolo26n_w8a32.tflite` |
| identity | 2,875,553 bytes · sha256 `d9cef07c…b545df73` |
| runtime | LiteRT.js via `@ultralytics/yolo` |
| Person class | 0 |
| Phone class | **67** (COCO-80; 76 is `scissors`) |
| Person / Phone acceptance | >= 0.30 / >= 0.30 |

One detector serves both Person and Phone in a single inference.

## Source of truth

**AI-Engine is the source of truth for CV/perception.** Any future change to
CV behavior, thresholds, calibration, smoothing, evidence rules, presence
fusion, or phone-context semantics must be made in AI-Engine first, validated
there, and then **re-copied** into this directory. Do NOT independently
re-implement or patch these files inside HACHIKO — that would create a second,
divergent CV pipeline.

This directory is consumed as plain ES modules. The public API is
`src/ai/index.js` — import from there only.

## Selected production object model

The object detector model selected for the HACHIKO integration is:

**`edl2_float16.tflite`** (EfficientDet-Lite2, float16).

Do not substitute `edl0_float16.tflite` or `efficientdet_lite0.tflite`.

> **NOTE:** model/asset preparation (fetch pipeline + documentation) was
> performed in **Phase 2** — `tools/fetch-assets.mjs` now fetches
> `public/models/edl2_float16.tflite` and `public/models/README.md` documents
> it as the selected production object model. The **runtime** switch (loading
> that model in the AI-Engine `ObjectDetectorEngine` and replacing the old CV
> path) happens in **Phase 3** and has NOT been performed yet. Until then the
> vendored `src/ai/config.js` still carries its original AI-Engine default
> asset paths — that is expected and must not be edited here.

## Verification

`diff -r AI-Engine/src/ai HACHIKO/src/ai` reports no differences (excluding
this file, which exists only in HACHIKO). Re-run that command whenever the
vendor copy is refreshed.
