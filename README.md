# HACHIKO

A browser focus companion for Indonesian junior-high students. The webcam
watches posture during a Pomodoro study block; a small digital dog sleeps
while the student is focused and wakes when their attention drifts. No
accounts, no server, nothing leaves the browser tab. Full spec in
`HACHIKO_PRD.md`; repo guardrails in `CLAUDE.md`.

## Setup

```bash
npm install

# One-time local downloads (not committed - see each README for why):
#   public/models/README.md  - face_landmarker.task, efficientdet_lite0.tflite
#   public/fonts/README.md   - Plus Jakarta Sans + Inter variable woff2

npm run dev       # http://localhost:5173, needs Chrome or Edge and a webcam
```

`npm run dev` and `npm run build` both copy the MediaPipe WASM runtime out
of `node_modules` into `public/wasm/` first (`tools/copy-wasm.mjs`), so the
app never loads it from a CDN at runtime.

Until the model and font files above are downloaded, the app still starts:
the UI falls back to system fonts, and any screen that needs the camera
shows a plain-language message instead of a stack trace.

## Commands

```bash
npm run dev        # local dev server
npm run build      # tsc --noEmit, then vite build
npm test           # vitest, the engine's 20 unit tests
npm run typecheck  # tsc --noEmit only
node tools/replay.ts <telemetry.jsonl>  # A/B/C ablation (PRD §11), e.g.:
node tools/replay.ts fixtures/sample.jsonl --media=book --clarify=phone
```

`?debug` on the dev URL (e.g. `http://localhost:5173/?debug`) opens the
perception-only readout used for BUILD_PROMPTS P1's week-1 gate: live
landmark dots, numeric yaw/pitch/roll, eyeBlink, and detected objects.

## Structure

See `CLAUDE.md` for the full layout and hard constraints. In short:
`src/engine/` is pure TypeScript (no browser APIs, runs under Node in
tests); `src/perception/` wraps the camera and the two MediaPipe models;
`src/storage/` is `localStorage` only; `src/ui/` is plain DOM, no
framework. `tools/replay.ts` reuses the real engine to replay recorded
telemetry under different configs, which is what makes the ablation in
PRD §11 close to free.

## Notes

- **Telemetry retention.** `storage/telemetry.ts` keeps only the single
  most recent recording in `localStorage` (older ones are pruned) to stay
  well under the browser's storage quota - a recording can now cover a
  whole multi-cycle sitting rather than one fixed 25-minute block, so it
  no longer sizes to a fixed budget. JSONL is internal research/replay
  data (see `tools/replay.ts`); the user-facing Session Card download is
  the PDF report ("Unduh laporan sesi"), always a student-initiated file
  download, never an automatic upload.
- **Multi-cycle session flow.** The Ready screen lets the student pick a
  work duration (15/25/50 min) and how many rounds happen before a long
  break (1/2/3/4, default 4) - not a total cycle cap. After each work
  block, the Break screen itself asks "Fokus lagi?" / "Selesai untuk hari
  ini?", looping for as long as the student keeps choosing to continue;
  every Nth break is a long one instead of the usual 5 minutes. One
  sitting = one merged `SessionRecord` and one Session Card at the end.
  See `docs/superpowers/specs/2026-09-13-multi-cycle-pomodoro-port-design.md`.
- **Not yet verified on hardware.** The pose sign convention in
  `src/perception/pose.ts` and the background-tab survival of
  `requestVideoFrameCallback` in `src/perception/camera.ts` both need a
  real laptop check per PRD §5 and BUILD_PROMPTS P1's week-1 gate. Model
  and font files need a one-time local download - see
  `public/models/README.md` and `public/fonts/README.md`.
