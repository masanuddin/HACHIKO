# HACHIKO — Build Spec
**v3.1 FINAL · 26 Aug 2026 · Browser / laptop**

Builder: Ivan, solo, ~12 hrs/week
Submit: **7 Oct 2026** (41 days) · Pitch live: **21 Oct 2026**

> **Platform is locked: browser app on a laptop.** Not native Android, not a PWA, not Electron/Tauri. This is settled — reopening it costs more than any option wins.
>
> This spec implements the architecture from the team's *Decision Brief v0.1* — pretrained perception + rule/state engine + human context + validation set — with four changes flagged 🔺 where the brief was incomplete.

### Companion files

| File | For |
|---|---|
| **`CLAUDE.md`** | Repo guardrails. Claude Code reads this automatically. |
| **`BUILD_PROMPTS.md`** | Six staged prompts, run in order. P2 is the whole project. |
| **`HACHIKO_VALIDATION_KIT.md`** | Consent form, WhatsApp scripts, questionnaires. Start recruiting now. |

This PRD is the source of truth. If a build prompt and the PRD disagree, the PRD wins.

---

## 1. What you're building

A web app the student opens on their laptop. The webcam watches their posture while they study. A dog sleeps while they focus and wakes when they drift. At the end of a Pomodoro they see how many minutes they were *actually* focused versus how many they sat.

No accounts. No server. No parent dashboard. Nothing leaves the browser tab.

### The finding that shapes everything

Your own pilot:

| Scenario | Classified "Fokus" |
|---|---|
| Reading a book (head down) | **54.4%** |
| Scrolling a phone (head down) | **56.6%** |

Those are the same number. **Face geometry alone cannot tell studying from scrolling.**

This is your most valuable asset, not your embarrassment. It's the arc judges score under design thinking: built the obvious thing → measured it → it failed in a specific way → here's the architecture that answers it. Lead the pitch with it.

---

## 2. Architecture — four separated layers

The core principle from the brief, and it's right: **don't make the AI guess information that isn't in the pixels.**

```
PERCEPTION     what the camera can see
  ↓            face landmarks (5 fps) + object detection (1 fps)
CONTEXT        what the camera can't see
  ↓            student declares their study media before the session
TEMPORAL       is this a glance or a pattern?
  ↓            EMA + asymmetric hysteresis
STATE          Fokus / Teralih / Tidak Hadir / Uncertain
```

**When evidence is insufficient, the system abstains.** It never invents a label. That honesty is a feature you present, not a limitation you hide.

---

## 3. Scope

### Build
- Onboarding + parental consent
- **Declared media** picker (pre-session) 🆕
- "Cek Posisi" framing check + 15s calibration
- Pomodoro 25/5, with a 2-min demo variant
- Perception: face landmarks **+ phone/laptop object detection** 🆕
- States: **Fokus / Teralih / Tidak Hadir / Uncertain** 🆕
- Hachiko, 4 states + escalation ladder
- **Deferred clarification card at break** 🆕
- Session Card (with honest Uncertain reporting)
- **Telemetry recording for offline ablation** 🆕
- `localStorage` only

### Don't build
❌ **Weekly Pattern** — cut for the semifinal; needs 7 sessions to appear and most testers won't reach it ❌ Accounts ❌ Settings screen ❌ Sound during focus blocks ❌ Screen-share / tab detection *(brief §2.5 drops it — agreed)* ❌ Character skins ❌ Full dark mode *(session view is dark, rest is cream)*

**Stretch, only if week 5 goes well:** Document Picture-in-Picture overlay (§9).

> **Scope warning.** The brief adds ~20h to a budget that was already full. Weekly Pattern is the cut that pays for it. If you slip again, cut the drowsiness state next — it's the least load-bearing.

---

## 4. Stack

| | |
|---|---|
| **Vite + TypeScript** | Skip the framework — six screens. React only if you already know it. |
| **`@mediapipe/tasks-vision`** | Both models come from one library |
| → `FaceLandmarker` | `VIDEO` mode, GPU delegate, **5 fps** |
| → `ObjectDetector` | **EfficientDet-Lite0**, COCO-80, **1 fps** 🔺 |
| **`localStorage`** | sessions + declared media |
| **Hand-drawn SVG / canvas** | no charting library |
| **Lottie**, or 4 static SVGs + CSS breathing | static ships fine |
| **Plus Jakarta Sans** + **Inter** | free; Plus Jakarta Sans is Indonesian (Tokotype) — worth a pitch line |
| **Material Symbols Rounded** | never SF Symbols |
| **Netlify / Vercel** | free HTTPS, which `getUserMedia` requires |
| Target | **Chrome / Edge desktop.** Say so in onboarding. |

### 🔺 Change 1 — object detection is core, not optional

The brief marks it *"optional; terutama phone."* It can't be optional. It is **the only automatic signal that separates the two conditions your pilot measured as identical.** And on laptop you have no accelerometer, so there is no other measured signal at all — everything else is inference.

COCO-80 gives you `cell phone`, `laptop`, `book`, `keyboard`, `mouse`. EfficientDet-Lite0 is ~28ms, so 1 fps costs you almost nothing.

**But be honest about its blind spot:** a laptop webcam sits at eye level looking horizontally. A phone *held up* is in frame. A phone *flat on the desk* is not — and neither is the book. Head-down-at-desk stays ambiguous. That residual is exactly what `Uncertain` exists for. Write that limitation into the paper rather than letting a judge find it.

### Setup

```bash
npm create vite@latest hachiko -- --template vanilla-ts
npm i @mediapipe/tasks-vision
```

Download `face_landmarker.task` and `efficientdet_lite0.tflite` into `/public/models/`.

```ts
const vision = await FilesetResolver.forVisionTasks(
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
)

const face = await FaceLandmarker.createFromOptions(vision, {
  baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate: "GPU" },
  runningMode: "VIDEO",
  numFaces: 1,
  outputFaceBlendshapes: true,              // eye closure
  outputFacialTransformationMatrixes: true, // head pose
})

const objects = await ObjectDetector.createFromOptions(vision, {
  baseOptions: { modelAssetPath: "/models/efficientdet_lite0.tflite", delegate: "GPU" },
  runningMode: "VIDEO",
  scoreThreshold: 0.4,
  categoryAllowlist: ["cell phone", "laptop", "book", "keyboard"],
})
```

⚠️ For offline support, self-host the WASM bundle instead of the CDN and precache it in the service worker along with both models. Your paper claims it works offline after one load — that claim is false unless you do this.

### ⚠️ Background-tab throttling — test this in week 1

`requestAnimationFrame` is throttled when a desktop tab loses focus, which would freeze your detection loop the moment the student switches to their study tab.

Use **`video.requestVideoFrameCallback()`** instead — it's driven by the video stream, not the compositor, and keeps firing while the camera is live. **Verify this behaves under a backgrounded tab in week 1.** It is load-bearing for the whole laptop premise.

### 🔑 Keep the engine pure

`FocusEngine` is **plain TypeScript — no DOM, no browser APIs.**

```ts
type Perception = {
  t: number
  faceFound: boolean
  yaw: number; pitch: number
  eyeBlink: number
  objects: string[]        // from the 1 fps detector
}

type Context = { declaredMedia: Media[]; cone: Cone; pomodoroPhase: Phase }

function step(p: Perception, ctx: Context): FocusState
```

~300 lines. Camera, storage, and UI all live outside it. Two payoffs: you can unit-test thresholds without a camera, and §11 becomes nearly free.

---

## 5. Perception

### Head pose

```ts
// 3x3 rotation part R of the 4x4 facialTransformationMatrix
const pitch = Math.atan2(-R[2][0], Math.hypot(R[2][1], R[2][2]))
const yaw   = Math.atan2(R[1][0], R[0][0])
const roll  = Math.atan2(R[2][1], R[2][2])
```

⚠️ **Verify signs empirically.** Log all three, move your head deliberately, label by observation. Budget 30 minutes. MediaPipe's axis convention has bitten people.

*Fallback:* nose tip (idx 1) offset from the eye-corner midpoint (33, 263), normalised by inter-ocular distance.

### Calibration — 15 seconds

1. *"Duduk seperti biasanya kamu belajar."*
2. Sample yaw + pitch at 5 fps for 15s
3. **Discard the first 3 seconds** (settling)
4. Mean μ and std dev σ per axis
5. Cone = `μ ± max(2.5σ, 12°)`

The `max()` floor matters — a very still student would otherwise get an impossibly tight cone and be flagged for breathing.

**Recalibrate every session.** 15 seconds, and posture changes with desk, chair, and time of day.

> Note what calibration does and doesn't fix. It makes head-down normal *for a book reader*. It does **not** separate book from phone — both are head-down. Only the object detector and the declaration do that.

### Drowsiness

Average `eyeBlinkLeft` + `eyeBlinkRight`. Sustained > 0.6 for 4s → `MENGANTUK`. Ten lines.

### Absence

No face for 5 continuous seconds → `TIDAK HADIR`, pause the timer.

### Smoothing

```
EMA on yaw/pitch:  s_t = 0.25 * x_t + 0.75 * s_{t-1}

Asymmetric hysteresis:
  FOKUS   → TERALIH : 3.0s continuously outside the cone
  TERALIH → FOKUS   : 1.5s continuously inside the cone
```

The asymmetry is deliberate: **distraction is hard to trigger, recovery is easy.** That's your attribution psychology written into the constants. Say so in the pitch — it shows the psychology drove the engineering.

---

## 6. Context — declared media

Before each focus block: *"Sesi ini kamu belajar pakai apa?"*

`Layar/laptop` · `HP/tablet` · `Buku/LKS` · `Kertas/nulis` · `Campuran` · `Lainnya`

Multi-select. One tap. Valid for that block; updatable at the next break.

**Declaration is context, never a verdict.** Declaring "HP" does not make phone use focus. It only means *phone presence is no longer evidence of distraction.*

---

## 7. The decision table — this is the heart

### 🔺 Change 2 — declared media + detected object = high confidence

The brief says all phone events defer to the break. **That removes Hachiko's heart.** Your emotional core is *"Hachiko wakes when you drift"* — if the most common drift always defers, Hachiko almost never wakes during a session, and you've optimised for measurement honesty by deleting the intervention.

But a phone appearing when the student declared "book" is **not semantically ambiguous.** They already told you the phone wasn't part of this session. That clears the brief's own bar in §2.9 step 4 — high-confidence, context-independent — so it earns a real-time cue.

| Declared | Head in cone | Phone seen ≥15s | → State |
|---|---|---|---|
| Buku / Kertas | ✅ | ❌ | **FOKUS** |
| Buku / Kertas | ✅ | ✅ | **TERALIH** ← real-time cue |
| Buku / Kertas | ❌ | ❌ | **UNCERTAIN** → clarify at break |
| Buku / Kertas | ❌ | ✅ | **TERALIH** ← real-time cue |
| Laptop | ✅ | ❌ | **FOKUS** |
| Laptop | ✅ | ✅ | **TERALIH** ← real-time cue |
| Laptop | ❌ | — | **UNCERTAIN** |
| HP / Campuran | ✅ | — | **FOKUS** |
| HP / Campuran | ❌ | — | **UNCERTAIN** |
| *any* | no face 5s | — | **TIDAK HADIR** (timer pauses) |

Read the pattern: **phone presence means nothing when they declared phone, and a lot when they didn't.** That's the whole contribution of the context layer, and it's exactly what the brief was reaching for.

### Timer

| State | Timer | Counts as |
|---|---|---|
| FOKUS | runs | focus minute |
| TERALIH | runs | sitting, not focus |
| UNCERTAIN | runs | held separately, resolved at break |
| TIDAK HADIR | **paused** | nothing |

---

## 8. Uncertain and the clarification card

### 🔺 Change 3 — pre-register a failure threshold

The brief lists abstention rate as a metric but sets no target. If 60% of a session comes back Uncertain, the Session Card says nothing and the product has failed while every individual metric still looks healthy.

**Commit before you measure:**

> **Uncertain must be under 20% of session time. Above that, the context layer has failed and the design needs rework.**

Pre-registering a failure condition is good science and a strong line in the pitch. Very few student teams do it.

### The break card — maximum one

> *"Tadi ada beberapa momen kamu sepertinya terlihat kurang fokus. Kamu beneran masih fokus kan, atau ada distraksi?"*
> `Baca buku` · `Pegang HP` · `Campuran` · `Lewati`

Rules:
- **Never ask during a focus block.** Never.
- **One card per break**, grouping all ambiguous events.
- **No answer → stays Uncertain.** Never coerce it into Fokus or Teralih.
- Answers apply to *that group of events*, not forever.

### Session Card — report Uncertain honestly

```
Menit fokus       14 dari 25
Waktu balik       rata-rata 1m 40d
Fokus pertama runtuh   menit ke-9
Belum jelas       3 menit
```

Showing "belum jelas" is not a weakness. It's the visible proof of the abstain principle, and it's the thing that makes the other numbers trustworthy.

### Recovery time (*waktu balik*) ⭐ — don't lose this

```
recovery_time = seconds from TERALIH → FOKUS, per event
```

It survives this whole context debate untouched, because it measures **transitions, not semantics.** Still your strongest innovation claim: it comes from Leroy (2009) which you already cite, no competitor measures it, and it's kind — a student whose recovery drops from 90s to 20s is improving even if their distraction count is flat.

---

## 9. Screens

**S1 Selamat Datang** — first name only. No account. Note that Chrome or Edge is needed.

**S2 Izin Orang Tua** — §14.

**S3 Cek Posisi** — live preview, target zone. *"Pastikan wajahmu masuk kotak."* Laptop geometry is friendly here — the webcam is already near eye level.

**S4 Kalibrasi** — 15s countdown, **preview visible with landmark dots drawn on the face.** Don't hide it. Watching the dots track you builds more trust than any privacy paragraph.

**S5 Pilih Media** 🆕 — *"Sesi ini kamu belajar pakai apa?"* Six chips, multi-select, one continue button.

**S6 Sesi** *(main)*
- Timer large, Hachiko below
- State label, "Jeda", "Selesai"
- Camera indicator dot, permanently visible — non-negotiable
- **No focus counter, no distraction count, no percentage during the session**

**S7 Klarifikasi** (at break, only if there were ambiguous events) — one card, four buttons.

**S8 Kartu Sesi** — focus/sitting, median recovery, first collapse, uncertain minutes. One plain observation, never a judgment:
- ✅ *"Fokusmu paling kuat di 12 menit pertama."*
- ❌ *"Kamu terdistraksi 8 kali."*

### Stretch — Document Picture-in-Picture

On desktop Chrome the overlay is available again, and on laptop it matters: **the machine that watches is also the machine that tempts.** Without it, the student switches tabs and Hachiko disappears.

```ts
const pip = await documentPictureInPicture.requestWindow({ width: 220, height: 160 })
pip.document.body.append(hachikoElement)
```

~50 lines. Build it in week 5 **only if** everything else is done. It is the highest-value stretch item you have.

---

## 10. Design

You're building a desktop web app now, so most One UI mobile guidance doesn't apply. What still does:

| Your iOS reflex | Do instead |
|---|---|
| SF Pro | **Plus Jakarta Sans + Inter.** SF Pro is Apple-platform-licensed — shipping it is an actual violation |
| SF Symbols | **Material Symbols Rounded** |
| `easeInOut` curves | **Springs.** iOS easing reads as iOS |
| Dense, information-rich layout | **Calm and sparse.** This is a focus tool, not a dashboard |

### Rules

- **Never use red.** Not for distraction, not for anything. Red is judgment; judgment is what you're removing. Sage for focus, amber for attention.
- **Session view is dark** (`#14110F`), everything else cream. A bright screen glowing at a student for 25 minutes in a bedroom is hostile — and the darkness makes Hachiko's waking legible in peripheral vision.
- Max content width ~720px, centered. A full-width 1440px layout will look like an admin panel.

```
Cream       #FDF8F3   background
Warm sand   #F5EBE0   cards
Amber       #E8934A   Hachiko / primary
Deep amber  #C4692A   pressed
Ink         #2B2622   text
Muted ink   #8A7F76   secondary
Sage        #7A9471   focus state
Night       #14110F   session view
```

### ⚠️ Your mockups are now wrong twice over

Lampiran B shows **iPhone frames with a Dynamic Island and Apple stock icons** — wrong platform *and* wrong device class. Rebuild them as **desktop browser screens**. Use real screenshots from the running app for the final deck; judges can tell a Figma render from a real screenshot, and a real one signals "this exists."

---

## 11. Telemetry and the ablation — nearly free

### 🔺 Change 4 — you don't need three studies

System A/B/C don't need three builds or three cohorts. Record raw perception once per validation session, then **replay the same recordings through the engine with different config flags.**

```
JSONL, one row per frame:
{ t, faceFound, yaw, pitch, eyeBlink, objects: ["cell phone"] }
```

5 fps × 25 min ≈ 7,500 rows ≈ ~600KB. Written to `localStorage`, exported as a file the student chooses to send you. **No server, no automatic upload** — the privacy claim stays intact.

Then offline:

| System | Config | Proves |
|---|---|---|
| **A** Visual only | ignore declaration + objects | baseline |
| **B** + declared media | declaration on, objects on | does context reduce false alerts? |
| **C** + clarification | replay recorded break answers | does deferred human input resolve the rest? |

Three numbers from one dataset. **~3 hours of analysis instead of ~20 hours of study design.** This only works because the engine is pure — that architectural rule pays for itself right here.

---

## 12. Six weeks

41 days. ~70 hours. Front-loads risk.

### Wk 1 · 26–30 Aug — *Prove the hard parts* (12h)
- [ ] Vite + TS on Netlify, HTTPS
- [ ] `getUserMedia`, FaceLandmarker, landmarks drawn on canvas
- [ ] **Log yaw/pitch/roll, label by moving your head**
- [ ] ObjectDetector at 1 fps — hold a phone up, confirm `cell phone` fires
- [ ] ⚠️ **Test `requestVideoFrameCallback` with the tab backgrounded**
- ✅ **Gate: angles correct, phone detected, loop survives a backgrounded tab.**
- ⚠️ Any of the three failing by 30 Aug → tell me that day. No slack later.

### Wk 2 · 31 Aug–6 Sep — *The engine* (12h)
- [ ] Calibration: μ, σ, cone
- [ ] EMA + asymmetric hysteresis
- [ ] **The §7 decision table**, as pure TS
- [ ] Uncertain accumulation
- [ ] JSONL telemetry recorder
- [ ] Debug screen: current state + declared media + detected objects, as raw text
- ✅ **Gate: declare "buku", read a book → Fokus. Pick up a phone → Teralih within 15s.** That single sequence is your entire thesis working. Everything after is presentation.

### Wk 3 · 7–13 Sep — *A product, shipped ugly* (12h)
- [ ] Pomodoro wired to the state machine
- [ ] Session view + Cek Posisi + media picker
- [ ] Hachiko 4 states + breathing
- [ ] 🚀 **Send the link to 5 students on 13 Sep.** Ugly is fine.

### Wk 4 · 14–20 Sep — *Memory and context* (12h)
- [ ] `localStorage` sessions
- [ ] Metrics incl. recovery time + uncertain %
- [ ] Session Card
- [ ] Clarification card at break
- [ ] Onboarding + consent
- [ ] Fix what the first 5 broke ← *the point of shipping early*

### Wk 5 · 21–27 Sep — *Polish + scale* (12h)
- [ ] Design pass (§10)
- [ ] Rebuild mockups as desktop screens
- [ ] 🚀 **Open to ~40 students on 21 Sep**
- [ ] *Stretch:* Document PiP overlay

### Wk 6 · 28 Sep–4 Oct — *Analyse* (12h)
- [ ] Post-tests in
- [ ] **Run the A/B/C ablation** over collected telemetry
- [ ] Cohen's kappa against human-coded video
- [ ] Record a 3-min demo video
- [ ] **Bug fixes only. No new features.**
- [ ] Real numbers into the paper

**5–7 Oct** submit · **8–21 Oct** rehearsal

> If a week slips, cut a feature. Never cut validation. Feasibility + Impact = 40% of the final score.

---

## 13. Validation

Full materials in `HACHIKO_VALIDATION_KIT.md`. **Distribution is a link again, so target ~40 recruited / ~25 active.**

**Get a real accuracy number.** Scripted scenarios — read a book 3 min, scroll a phone 3 min, leave the desk 1 min — with two people independently coding the reference video second-by-second. Compute **Cohen's kappa** between the humans first; if κ > 0.7 the ground truth is trustworthy. Then score the app against the agreed coding.

⚠️ **Ground truth must never come from the rules being tested.** Your brief already says this — it's the single most important methodological point in the document. Script the task; don't label from the output.

Report:
- Precision / recall / F1 per state
- False alerts per minute
- **Uncertain rate vs your 20% pre-registered threshold**
- Detection latency
- A/B/C ablation deltas
- Your failure modes, named first

---

## 14. Privacy and consent

### Close the legal gap

UU PDP 27/2022 treats biometric data as *data pribadi spesifik*; a child's personal data requires parental consent. Your users are 13. Face landmarks are biometric data. Local processing is a mitigation, **not an exemption.**

> **Parents consent to the app existing. Parents never see the data.**

One screen: what the camera does · never recorded or uploaded · no reports to parents, by design · checkbox and name.

90 minutes of work. Turns your biggest legal risk into a slide that shows maturity.

### Fix the contradiction

The paper says images are *"tidak pernah disimpan termasuk secara lokal"* — but Gambar 0 shows a login screen and you store session history. A judge will catch it.

- ✅ *Camera images* — never stored, anywhere
- ✅ *Derived numbers* — local only, never transmitted
- ❌ **Delete the login screen.** Ask for a first name on S1. There's nothing to log into.

### Demonstrate it

Open DevTools on stage, Network tab, run a full session. **Zero requests.** Then airplane mode and run it again.

> *"Kami tidak minta Anda percaya kebijakan privasi kami. Silakan lihat sendiri — tidak ada satu pun permintaan jaringan."*

Strongest 20 seconds in the pitch. It converts a promise into a demonstration.

⚠️ Telemetry export is **student-initiated file download only.** No automatic upload, ever, or the claim above becomes false.

---

## 15. Stage demo

Laptop is much easier than a phone here — it's the presenter machine, already wired to the projector.

**1. Lighting is still what breaks you.** Stage light is a harsh spotlight or near-darkness; both destroy face detection. Bring a **clip-on LED fill light.** Under Rp 100k, non-negotiable.

**2. Demo build with a 2-minute Pomodoro**, at its own URL. Not a query param you'll forget.

**3. Hidden override** — triple-click a corner to force a state. You'll probably never use it. Having it is the difference between a recoverable moment and a dead pitch.

**4. Recorded video queued on the next slide** regardless. Judges forgive a technical failure handled calmly; they don't forgive panic.

### 90-second script

1. Open the app. **DevTools Network tab visible.** Declare *"Buku"*. (15s)
2. Calibrate — 15s, landmark dots on your face. (15s)
3. Read the book. Hachiko sleeps. (10s)
4. **Look away. Hachiko wakes.** (10s)
5. **Look back. Hachiko sleeps instantly.** — *"Pemulihan lebih dihargai daripada kegagalan."* (10s)
6. 🔑 **Pick up a phone. Hachiko wakes and stays awake.** — *"Saya bilang mau baca buku. Dia tahu ini bukan buku."* (15s)
7. Session ends → **Kartu Sesi.** Point at recovery time and at "belum jelas". (15s)

**Step 6 is the pitch.** It's the moment that demonstrates the exact failure your pilot measured, now solved. Rehearse it until it's automatic.

---

## 16. Paper changes

**Do first**
1. 🔴 **Rebuild every mockup as a desktop browser screen.** Remove the iPhone, the Dynamic Island, every Apple icon.
2. 🔴 **Lead §3 or §7 with the 54.4% / 56.6% pilot finding.** It's your best evidence and it's currently buried.
3. 🔴 **Rewrite §10 Kontribusi AI** as the four-layer architecture: pretrained perception → temporal inference → contextual fusion → uncertainty handling. This is the direct answer to "AI integration looks thin."
4. 🔴 **Add the Uncertain state** to §5 Deskripsi Ide. Abstaining is a design decision you defend, not an omission.

**Then**
5. 🟠 Lead §7 Inovasi with **recovery time**.
6. 🟠 Add the consent flow to §4; fix the privacy contradiction; delete the login screen.
7. 🟠 **§8 Dampak Kesetaraan — be honest.** BPS 2024: **only 18.52% of Indonesian households own a computer/laptop**, against 92.92% for phones (Jakarta 39.33%, Papua Pegunungan 2.31%). Laptop-first is a real access ceiling. State it as a limitation with a phone version on the roadmap. Don't let a judge find it first.
8. 🟠 Update the flow diagram: **camera → face landmarks + object detection → temporal smoothing → context fusion → state (incl. Uncertain) → Session Card.** And 30 fps → 5 fps, with the frame-budget reasoning under Engineering.
9. 🟡 Add the A/B/C ablation and Cohen's kappa to the validation plan.
10. 🟡 Roadmap slide: phone version · Galaxy Book / DeX · Z Flip Flex Mode · Galaxy Watch heart rate for drowsiness.

---

## 17. Open items

1. **Hachiko's art — who?** If nobody, budget 4 hours for 4 static vector poses yourself. **Don't let art block the engine.**
2. **Which laptop are you testing on?** Test the worst machine you can find, not your own. A 2018 Celeron with an integrated GPU is what a lot of your users have.
3. **Can the other three help?** Even without code they can run validation in week 6 — 6 hours back exactly when you need them.
4. **Venue access before 21 Oct?** One lighting rehearsal beats another week of polish.

---

## Five things

1. **Lead with 54.4% vs 56.6%.** You measured your own failure. Almost nobody else will have.
2. **Object detection is core, not optional.** It's the only automatic discriminator you have left.
3. **Declared "buku" + phone seen = wake Hachiko now.** Don't defer that to the break; it's the whole product.
4. **Pre-register the 20% Uncertain threshold** before you measure.
5. **Ship the link on 13 September, ugly.** Three weeks of real usage beats one week of polish.

---

## Start here

1. `git init`, drop `CLAUDE.md` + this file in the root
2. Open `BUILD_PROMPTS.md`, run **P0**
3. Run **P1** — then hand-verify all four acceptance checks on a real laptop before writing another line

**P1 check 4 is the one that matters:** background the tab for 60 seconds and confirm the detection loop survived. Everything in this spec assumes a student switches to their study tab and HACHIKO keeps watching. If that's false, the laptop premise is broken and you need to know in week 1, not week 5.

In parallel, today: send the recruitment broadcast from the Validation Kit. Consent forms take days to come back and you need a cohort standing by on 13 September.

---

## 18. Current implementation status (handoff note)

> This section reflects the current build and supersedes the single-cycle
> "25/5" descriptions in §3/§7/§9 for the shipped product. Source of truth for
> the debugging handoff is `HACHIKO_SOURCE_OF_TRUTH.md`.

### Pomodoro

- Configurable work duration: 15 / 25 / 50 min.
- Configurable cycles: 1 / 2 / 3 / 4 putaran.
- Default: **25 min × 4 cycles**.
- Break: 5 min **between** cycles.
- No break after the final cycle.
- One Session Report for the entire sequence.

### Session semantics

One user-started Pomodoro sequence = one `SessionRecord`.

### Repeat

"Ulangi sesi" repeats the same duration + cycle count.

### Report

One report after the entire sequence.

### Status

Multi-cycle browser behavior is: **IMPLEMENTED IN CODE / RUNTIME BUG UNRESOLVED**.

- The source/build contains the expected cycle loop.
- Browser runtime still returns to the Session Card after the first break
  (observed `25 → 5 → Report` when 2 or 4 cycles are selected).
- Tests (`tsc` / `npm test` / `npm run build`) pass but do not verify this
  runtime behavior. Do not treat the feature as production-verified.

