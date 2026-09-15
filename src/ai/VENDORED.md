# VENDORED — HACHIKO AI Core

## Provenance

- **Source repository/path**: `AI-Engine/src/ai/**` (the standalone HACHIKO AI/CV
  engine repository).
- **Vendored into**: `HACHIKO/src/ai/**`.
- **Method**: plain file copy, **byte-identical**. No git history was merged
  (no `git merge`, no subtree), no files were rewritten to TypeScript, and no
  algorithms, thresholds, calibration, smoothing, temporal logic, or
  phone-context semantics were modified.
- **Integration provenance date**: 2026-09-14 (Phase 1 of the HACHIKO AI
  integration; source state = AI-Engine commit `4a7e90b` "AI Engine Fix phone
  detection", package `hachiko-ai@0.2.1`).

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
