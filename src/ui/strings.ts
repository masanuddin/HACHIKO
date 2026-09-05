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
  },

  welcome: {
    title: 'Selamat datang di HACHIKO',
    body: 'HACHIKO menemani kamu belajar. Kamera laptopmu memperhatikan posisi dudukmu, dan seekor anjing digital tidur saat kamu fokus, lalu bangun saat perhatianmu teralih.',
    browserNote: 'HACHIKO berjalan paling baik di Chrome atau Edge di laptop.',
    nameLabel: 'Nama panggilanmu',
    namePlaceholder: 'Tulis nama panggilanmu',
    nameError: 'Tulis dulu nama panggilanmu ya.',
    continueLabel: 'Mulai',
    noAccountNote: 'Tidak perlu akun. Nama ini cuma disimpan di laptopmu sendiri.',
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
    body: 'Pastikan wajahmu masuk ke dalam kotak, dan duduk seperti biasanya kamu belajar.',
    permissionPending: 'Meminta izin kamera...',
    permissionDenied:
      'Izin kamera ditolak. HACHIKO butuh kamera untuk memperhatikan posisi dudukmu. Muat ulang halaman dan izinkan aksesnya ya.',
    permissionError: 'Kamera belum bisa diakses. Coba periksa apakah laptop ini punya kamera yang aktif.',
    continueLabel: 'Posisi sudah pas',
    companionSessionCount: (n: number) => `Kamu sudah ${n} sesi bareng Hachiko.`,
    companionStreak: (days: number) => ` ${days} hari berturut-turut!`,
  },

  calibration: {
    title: 'Kalibrasi 15 detik',
    body: 'Duduk seperti biasanya kamu belajar. HACHIKO sedang mengenali posisi normalmu.',
    counting: (secondsLeft: number) => `${secondsLeft} detik lagi`,
    done: 'Sudah selesai. Yuk lanjut.',
    continueLabel: 'Lanjut',
  },

  media: {
    title: 'Sesi ini kamu belajar pakai apa?',
    body: 'Boleh pilih lebih dari satu. HACHIKO memakai ini supaya tebakannya soal aktivitasmu lebih tepat.',
    chips: {
      laptop: 'Layar/laptop',
      phone: 'HP/tablet',
      book: 'Buku/LKS',
      paper: 'Kertas/nulis',
      mixed: 'Campuran',
      other: 'Lainnya',
    },
    requiredError: 'Pilih dulu setidaknya satu media belajar.',
    continueLabel: 'Mulai sesi',
  },

  ready: {
    title: (minutes: number) => `Siap fokus ${minutes} menit?`,
    body: 'Hachiko bakal nemenin dari sini. Begitu kamu tekan Mulai, sesi langsung berjalan.',
    continueLabel: 'Mulai',
  },

  session: {
    jeda: 'Jeda',
    selesai: 'Selesai',
    stateLabels: {
      FOKUS: 'Fokus',
      TERALIH: 'Perhatian teralih',
      TIDAK_HADIR: 'Tidak di depan laptop',
      UNCERTAIN: 'Belum jelas',
      MENGANTUK: 'Mulai mengantuk',
    },
    breakTitle: 'Waktunya istirahat',
    breakBody: 'Regangkan badan sebentar. Sesi berikutnya dimulai otomatis.',
    goToBreak: 'Istirahat sekarang',
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
    body: 'Tadi ada beberapa momen kamu nunduk lama. Itu lagi baca buku, atau lagi pegang HP?',
    optionBook: 'Baca buku',
    optionPhone: 'Pegang HP',
    optionMixed: 'Campuran',
    optionSkip: 'Lewati',
    autoSkipNote: (seconds: number) => `Kalau didiamkan, ini otomatis lewat dalam ${seconds} detik.`,
  },

  sessionCard: {
    title: 'Kartu Sesi',
    focusMinutesLabel: 'Menit fokus',
    sittingMinutesLabel: 'Waktu duduk',
    recoveryLabel: 'Waktu balik',
    recoveryUnknown: 'belum ada data',
    firstCollapseLabel: 'Fokus pertama bertahan sampai',
    firstCollapseUnknown: 'bertahan sepanjang sesi',
    uncertainLabel: 'Belum jelas',
    uncertainThresholdNote:
      'Bagian "belum jelas" sesi ini agak besar. HACHIKO lebih baik mengaku belum tahu daripada menebak asal.',
    downloadLabel: 'Unduh data sesi',
    downloadNote: 'File ini cuma berisi angka (sudut kepala, waktu, label objek), tidak ada gambar sama sekali.',
    repeatLabel: 'Ulangi sesi',
    repeatConfirmTitle: 'Siap mulai sesi lagi?',
    repeatConfirmStart: 'Mulai',
    repeatConfirmCancel: 'Batal',
    doneLabel: 'Selesai',
    milestoneSessionCount: (n: number) =>
      n === 1 ? 'Sesi pertamamu bareng Hachiko selesai!' : `Sudah ${n} sesi kamu bareng Hachiko!`,
    milestoneStreak: (days: number) => `Wah, ${days} hari berturut-turut!`,
    autoCloseNote: (seconds: number) => `Kalau didiamkan, ini otomatis lanjut dalam ${seconds} detik.`,
  },
} as const

/** minutes formatter shared across screens, e.g. "14 dari 25 menit" */
export function formatMinutes(ms: number): string {
  return String(Math.floor(ms / 60000))
}

export function formatMinSec(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}m ${s}d`
}
