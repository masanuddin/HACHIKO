# Obtaining the YOLO26n LiteRT artefact

**Use the official release asset. Do not export locally.**

Ultralytics publishes a ready LiteRT build, so the local export below is kept
only as a fallback for a variant that is not published.

## The artefact in use

| field | value |
|---|---|
| repo | `ultralytics/yolo-flutter-app` |
| release | `v0.6.6` |
| asset | `yolo26n_w8a32.tflite` |
| size | 2,875,553 bytes (measured) |
| sha256 | `d9cef07ce652ccfa9ce58e4ac8a4df98ff037739a9dad20a8afcae21b545df73` |
| quantisation | `w8a32` — INT8 weights, FP32 activations |
| input | 640 x 640 |

Fetch it into `public/assets/bench/` under its **upstream name** — renaming it
would break the link between the bytes on disk and the release they came from:

```bash
curl -L -o public/assets/bench/yolo26n_w8a32.tflite   https://github.com/ultralytics/yolo-flutter-app/releases/download/v0.6.6/yolo26n_w8a32.tflite
sha256sum public/assets/bench/yolo26n_w8a32.tflite
```

The path is covered by `.gitignore` (`public/assets/bench/`), like every other
benchmark model, so the binary is not committed.

### Verified in a real browser

Loaded through `@ultralytics/yolo@0.0.46` on `@litertjs/core@2.5.3`, served
over HTTP to headless Chrome:

```
task "detect" | device "cpu" | classCount 80
person 0 | cell phone 67
load 224 ms | steady-state 151-173 ms (median 163)
speed { preprocess 3.7, inference 156.6, postprocess 0.9 }
```

This `.tflite` embeds **no label table**; the runtime supplies the COCO-80 map
for a detect model. `resolveClassIds` still reads it back from the loaded
model and reports any disagreement with the registry, so a future asset with
different classes cannot pass silently.

---

# Fallback: exporting a LiteRT artefact locally

Only needed for a variant Ultralytics does not publish.

## Why LiteRT and not the published ONNX

`@ultralytics/yolo` picks its engine from the model: a `.tflite` runs on
LiteRT.js, a `.onnx` on ONNX Runtime Web. LiteRT.js is the faster browser path
on WebGPU, and it is the deployment route chosen for HACHIKO. The published
`yolo26n.onnx` would work, but it is a different runtime with different
performance characteristics, so it is not a silent substitute — if the LiteRT
artefact is missing, the candidate reports `MODEL_INIT_ERROR` instead.

## Why it cannot be exported on Windows

Ultralytics refuses the export outside Linux x86 / macOS:

```
AssertionError: LiteRT export only supported on Linux x86 and macOS
```

On Windows, run it in a Linux container. Docker Desktop with the default
`linux/x86_64` daemon is sufficient.

## Procedure

From the repository root, with `yolo26n.pt` in the working directory
(downloaded automatically on first export):

```bash
docker run --rm -v "$PWD:/w" -w /w python:3.12-slim bash -lc '
  pip install --quiet "ultralytics>=8.4.142"
  python -c "from ultralytics import YOLO; \
    print(YOLO(\"yolo26n.pt\").export(format=\"litert\", imgsz=640))"
'
```

`>=8.4.142` matters: earlier versions omit the embedded metadata (task, class
names, `imgsz`) that the browser runtime and the adapter's class resolution
both read.

The export writes a `*_saved_model/` directory containing several precisions.
Take the **float32** graph, rename it to match the registry, and place it:

```
public/assets/bench/yolo26n_float32.tflite
```

Then set `sizeBytes` on the `yolo26n` entry in `tools/benchmark/candidates.js`
to the exported file's exact byte count. The benchmark reports model size as a
feasibility metric, so a stale number is a wrong measurement, not a cosmetic
detail.

## Verifying the artefact

### Provenance: four separate facts

Do not collapse these. Only the first two are knowable before the export runs:

| fact | value | status |
|---|---|---|
| source release (weights) | `v8.4.0` | known |
| metadata version in the **inspected** `yolo26n.onnx` | `ultralytics 8.4.38` | known, describes *that* file |
| **export-tool version** that produces the `.tflite` | — | **unset until exported** |
| browser runtime | `@ultralytics/yolo@0.0.46` on `@litertjs/core@2.5.3` | known, pinned |

After exporting, set `exportToolVersion` on the `yolo26n` registry entry to the
Ultralytics version that actually ran (`python -c "import ultralytics;
print(ultralytics.__version__)"` inside the container), and `sizeBytes` to the
artefact's byte count. The `.tflite` must never inherit `8.4.38` — that number
came from a different file.

### Class indices

The class indices are **not** assumed. `resolveClassIds` reads them back from
the model's own `names` map at load time and reports any disagreement with the
registry. The expected values, read from the inspected `yolo26n.onnx`:

| field | value |
|---|---|
| task | `detect` |
| input | `640 x 640` |
| classes | 80 (COCO, no background row) |
| `person` | 0 |
| `cell phone` | **67** |
| metadata version (of the inspected .onnx) | `ultralytics 8.4.38` |

The phone index is the trap. EfficientDet and SSD put `cell phone` at 76 and
77; in COCO-80, index 76 is `scissors`. A copied index would score scissors as
a phone for an entire benchmark without ever throwing, which is why the model's
own metadata is authoritative and the registry value is only a cross-check.

## If the export is unavailable

Leave `public/assets/bench/yolo26n_float32.tflite` absent. The candidate stays
registered and visible, and every attempt is recorded as an explicit
invalid/error attempt with its reason. The benchmark remains auditable, and no
other model is substituted in its place.
