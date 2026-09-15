# Model files

These are the MediaPipe model assets the perception layer loads at
`/models/*` at runtime. They are **not checked into the repo** (they are
large binaries) and must be downloaded once, locally, before `npm run dev`
will produce a working camera screen. Downloading happens at build time on
your machine, not at runtime in the shipped app - the running app never
makes a network request (CLAUDE.md constraint 2).

| File | Approx. size | Used by |
|---|---|---|
| `face_landmarker.task` | ~3.6 MB | `src/perception/face.ts` (`FaceLandmarker`) |
| `blaze_face_short_range.tflite` | ~225 KB | `src/perception/faceBox.ts` (`FaceDetector`) - live calibration preview overlay only |
| `efficientdet_lite0.tflite` | ~4.5 MB | **Legacy** - the current (old) runtime: `src/perception/objects.ts` (`ObjectDetector`). Retired once Phase 3 switches the runtime to the AI integration |
| `edl2_float16.tflite` | ~12.1 MB | **SELECTED object-detector model** (EfficientDet-Lite2, float16) for the new AI integration (`src/ai/**`). This decision is final - do not substitute `edl0_float16.tflite`. Fetched ahead of the runtime switch; consumed by the AI runtime from Phase 3 onward |

## Download

```bash
curl -L -o public/models/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

curl -L -o public/models/efficientdet_lite0.tflite \
  https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite

curl -L -o public/models/blaze_face_short_range.tflite \
  https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite

curl -L -o public/models/edl2_float16.tflite \
  https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite
```

All URLs are Google's public MediaPipe model bucket (the same source
referenced in PRD §4). If Google reorganizes the bucket path, check
https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker and
https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector for
the current `.task` / `.tflite` links.

## Verify

After downloading, `public/models/` should contain exactly these four
model files plus this README. The current runtime points at
`/models/face_landmarker.task`, `/models/efficientdet_lite0.tflite`, and
`/models/blaze_face_short_range.tflite`; the upcoming AI integration will
load `/models/edl2_float16.tflite` - do not rename any of them without
updating the corresponding file.

> The actual runtime replacement of the object detector happens in
> **Phase 3**. Until then the old runtime (`src/perception/objects.ts`)
> remains active and keeps using `efficientdet_lite0.tflite`.
