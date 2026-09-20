/**
 * All user-facing copy lives here, in Indonesian, casual register (these
 * are 13-year-olds). Code, comments, and identifiers stay in English.
 * Keeping every visible string in one file is what makes CLAUDE.md's
 * "definition of done" banned-word grep actually mean something (see
 * "Never do these" in CLAUDE.md) - check this file first if that check
 * ever fails.
 */

export const strings = {
  common: {
    appName: 'HACHIKO',
    continueLabel: 'Lanjut',
    back: 'Kembali',
    skip: 'Lewati',
    cameraActive: 'Kamera aktif',
    minutesUnit: 'menit',
  },

  welcome: {
    title: 'Halo, aku Hachiko!',
    body: 'Aku bakal nemenin kamu belajar. Kamera laptop kamu ngeliatin posisi dudukmu, terus aku tidur waktu kamu fokus dan bangun kalau kamu mulai teralih.',
    browserNote: 'Aku paling enak dipakai di Chrome atau Edge, di laptop.',
    nameLabel: 'Nama panggilanmu',
    namePlaceholder: 'Tulis nama panggilanmu',
    nameError: 'Tulis dulu nama panggilanmu ya.',
    continueLabel: 'Mulai',
    noAccountNote: 'Nggak perlu akun. Nama ini cuma kesimpen di laptop kamu sendiri.',
  },

  consent: {
    title: 'Izin orang tua',
    intro:
      'Sebelum mulai, orang tua atau walimu perlu membaca dan menyetujui ini. Kamera laptop akan memperhatikan posisi duduk selama belajar, lalu menampilkan seekor anjing digital yang tidur saat fokus dan bangun saat perhatian teralih.',
    cameraExplainerTitle: 'Tentang kameranya',
    cameraExplainer:
      'Gambar dari kamera tidak pernah direkam, disimpan, atau dikirim ke mana pun. Yang diproses hanya angka posisi wajah, dan semuanya berjalan di dalam laptop ini. Tidak ada server yang menerima apa pun.',
    checkboxPermission: 'Saya mengizinkan anak saya menggunakan HACHIKO.',
    checkboxCamera:
      'Saya memahami kamera hanya berjalan di perangkat ini, dan tidak ada gambar yang direkam, disimpan, atau dikirim.',
    checkboxNoReport:
      'Saya memahami bahwa saya tidak akan menerima laporan aktivitas belajar anak saya, dan ini memang disengaja.',
    guardianNameLabel: 'Nama orang tua/wali',
    guardianNamePlaceholder: 'Tulis nama orang tua atau wali',
    requiredError: 'Semua kotak centang dan nama wali perlu diisi dulu.',
    continueLabel: 'Setuju dan lanjut',
  },

  framing: {
    title: 'Cek posisi duduk',
    body: 'Pastikan wajahmu masuk ke kotak, terus duduk kayak biasa kamu belajar ya.',
    permissionPending: 'Meminta izin kamera...',
    permissionDenied:
      'Izin kamera ditolak. HACHIKO butuh kamera untuk memperhatikan posisi dudukmu. Muat ulang halaman dan izinkan aksesnya ya.',
    permissionError: 'Kamera belum bisa diakses. Coba periksa apakah laptop ini punya kamera yang aktif.',
    companionSessionCount: (n: number) => `Kamu sudah ${n} sesi bareng Hachiko.`,
    companionStreak: (days: number) => ` ${days} hari berturut-turut!`,
  },

  calibration: {
    title: 'Kalibrasi 15 detik',
    body: 'Duduk kayak biasa kamu belajar ya. Aku lagi ngapalin posisi dudukmu yang normal.',
    counting: (secondsLeft: number) => `${secondsLeft} detik lagi`,
    done: 'Beres! Yuk lanjut.',
    continueLabel: 'Lanjut',
    hints: [
      'Santai aja, duduk kayak biasa kamu belajar.',
      'Aku lagi merhatiin posisi dudukmu, tahan sebentar.',
      'Hampir selesai, sedikit lagi!',
    ],
  },

  media: {
    title: 'Sesi ini kamu belajar pakai apa?',
    chips: {
      laptop: 'Layar/laptop',
      phone: 'HP/tablet',
      book: 'Buku/LKS',
      paper: 'Kertas/nulis',
      other: 'Lainnya',
    },
    requiredError: 'Pilih dulu setidaknya satu media belajar.',
    topicLabel: 'Di sesi ini, kamu mau belajar apa?',
    topicPlaceholder: 'contoh: Matematika - Integral',
  },

  ready: {
    durationLabel: 'Berapa lama kamu mau fokus?',
    roundsLabel: 'Berapa putaran sebelum istirahat panjang?',
    roundsChip: (n: number) => `${n} putaran`,
    breakSettingsLabel: 'Atur istirahat',
    shortBreakLabel: 'Istirahat pendek',
    longBreakLabel: 'Istirahat panjang',
    continueLabel: 'Mulai',
    timelineTitle: 'Alur sesimu',
    timelineBreakLabel: 'Istirahat',
    timelineLongBreakLabel: 'Istirahat panjang',
    timelineCloseLabel: 'Batal',
  },

  session: {
    jeda: 'Jeda',
    selesai: 'Selesai',
    selesaiConfirmTitle: 'Selesai untuk hari ini?',
    selesaiConfirmYes: 'Ya, selesai',
    selesaiConfirmNo: 'Lanjut fokus',
    lewatiConfirmTitle: 'Istirahat sekarang?',
    stateLabels: {
      FOKUS: 'Fokus',
      TERALIH: 'Teralih',
      TIDAK_HADIR: 'Tidak di depan laptop',
      UNCERTAIN: 'Teralih',
      MENGANTUK: 'Teralih',
    },
    breakTitle: 'Waktunya istirahat',
    breakBody: 'Regangkan badan sebentar. Kalau siap, kamu yang tentuin lanjut atau selesai.',
    breakLongTitle: 'Waktunya istirahat panjang',
    breakLongBody: 'Kamu udah nyelesain beberapa putaran fokus. Istirahat lebih lama dulu, baru lanjut kalau siap.',
    goToBreak: 'Istirahat sekarang',
    breakContinueLabel: 'Fokus lagi',
    breakStopLabel: 'Selesai untuk hari ini',
    breakContinueConfirmTitle: 'Siap fokus lagi?',
    breakContinueConfirmYes: 'Ya, mulai',
    breakStopConfirmTitle: 'Yakin selesai untuk hari ini?',
    breakStopConfirmYes: 'Ya, selesai',
    breakConfirmCancel: 'Batal',
    earlyBreak: {
      title: 'Istirahat sekarang?',
      body: 'Kelihatannya lagi berat buat fokus. Boleh istirahat dulu kalau perlu, nggak apa-apa.',
      decline: 'Lanjut dulu',
    },
    extension: {
      title: 'Masih fokus?',
      body: 'Kamu lagi fokus banget. Mau lanjut sebentar lagi sebelum istirahat?',
      accept: 'Lanjut 10 menit',
    },
  },

  clarify: {
    title: 'Boleh dijelaskan sedikit?',
    body: 'Tadi ada beberapa momen kamu sepertinya terlihat kurang fokus. Kamu beneran masih fokus kan, atau ada distraksi?',
    optionBook: 'Masih Fokus Kok!',
    optionPhone: 'Ada Distraksi Tadi',
    optionMixed: 'Deteksinya Meleset',
    optionSkip: 'Lewati',
    autoSkipNote: (seconds: number) => `Kalau didiamkan, ini otomatis lewat dalam ${seconds} detik.`,
  },

  sessionCard: {
    title: 'Kartu Sesi',
    focusMinutesLabel: 'Waktu fokus',
    sittingMinutesLabel: 'Waktu duduk',
    awayLabel: 'Waktu absen',
    firstCollapseLabel: 'Fokus pertama bertahan sampai',
    firstCollapseUnknown: 'bertahan sepanjang sesi',
    uncertainLabel: 'Waktu belum jelas',
    notFocusedLabel: 'Waktu teralih',
    totalSessionLabel: 'Total lama sesi',
    restLabel: 'Waktu istirahat',
    topicInsight: (topic: string) => `Kamu paling fokus pas belajar ${topic}`,
    uncertainThresholdNote:
      'Bagian "belum jelas" sesi ini agak besar. HACHIKO lebih baik mengaku belum tahu daripada menebak asal.',
    downloadLabel: 'Unduh laporan sesi',
    downloadNote: 'Laporan PDF ini cuma berisi angka hasil sesimu. Tidak ada gambar dan tidak ada yang dikirim ke mana pun.',
    downloadError: 'Maaf, laporan belum bisa dibuat. Coba lagi ya.',
    pdfFooter: 'HACHIKO - semua data tetap di perangkatmu saja',
    doneLabel: 'Selesai',
    historyTitle: 'Sesi sebelumnya',
    historyCount: (n: number) => `${n} sesi tersimpan`,
    historyViewAll: 'Lihat semua',
    deleteSessionLabel: 'Hapus',
    deleteConfirmTitle: 'Hapus sesi ini?',
    deleteConfirmYes: 'Hapus',
    deleteConfirmCancel: 'Batal',
    deleteAllSessionsLabel: 'Hapus semua sesi',
    deleteAllConfirmTitle: 'Hapus semua sesi?',
    deleteAllConfirmYes: 'Hapus semua',
    milestoneSessionCount: (n: number) =>
      n === 1 ? 'Sesi pertamamu bareng Hachiko selesai!' : `Sudah ${n} sesi kamu bareng Hachiko!`,
    milestoneStreak: (days: number) => `Wah, ${days} hari berturut-turut!`,
  },

  endScreen: {
    doneTitle: 'Sesi selesai!',
    doneMessage: 'Terima kasih sudah belajar bareng Hachiko hari ini.',
    reloadLabel: 'Muat ulang',
    deleteProfileLabel: 'Hapus profil',
    deleteProfileConfirmTitle: 'Hapus profilmu?',
    deleteProfileConfirmBody: 'Nama, izin orang tua, dan seluruh riwayat sesimu akan dihapus.',
    deleteProfileConfirmYes: 'Hapus profil',
    deleteProfileConfirmCancel: 'Batal',
  },
} as const

/**
 * Unit-aware duration formatter shared across screens. Always renders the
 * full "HH:MM:SS" shape, every unit zero-padded to two digits - never
 * rounds and never drops a leading zero-unit (84s -> "00:01:24"), so the
 * same shape reads the same way whether a student glances at a 20-second
 * gap or a 90-minute sitting. Raw milliseconds are preserved - this is
 * presentation only.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

/**
 * The Session Card heading. Personalised with the student's name when one
 * is present, falling back to the plain base title otherwise - so "Kartu
 * Sesi undefined" or a trailing space never render.
 */
export function sessionTitle(name?: string): string {
  const trimmed = name?.trim()
  return trimmed ? `${strings.sessionCard.title} ${trimmed}` : strings.sessionCard.title
}

/**
 * One plain observation, never a judgment (PRD §8, BUILD_PROMPTS P4).
 * "Fokusmu paling kuat di 12 menit pertama." is right.
 * "Kamu terdistraksi 8 kali." is wrong - this function never counts
 * distractions, only describes where the strong early stretch was.
 */
export function sessionObservation(firstCollapseAtMs: number | null): string {
  if (firstCollapseAtMs === null) {
    return 'Fokusmu bertahan sepanjang sesi ini.'
  }
  const minutes = Math.max(1, Math.floor(firstCollapseAtMs / 60_000))
  return `Fokusmu paling kuat di ${minutes} menit pertama.`
}
