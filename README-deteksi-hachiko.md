# HACHIKO — Riset Metode Deteksi Fokus/Teralih

Dokumen ini merangkum hasil riset literatur (Agustus 2026) buat nentuin metode dan threshold deteksi status Fokus/Teralih/Tidak Hadir di HACHIKO, plus rencana eksperimen selanjutnya.

## 1. Metode Dasar (Baseline)

HACHIKO pakai pendekatan **rule-based**, bukan model ML yang di-training dari dataset berlabel:

- Face landmark detection pakai model pre-trained (MediaPipe Face Mesh / ML Kit)
- Dari landmark, dihitung:
  - **Head pose** (yaw/pitch) — arah hadap kepala
  - **EAR (Eye Aspect Ratio)** — rasio buka-tutup mata
- Status ditentukan dari kombinasi kedua angka itu pakai threshold, bukan classifier terpisah

## 2. Threshold dengan Rujukan Riset

Sebelumnya threshold cuma tebakan. Sekarang ada dua sumber referensi:

| Sinyal | Threshold | Sumber |
|---|---|---|
| Yaw menyimpang | >30°, bertahan ≥3 detik | Ma et al. (2026), Frontiers in Physiology |
| Gaze shift | ≥200px, bertahan ≥5 detik | Ma et al. (2026) |
| Eye closure tunggal | >2 detik | Ma et al. (2026) |
| Alternatif lebih sensitif | ~20 frame berturut-turut (~1 detik di 20-30fps) | Manikandaprabhu et al. (2026), sistem virtual-learning |
| PERCLOS (dasar ngantuk) | % waktu mata ≥80% tertutup dalam suatu window | Wierwille et al. (1994), tervalidasi luas |

Catatan: threshold dari Ma et al. berasal dari konteks umum (bukan e-learning spesifik), sedangkan threshold Manikandaprabhu lebih dekat konteks HACHIKO tapi lebih sensitif. Belum diputusin mana yang dipakai final — perlu dites.

## 3. Limitasi yang Ditemukan

Head pose + EAR doang **nggak bisa bedain**:
- Nunduk baca buku (fokus) vs nunduk liat HP (teralih) — sudut kepala mirip

Ini gap nyata di sistem murni geometris.

## 4. Solusi: Tambah Object Detection (Multimodal)

Dari brainstorm tim, muncul 3 opsi pendekatan:
1. **Full deteksi** — pakai dataset siap pakai (Roboflow), langsung klasifikasi dari situ
2. **Deteksi objek + klasifikasi** — deteksi benda (HP/buku) di frame, gabung sama status fokus
3. **Pose tubuh + klasifikasi** — deteksi posisi tangan/tubuh (contoh: tangan nempel dagu = indikasi bosan)

### Validasi literatur untuk Opsi 2

Dikonfirmasi ada studi yang gabungin head pose + object detection:

- **Becerra et al. (2026)** — deteksi distraksi smartphone di online learning. Head pose doang: **87%** akurasi. Ditambah object detection (multimodal): **91%** akurasi.
- **Cyril et al. (2025)** — YOLOv8 + CNN + face detection, klasifikasi normal/distracted/wajah tertutup/dll: **92,9%** akurasi (tanpa baseline head-pose-doang buat dibandingin).

Kesimpulan: gain dari multimodal nyata tapi nggak drastis (+4 poin di studi pertama). Perlu ditimbang sama cost komputasi jalanin dua model bareng real-time.

### Failure Case dari Literatur (relevan ke HACHIKO)

- Wajah ketutup (nutup mulut pas mikir/nguap) — bisa kesalah-baca jadi "Tidak Hadir"
- Variasi pencahayaan kamar siswa
- Head pose ekstrem

### Kabar baik

Model object detection (YOLO) udah punya class "cell phone" bawaan dari dataset COCO — nggak perlu training/data collection sendiri. Konsisten sama prinsip HACHIKO yang didesain nggak butuh dataset custom.

## 5. Dataset Shortlist (buat validasi, bukan training)

| Dataset | Isi | Kegunaan | Akses |
|---|---|---|---|
| MRL Eye Dataset | ~85.000 citra mata terbuka/tertutup | Validasi EAR/eye-closure | Download langsung, gratis |
| DAiSEE | 9.068 video 10 detik, 112 mahasiswa, label engagement/boredom/confusion/frustration | Validasi end-to-end (paling mirip konteks HACHIKO) | Isi form request, gratis akademik |

mEBAL2 sempat dipertimbangkan tapi di-skip dulu — fungsinya overlap sama MRL, tapi aksesnya lebih ribet (perlu email + tanda tangan lisensi).

## 6. Eksperimen Selanjutnya

- [ ] Uji YOLOv8-nano (versi paling ringan) jalan bareng model head-pose yang udah ada, di device target (laptop/HP kelas menengah) — ukur waktu proses per frame, cek ada lag atau nggak
- [ ] Bandingin dua opsi threshold durasi teralih (2 detik ala Ma et al. vs ~1 detik ala Manikandaprabhu) pakai rekaman video sendiri, lihat mana yang paling natural/nggak terlalu sensitif atau terlalu lambat
- [ ] Kalo dua-duanya lolos, baru integrasi object detection ke pipeline utama HACHIKO

## Referensi

- Ma, Y., Xu, Y., Jin, R., et al. (2026). *Effects of 6-week HIIT and MICT on classroom attention in children*. Frontiers in Physiology. https://doi.org/10.3389/fphys.2026.1876163
- Manikandaprabhu, M., Govindarajan, P., Akshay, S., et al. (2026). *Real-Time Based Student Attentiveness Geometry Group Detection System for Virtual Learning Environments*. Procedia Computer Science. https://doi.org/10.1016/j.procs.2026.06.093
- Wierwille, W.W. et al. (1994). PERCLOS drowsiness metric (via review: Abe, T. (2023). PERCLOS-based technologies for detecting drowsiness. Sleep Advances.)
- Becerra, A., Daza, R., Cobos, R., et al. (2026). *AI-Based Multimodal Biometrics for Detecting Smartphone Distractions: Application to Online Learning*. Lecture Notes in Computer Science. https://doi.org/10.1007/978-3-032-03870-8_3
- Cyril, B.R., Gothane, S., Senjudarvannan, R., et al. (2025). *Vision-Based Intelligent System for Real-Time Assessment of Online Student Engagement*. ICRCICN 2025. https://doi.org/10.1109/ICRCICN68210.2025.11364966
- Gupta, A. et al. (2016). *DAiSEE: Dataset for Affective States in E-Learning Environments*. https://people.iith.ac.in/vineethnb/resources/daisee/index.html
- MRL Eye Dataset — VSB Technical University of Ostrava. https://mrl.cs.vsb.cz/eyedataset.html
