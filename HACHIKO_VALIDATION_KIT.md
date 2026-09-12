# HACHIKO — Validation Kit
**Everything you hand to students, parents, and your branch coordinators.**

Copy-paste ready. Student- and parent-facing text is in Indonesian; instructions to you are in English.

---

## 0. The plan at a glance

| Date | Cohort | Goal |
|---|---|---|
| ~13 Sep | 5 students | Does it survive a real bedroom? |
| ~21 Sep | ~40 students | Retention + attribution shift |
| ~1 Oct | — | Analysis, ablation, numbers into the paper |

**Recruit through your six branches.** Most of your 500 members have an adik, sepupu, or neighbour in SMP. That's your sampling frame and it costs you one WhatsApp broadcast.

**Target: 40 recruited, ~25 active.** Distribution is a link, so there's no install barrier — recruit generously.

> ⚠️ **The real filter is laptop access, not install friction.** Only **18.52% of Indonesian households own a computer** (BPS 2024). Ask about laptop access in the recruitment form, or you'll collect consent from students who can't run the app. Screen for it up front.

### Two things to prepare

1. **A short, memorable URL.** `hachiko.netlify.app` or a bit.ly. Students will retype it.
2. **A separate demo URL** with a 2-minute Pomodoro, for the pitch.

Say **Chrome or Edge on a laptop** in every message. Safari and mobile browsers won't run this build.

---

## 1. Broadcast to branch coordinators

> Halo teman-teman pengurus! 🐕
>
> Tim kami lagi ikut Samsung Solve for Tomorrow 2026. Kami bikin **HACHIKO** — pendamping belajar yang ngukur *berapa lama kamu beneran fokus*, bukan cuma berapa lama kamu duduk.
>
> Kami butuh **siswa SMP (kelas 7–9)** buat nyobain selama 2 minggu.
>
> Kalau kamu punya adik / sepupu / tetangga yang SMP, boleh minta tolong diteruskan? Yang dibutuhkan:
> - Punya akses **laptop berkamera** (bisa laptop keluarga)
> - Pakai browser **Chrome atau Edge**
> - Mau belajar pakai HACHIKO minimal 3x seminggu
> - Izin orang tua (ada formnya, 2 menit)
>
> Nggak ada install, nggak ada daftar akun. Cukup buka link. Nggak ada data yang dikirim ke mana pun.
>
> Form pendaftaran: [LINK]
>
> Makasih banyak! 🙏

---

## 2. Parent consent form

**Build this as a Google Form.** You already used Forms for the earlier survey, so the workflow is familiar.

⚠️ SFT requires parental consent documents for under-18 participants, and UU PDP 27/2022 requires it separately for processing a minor's biometric data. One form covers both — but check whether SFT wants physical signatures. If so, also export a printable PDF version.

### Opening text

> **Izin Orang Tua — Uji Coba HACHIKO**
>
> Terima kasih sudah bersedia. Mohon dibaca sebentar sebelum mengisi.
>
> **Apa itu HACHIKO?**
> Sebuah alat bantu belajar yang dibuka lewat browser di laptop. Selama anak Anda belajar, kamera laptop mengenali apakah ia sedang fokus atau perhatiannya sedang buyar. Di layar ada seekor anjing digital yang tidur saat anak Anda fokus, dan bangun saat perhatiannya teralih.
>
> Sebelum mulai, anak Anda memilih sendiri media belajarnya (buku, laptop, HP, atau kertas). Ini penting: sistem sengaja **tidak menebak** hal-hal yang tidak bisa dilihat kamera. Bila buktinya tidak cukup, sistem menandainya "belum jelas" dan menanyakannya saat jeda — bukan mengarang kesimpulan.
>
> **Bagaimana dengan kameranya?**
> - Gambar dari kamera **tidak pernah direkam**, tidak pernah disimpan, dan tidak pernah dikirim ke mana pun.
> - Yang diproses hanya **koordinat titik wajah** — angka, bukan gambar. Dari angka-angka itu tidak mungkin dibentuk kembali menjadi wajah.
> - Seluruh proses berjalan di dalam browser di laptop anak Anda. Tidak ada server yang menerima apa pun.
> - Indikator kamera aktif selalu terlihat, dan sesi bisa dihentikan kapan saja.
>
> **Apa yang akan Anda terima?**
> **Tidak ada laporan.** Ini keputusan desain, bukan kelalaian.
>
> HACHIKO sengaja dibuat tanpa dasbor orang tua. Alasannya: alat yang diawasi akan disiasati. Anak akan menutup kamera, memalsukan sesi, atau berhenti memakainya. Kami ingin data yang jujur, dan data hanya jujur kalau data itu milik anak Anda sendiri.
>
> Yang kami harap Anda terima adalah kebiasaan belajar yang lebih baik — yang tumbuh dari kesadaran anak, bukan dari pengawasan.
>
> **Data penelitian**
> Aplikasi tidak mengirim apa pun secara otomatis. Untuk penelitian ini kami meminta dua hal, keduanya sukarela:
> 1. Kuesioner singkat sebelum dan sesudah masa uji coba.
> 2. Sebuah file ringkasan sesi yang **anak Anda unduh sendiri lalu kirimkan ke kami**, berisi angka-angka saja (sudut kepala, waktu, objek yang terdeteksi). **Tidak berisi gambar apa pun.**
>
> Partisipasi bisa dihentikan kapan saja tanpa alasan, dan seluruh data penelitian akan dihapus setelah kompetisi selesai.

### Fields

| Field | Type |
|---|---|
| Nama orang tua/wali | Short text |
| Nama anak | Short text |
| Kelas (7 / 8 / 9) | Multiple choice |
| Nomor WhatsApp yang bisa dihubungi | Short text |
| **Anak saya punya akses ke laptop berkamera** | ✅ Required checkbox — *screen for this or you'll collect consent from students who can't run it* |
| Saya mengizinkan anak saya ikut uji coba HACHIKO | ✅ Required checkbox |
| Saya memahami kamera hanya berjalan di perangkat, dan tidak ada gambar yang direkam, disimpan, atau dikirim | ✅ Required checkbox |
| Saya memahami bahwa saya **tidak** akan menerima laporan aktivitas belajar anak saya, dan ini memang disengaja | ✅ Required checkbox |
| Anak saya bersedia mengisi kuesioner sebelum dan sesudah uji coba | ⬜ Optional checkbox |
| Anak saya bersedia mengirimkan file ringkasan sesi (angka saja, tanpa gambar) | ⬜ Optional checkbox |
| Tanggal | Date |

> 💡 That third checkbox is the one to put on a slide. Making a parent explicitly acknowledge that they get *no* surveillance — and consent anyway — is the strongest possible evidence that your design stance holds up outside your own document.

---

## 3. Welcome message to the student

Send on WhatsApp, right after the parent's form comes in.

> Halo [Nama]! 👋 Makasih ya udah mau nyobain HACHIKO.
>
> **Ini linknya:** [LINK]
> Buka di **laptop**, pakai **Chrome atau Edge** ya.
>
> Cara pakainya:
> 1. Buka linknya, izinin kameranya
> 2. Ikutin kalibrasi 15 detik
> 3. Pilih kamu mau belajar pakai apa (buku / laptop / HP / kertas)
> 4. Belajar kayak biasa. Hachiko yang jagain.
>
> Coba pakai **minimal 3x seminggu** ya, selama 2 minggu.
>
> Kalau ada yang error, aneh, atau bikin kesel — **langsung chat aku.** Justru itu yang paling kami butuhin. Nggak usah sungkan. 🙏
>
> Oh iya, sebelum mulai ada 5 pertanyaan singkat: [LINK PRE-TEST]

> 💡 **Step 3 is the one to watch.** Whether students pick their media honestly — or just tap whatever's first — decides whether the whole context layer works. Ask about it directly in the post-test.

---

## 4. "Cara Pakai" card

Make this one image (1080×1920) and send it in WhatsApp. Students won't read a PDF; they will look at one picture.

**Panel copy:**

| # | Visual | Text |
|---|---|---|
| 1 | Laptop open, student seated | **Buka linknya di laptop**<br>Pakai Chrome atau Edge. Izinin kameranya. |
| 2 | Framing check, green checkmark | **Cek posisi**<br>Pastikan wajahmu masuk kotak. |
| 3 | 15s countdown | **Duduk biasa aja, 15 detik**<br>Hachiko lagi ngukur posisi belajarmu. |
| 4 | Six media chips | **Pilih kamu belajar pakai apa**<br>Buku, laptop, HP, atau kertas. Jujur aja — ini bukan tes. |
| 5 | Dog sleeping, dark screen | **Belajar aja**<br>Hachiko tidur kalau kamu fokus. |
| 6 | Dog awake | **Kalau buyar, dia bangun**<br>Balik fokus, dia tidur lagi. Nggak ada hukuman. |
| 7 | Session Card | **Selesai sesi, kamu lihat hasilnya**<br>Berapa menit kamu *beneran* fokus. |

---

## 5. Pre-test (before first session)

Google Form. Five questions. Do not make it longer — you will lose people.

**Bagian 1 — Perkiraan diri**

> Kalau kamu belajar 25 menit, kira-kira berapa menit kamu **beneran** fokus?
> `[ ___ menit ]`

*This is your baseline for Tujuan #2. Their earlier interviews found an average overestimate of ~10 minutes.*

**Bagian 2 — Atribusi** *(1 = sangat tidak setuju, 5 = sangat setuju)*

> Kalau aku nggak fokus pas belajar, itu karena...

| # | Item | Direction |
|---|---|---|
| A1 | ...aku emang orangnya malas. | internal-stable — want ⬇ |
| A2 | ...aku belum nemu cara belajar yang pas buat aku. | unstable-controllable — want ⬆ |
| A3 | ...emang dari sananya aku nggak bisa fokus lama. | internal-stable — want ⬇ |
| A4 | ...kalau aku ubah caranya, fokusku bisa lebih baik. | controllable — want ⬆ |

**Scoring:**
```
Attribution Index = (A2 + A4) − (A1 + A3)
Range: −8 to +8. Higher = healthier attribution.
```

A rise from pre to post is your evidence for **Tujuan #3**. Report the mean shift and run a paired t-test or Wilcoxon signed-rank — either is fine at this N, and naming the test you used scores well.

---

## 6. Post-test (after 2 weeks)

Same 5 questions, **word for word**, plus:

> 6. Kamu pakai HACHIKO berapa kali dalam 2 minggu terakhir? `[ angka ]`
> 7. Waktu milih "belajar pakai apa" di awal — kamu pilih jujur, atau asal klik aja? `[ Jujur / Kadang asal / Sering asal ]`
> 8. Waktu Hachiko nanya pas jeda, itu ganggu nggak? `[ 1–5 ]`
> 9. Waktu lihat Kartu Sesi pertama kali, kamu mikir apa? `[ isian bebas ]`
> 10. Ada yang bikin kesel atau bingung? `[ isian bebas ]`
> 11. Kalau HACHIKO nggak ada lagi besok, kamu bakal kangen nggak? Kenapa? `[ isian bebas ]`

> 💡 **Q11 is your retention question.** Truer than "would you keep using this," which everyone answers yes to out of politeness. Quote the best answers verbatim in the pitch — a 13-year-old's own words land harder than a bar chart.

> 💡 **Q9 is your usability check.** If students describe the Session Card correctly without you explaining it, the feedback is legible. If they misread it, fix the card — that's the usability test your paper already promised.

> 🔴 **Q7 is the one that can invalidate your architecture.** The whole context layer rests on students declaring their media honestly. If most answer "sering asal," declared media is noise and System B in your ablation will show no improvement. Ask it plainly, and report the answer even if it's bad — that finding is worth more than a flattering number.

---

## 7. Tracking sheet

One Google Sheet. One row per student.

| Column | Note |
|---|---|
| ID | P01, P02… — **never store real names next to data** |
| Kelas | 7/8/9 |
| Branch | which regional branch recruited them |
| Consent received | date |
| Pre-test done | date |
| **Ran at least 1 session?** | ✅/❌ ← *track the drop-off* |
| Laptop + browser | from their bug reports |
| Sessions wk1 | count |
| Sessions wk2 | count |
| **Active on day 5?** | ✅/❌ ← *the money metric* |
| Post-test done | date |
| Attribution pre | −8..+8 |
| Attribution post | −8..+8 |
| Estimate error pre | minutes |
| Estimate error post | minutes |
| Notes | bugs, quotes, anything odd |

Keep the name↔ID mapping in a **separate** sheet that only you can open.

---

## 8. What to actually watch for

Ranked by how much it can hurt you:

1. 🔴 **Does the CV work in real bedrooms?** Bad lighting, hunched posture, dark rooms at night. The #1 risk to the whole project. Ask 5 students for a **photo of their setup** — that one request teaches you more than any survey question.
2. 🔴 **Do students declare their media honestly?** (post-test Q7) The entire context layer rests on this. If they don't, System B shows no improvement and the architecture needs rethinking.
3. 🔴 **What % of session time comes back Uncertain?** You pre-registered a 20% ceiling. Above it, the context layer has failed — and you committed in advance to saying so.
4. 🟠 **Day 5.** Raka quit his last app on day 4. If your cohort also drops at day 4–5, say so honestly in the paper. A team that reports its own retention cliff reads far more credibly than one that never mentions retention.
5. 🟠 **Do they understand the Session Card unaided?** Including the "belum jelas" line — if that confuses them, the abstain principle isn't reaching the user.
6. 🟡 **Laptop access drop-off.** How many consented but never ran a session because no laptop was free? That's the human face of the 18.52% figure, and the honest evidence for a phone-version roadmap item.

---

## 9. Ethics — keep this clean

- **No automatic upload, ever.** The telemetry file is downloaded by the student and sent only if they choose to. Nothing in the app calls a server. That's what lets you open DevTools on stage and show an empty Network tab — build in one auto-upload and that demo becomes a lie.
- **The telemetry file contains numbers only** — head angles, timestamps, detected object labels. No images, no video, no landmarks that reconstruct a face. Say this in the consent form and make sure it stays true.
- **Anonymous IDs everywhere.** Names live in one place, separated.
- **Anyone can stop, any time, no reason needed.** Say it out loud in the welcome message, not just in the form.
- **No incentives tied to usage.** If you give a reward for completing sessions, your retention number becomes worthless. If you want to thank participants, thank everyone equally at the end regardless of how much they used it.
- **Delete the raw data after the competition** and say so in the consent form.

---

## 10. Ready-to-use checklist

- [ ] Google Form: parent consent
- [ ] Google Form: pre-test
- [ ] Google Form: post-test
- [ ] Google Sheet: tracker (+ separate name map)
- [ ] "Cara Pakai" image (send in WhatsApp; students won't read a PDF)
- [ ] Short memorable URL, deployed with HTTPS
- [ ] Separate demo URL with a 2-minute Pomodoro, for the pitch
- [ ] Laptop-access screening question in the recruitment form
- [ ] Broadcast sent to 6 branch coordinators
- [ ] A WhatsApp number you actually check daily for bug reports

---

## 11. Multi-cycle manual QA (current blocker)

> This is the current **BLOCKER**. Run these by hand in a real browser before
> any further validation or product work. Status labels: **PASS / FAIL /
> UNVERIFIED / BLOCKED**.

### Status summary (current)

| Check | Status |
|---|---|
| Multi-cycle browser runtime (2 or 4 cycles) | **BLOCKED / UNVERIFIED** |
| `npx tsc --noEmit` | PASS |
| `npm test` (63/63) | PASS |
| `npm run build` | PASS |

⚠️ The engineering checks pass, but they **do not** imply browser multi-cycle
behavior passes. Runtime must be verified by hand.

### QA matrix — configuration

- 1 × 15
- 1 × 25
- 1 × 50
- 2 × 15
- 2 × 25
- 2 × 50
- 4 × 25

**Priority smoke tests:** `25 × 2`, `25 × 4`.

### Expected runtime

| Cycles | Flow |
|---|---|
| 1 | `work → report` |
| 2 | `work → break → work → report` |
| 4 | `work → break → work → break → work → break → work → report` |

### Break count

| Cycles | Expected breaks |
|---|---|
| 1 | 0 |
| 2 | 1 |
| 3 | 2 |
| 4 | 3 |

(No break after the final cycle.)

### Report / storage / telemetry counts

- **Report:** exactly one Session Card per entire sequence.
- **Storage:** exactly one `SessionRecord` per entire sequence.
- **Telemetry:** exactly one telemetry recording per entire sequence.

### Repeat

```
25 × 4 → report → "Ulangi sesi" → 25 × 4 again (same duration + cycle count)
```

### Manual completion ("Selesai")

4-cycle session, finish during cycle 2 → sequence stops → clarify → report.
Cycle 3 and 4 must **not** run.

### Regression checks (must stay green)

- 15/25/50 duration selector still works
- 1 cycle still works
- break duration is still 5 min
- no break after the last cycle
- PDF still works
- Session History: still one entry per sequence
- Delete Session unaffected
- Delete All Sessions unaffected
- Delete Profile unaffected
- Mentor mode unaffected
- no AI / perception behavior change

---

## 12. Current blocker handoff

**Problem:**
Multi-cycle browser runtime exits after the first break and returns to the
Session Card (observed `work → break → Session Card` when 2 or 4 cycles are
selected).

**Known:**
- Source and compiled output currently show the expected cycle `for`-loop.
- `tsc`, `npm test` (63/63), and `npm run build` pass.

**Unknown:**
Why the runtime returns to the Session Card after the first break.

**Next owner:**
Trace the actual runtime Promise / control-flow path (see
`BUILD_PROMPTS.md` "CURRENT BLOCKER" section and `HACHIKO_SOURCE_OF_TRUTH.md`
§10/§15). Do not invent a root cause.

**Out of scope for this blocker:** AI tuning, object-detector tuning, negative
datasets, RAG, new analytics, product redesign, schema migration.
