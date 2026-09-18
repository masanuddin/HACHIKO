# Scrapbook Polish Pass — Design

**Status:** approved by user, ready for implementation planning.

## Problem

The scrapbook/bento redesign (see `docs/superpowers/specs/2026-09-17-ready-screen-merge-design.md` and the branch's earlier commits) wired the visual system into every daylight screen, but the user's read on the result is: "too plain, even the UX writing is bad." Investigation traced this to five concrete, fixable causes rather than a vague "needs more polish":

1. **The doodle marks are literal placeholders.** `doodleSlot()` renders a dashed box with the word "doodle" printed inside it (`src/ui/components.ts:104-118`), and it sits next to *every* screen title via `titleWithDoodle()` plus once more on the Session Card's observation tile. This is the single biggest "looks unfinished" signal — it reads as a TODO, not a decoration.
2. **The scrapbook effect is too subtle.** Tilts are ±0.4–1.3° (`src/styles/tokens.css:97-101`) and the paper-grain noise renders at ~4.5% alpha (`--paper-grain`'s `feColorMatrix`, `tokens.css:119`) — both nearly imperceptible at normal viewing distance.
3. **The intended display/body fonts never load.** `tools/fetch-assets.mjs` downloads `PlusJakartaSans-Variable.woff2` and `Inter-Variable.woff2` from URLs that 404 (confirmed live: both repos moved/renamed their variable-font file paths since these URLs were written). The UI has been silently rendering in the system-font fallback the whole time, which is why it feels visually flat. This is a real, if intentionally best-effort, gap — not a hypothetical.
4. **Welcome, Consent, and Clarify never got the paper/bento treatment** applied to Ready and Session Card — they're still a plain vertical stack of text and buttons.
5. **The copy is inconsistent in register and occasionally dry/instructional**, most visibly in Welcome's intro, Ready's settings labels, and Session Card's metric labels (one of which — "Waktu Away" — mixes English into Indonesian copy). Session's own screen (`session.ts`) and Clarify's core prompt already exemplify the target voice well (the Clarify body line is lifted verbatim from PRD §8) — this pass brings the rest of the app up to that same bar, it isn't starting from zero everywhere.

## Constraints carried from CLAUDE.md (binding on every task below)

- No new npm dependencies. Font files are static assets fetched at build time via the existing `tools/fetch-assets.mjs` pattern (same as the MediaPipe models) — not an npm package, so this is allowed; the *fix* here is a URL correction, not a new mechanism.
- No network calls from the shipped app. Font/asset fetching happens in `predev`/`prebuild`, before the app exists — same distinction `public/fonts/README.md` already documents.
- `src/engine/` untouched — nothing here touches it.
- No red anywhere in the UI.
- No `gagal`, `malas`, or `salah` in any user-facing string. This pass fixes the one pre-existing violation (`strings.clarify.optionMixed: 'Salah Deteksi'`).
- Session (night) screen's **visuals** stay exactly as they are — this was an explicit earlier decision (see prior spec) and nothing here reopens it. Session's **copy** (`strings.session.*`) is in scope for the writing pass like every other screen's copy, since text content isn't a visual-decoration constraint — but as noted above, `session.ts`'s copy is already close to the target voice, so most of its strings are unchanged.
- Plain DOM, CSS custom properties only, one fixed palette (`--cream`, `--sand`, `--amber`, `--amber-deep`, `--ink`, `--ink-muted`, `--sage`, `--night`) — every value below is composed from these, never a new hue.

## 1. Doodle marks: from placeholder to decoration

Delete the placeholder concept entirely. Replace `doodleSlot()` with `doodleMark(name, opts?)`, a small inline-SVG decorative mark — same "inline SVG string assigned via `innerHTML`" pattern `calibration.ts`'s `progressRing()` already uses, so this isn't a new technique in the codebase.

### New component: `doodleMark()`

```ts
export type DoodleMarkName = 'squiggle' | 'sparkle' | 'swirl' | 'paw' | 'scribble-circle'

const DOODLE_MARK_SVG: Record<DoodleMarkName, string> = {
  squiggle: `<svg viewBox="0 0 32 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M2 11c3-8 6-8 9 0s6 8 9 0 6-8 9 0"/></svg>`,
  sparkle: `<svg viewBox="0 0 32 32" fill="currentColor"><path d="M16 2c0 6.5 1 9 2.5 10.5S25 15 30 16c-6.5 0-9 1-10.5 2.5S16 25 16 30c0-6.5-1-9-2.5-10.5S8 17 2 16c6.5 0 9-1 10.5-2.5S16 8 16 2z"/></svg>`,
  swirl: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20c0 5 4 8 9 8s9-4 9-9-3-8-7-8-6 2-6 6 3 5 6 5 4-1.5 4-3.5"/><path d="M20 17l3 2-1 3.5"/></svg>`,
  paw: `<svg viewBox="0 0 32 32" fill="currentColor"><ellipse cx="16" cy="22" rx="8" ry="6.5"/><ellipse cx="6" cy="12" rx="3" ry="4" transform="rotate(-15 6 12)"/><ellipse cx="13" cy="7" rx="3" ry="4"/><ellipse cx="20" cy="7" rx="3" ry="4"/><ellipse cx="27" cy="12" rx="3" ry="4" transform="rotate(15 27 12)"/></svg>`,
  'scribble-circle': `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6c-8-3-16 2-16 10s7 12 13 10 9-8 7-14c-1-3-4-4-4-4"/></svg>`,
}

/**
 * A small hand-drawn-style decorative mark (never informational - always
 * aria-hidden). Fixed, deterministic per call site, same "no
 * Math.random()" rule the tilt tokens and confetti pattern already
 * follow - each screen picks its mark explicitly, nothing rotates at
 * runtime.
 */
export function doodleMark(name: DoodleMarkName, opts: { size?: string } = {}): HTMLDivElement {
  const mark = el('div', { class: 'doodle-mark', 'aria-hidden': 'true' })
  mark.innerHTML = DOODLE_MARK_SVG[name]
  if (opts.size) {
    mark.style.width = opts.size
    mark.style.height = opts.size
  }
  return mark
}
```

`doodleSlot()` and its call sites are deleted (not deprecated — nothing else in the codebase uses it once this lands).

### `titleWithDoodle()` takes an explicit mark

```ts
export function titleWithDoodle(text: string, mark: DoodleMarkName): HTMLDivElement {
  return el('div', { class: 'title-row' }, [title(text), doodleMark(mark)])
}
```

### Assignment (fixed, thematic, not randomized)

| Call site | Old | New mark | Why |
|---|---|---|---|
| `welcome.ts` title | `titleWithDoodle(s.title)` | `'paw'` | first meeting Hachiko |
| `consent.ts` title | `titleWithDoodle(s.title)` | `'squiggle'` | calm register — parent-facing screen, a light mark not a playful one |
| `ready.ts` title (`s.framing.title`) | `titleWithDoodle(s.framing.title)` | `'swirl'` | a little flourish at the start of setup |
| `calibration.ts` title | `titleWithDoodle(s.title)` | `'sparkle'` | the "getting to know you" moment |
| `sessionCard.ts` title | `titleWithDoodle(s.title)` | `'squiggle'` | wrap-up, same calm register as Consent |
| `sessionCard.ts` observation tile | `doodleSlot('doodle', { size: '36px' })` | `doodleMark('paw', { size: '36px' })` | reads as Hachiko's own paw-printed note |
| `clarify.ts` title | `titleWithDoodle(s.title)` | `'scribble-circle'` | circling back to ask "which one was it?" |

### CSS

Replace `.doodle-slot`/`.doodle-slot--circle` (delete both, dead after the above) with:

```css
.doodle-mark {
  width: 28px;
  height: 28px;
  color: var(--ink-muted);
  flex-shrink: 0;
  display: inline-flex;
}

.doodle-mark svg {
  width: 100%;
  height: 100%;
  display: block;
}
```

## 2. Strengthen the scrapbook signature

`tokens.css` — roughly double the tilt magnitudes (same fixed five-value set, same alternating sign pattern, still never `Math.random()`):

```css
--tilt-a: -2.4deg;  /* was -1.2deg */
--tilt-b: 2deg;     /* was 1deg */
--tilt-c: -1.6deg;  /* was -0.8deg */
--tilt-d: 2.6deg;   /* was 1.3deg */
--tilt-e: -0.8deg;  /* was -0.4deg */
```

`--paper-grain`'s `feColorMatrix` alpha row goes from `0 0 0 0.045 0` to `0 0 0 0.1 0` (the RGB rows, which fix the noise's tint to `--ink`, are untouched) — roughly doubles perceived grain without reading as dirty.

`base.css`'s `.paper-tape::after` gains a shadow so the tape reads as sitting on top of the paper rather than painted into it:

```css
.paper-tape::after {
  /* ...existing declarations... */
  box-shadow: 0 2px 3px color-mix(in srgb, var(--ink) 25%, transparent);
}
```

## 3. Fix the font fetch

Both source URLs in `tools/fetch-assets.mjs` are stale — the upstream repos renamed their variable-font files. Verified working replacements (confirmed via `curl -IL`, both 302-redirect to `raw.githubusercontent.com` with a 200 underneath):

```js
{
  dest: join(root, 'public', 'fonts', 'PlusJakartaSans-Variable.woff2'),
  url: 'https://github.com/tokotype/PlusJakartaSans/raw/master/fonts/webfonts/PlusJakartaSans%5Bwght%5D.woff2',
  required: false,
},
{
  dest: join(root, 'public', 'fonts', 'Inter-Variable.woff2'),
  url: 'https://github.com/rsms/inter/raw/master/docs/font-files/InterVariable.woff2',
  required: false,
},
```

Local destination filenames are unchanged, so `base.css`'s `@font-face` rules need no edit. This keeps Plus Jakarta Sans as the display face deliberately — PRD §4 calls it out by name as an Indonesian type foundry choice worth its own pitch line, so this is a bug fix (the intended font never loaded), not a font-choice change.

## 4. Screen-specific layout polish

Light touch — wrap existing content in `paperCard`, no new grid components, no forced bento restructuring of single-focus screens.

**`welcome.ts`**: wrap the body copy + browser note in a tilted paper card between the title and the name field:

```ts
content.append(
  mascotPeek(),
  titleWithDoodle(s.title, 'paw'),
  paperCard([body(s.body), el('p', { class: 'screen__body' }, [s.browserNote])], { tilt: 'a', tape: true }),
  nameField.element,
  actions(button(s.continueLabel, submit)),
  el('p', { class: 'note' }, [s.noAccountNote]),
)
```

**`consent.ts`**: group the three checkboxes into their own tilted card (currently a bare `<div>`), alongside the existing camera-explainer card:

```ts
content.append(
  mascotPeek(),
  titleWithDoodle(s.title, 'squiggle'),
  body(s.intro),
  paperCard([el('h2', { class: 'card__title' }, [s.cameraExplainerTitle]), body(s.cameraExplainer)], { tilt: 'b', tape: true }),
  paperCard([permission.element, camera.element, noReport.element], { tilt: 'd', torn: 'b' }),
  nameField.element,
  actions(button(s.continueLabel, submit)),
)
```

**`clarify.ts`**: wrap the three real options in a tilted card, leaving Lewati (skip) and the auto-skip note outside it — visually reinforcing that skipping is a lesser-weight, always-fine choice, not one of the three "real" answers:

```ts
content.append(
  titleWithDoodle(s.title, 'scribble-circle'),
  body(s.body),
  paperCard([actions(button(s.optionBook, () => choose('book')), button(s.optionPhone, () => choose('phone')), button(s.optionMixed, () => choose('mixed')))], { tilt: 'c', tape: true }),
  actions(button(s.optionSkip, () => choose(null), { variant: 'secondary' })),
  autoNote,
)
```

(`calibration.ts` and `ready.ts`/`sessionCard.ts` already have their own bento/paper treatment from the prior redesign — only their doodle-mark assignment changes per Section 1.)

## 5. UX writing pass

Two registers, not one: **student-facing** screens get a warmer, more casual, occasionally first-person ("aku" = Hachiko) voice; **Consent** stays in a clear, plain, trustworthy register because its actual reader is the parent/guardian, not the student — CLAUDE.md's "casual register, these are 13-year-olds" describes the app's primary audience, not the one screen addressed to their parent. Destructive-action copy (delete session/profile confirmations) also stays plain and clear everywhere, not cutesy, matching the pattern the existing copy already uses.

Below: every string that changes, old → new. Anything not listed is unchanged because it already meets the bar (notably: `session.ts`'s break/extension/early-break copy, `clarify.ts`'s title/body/optionBook/optionPhone, and `sessionCard.ts`'s milestone lines were already close to or at the target voice — confirmed by rereading them against this same rubric).

### `strings.welcome`
| Key | Old | New |
|---|---|---|
| `title` | `Selamat datang di HACHIKO` | `Halo, aku Hachiko!` |
| `body` | `HACHIKO menemani kamu belajar. Kamera laptopmu memperhatikan posisi dudukmu, dan seekor anjing digital tidur saat kamu fokus, lalu bangun saat perhatianmu teralih.` | `Aku bakal nemenin kamu belajar. Kamera laptop kamu ngeliatin posisi dudukmu, terus aku tidur waktu kamu fokus dan bangun kalau kamu mulai teralih.` |
| `browserNote` | `HACHIKO berjalan paling baik di Chrome atau Edge di laptop.` | `HACHIKO paling enak dipakai di Chrome atau Edge, di laptop.` |
| `noAccountNote` | `Tidak perlu akun. Nama ini cuma disimpan di laptopmu sendiri.` | `Nggak perlu akun. Nama ini cuma kesimpen di laptop kamu sendiri.` |

(`nameLabel`, `namePlaceholder`, `nameError`, `continueLabel` unchanged — already short and fine.)

### `strings.consent`
Light clarity polish only, no personality injection (parent-facing). No changes to `title`, `intro`, `cameraExplainerTitle`, `cameraExplainer`, the three checkbox strings, `guardianNameLabel`, `guardianNamePlaceholder`, `requiredError`, `continueLabel` — reread against the "is this clear and trustworthy" bar and all already meet it.

### `strings.framing`
| Key | Old | New |
|---|---|---|
| `body` | `Pastikan wajahmu masuk ke dalam kotak, dan duduk seperti biasanya kamu belajar.` | `Pastikan wajahmu masuk ke kotak, terus duduk kayak biasa kamu belajar ya.` |

`framing.title` (`'Cek posisi duduk'`, used by `ready.ts:321`'s `titleWithDoodle(s.framing.title, 'swirl')`) is unchanged — already short and clear. `permissionPending`, `permissionDenied`, `permissionError`, `companionSessionCount`, `companionStreak` are also unchanged — the permission-error strings need to stay precise/plain since they're troubleshooting instructions, not a personality moment.

### `strings.calibration`
| Key | Old | New |
|---|---|---|
| `body` | `Duduk seperti biasanya kamu belajar. HACHIKO sedang mengenali posisi normalmu.` | `Duduk kayak biasa kamu belajar ya. Aku lagi ngapalin posisi dudukmu yang normal.` |
| `done` | `Sudah selesai. Yuk lanjut.` | `Beres! Yuk lanjut.` |

(`title`, `counting`, `continueLabel` unchanged — the countdown stays neutral so it doesn't get noisy on every tick.)

### `strings.ready`
| Key | Old | New |
|---|---|---|
| `durationLabel` | `Pilih lama sesi` | `Berapa lama kamu mau fokus?` |
| `breakSettingsLabel` | `Pengaturan istirahat` | `Atur istirahat` |
| `timelineTitle` | `Pola sesimu` | `Alur sesimu` |

(`roundsLabel`, `roundsChip`, `shortBreakLabel`, `longBreakLabel`, `continueLabel`, `timelineBreakLabel`, `timelineLongBreakLabel` unchanged — already plain, short, and clear; over-wording a stepper/chip label risks breaking the bento tile's layout.)

### `strings.clarify`
| Key | Old | New |
|---|---|---|
| `optionMixed` | `Salah Deteksi` | `Deteksinya Meleset` |

(Fixes the pre-existing banned-word violation — "salah" described the student as wrong; "meleset" (missed the mark/off-target) puts the imprecision on the detection, matching the product's core "never judge" rule. `title`, `body`, `optionBook`, `optionPhone`, `optionSkip`, `autoSkipNote` unchanged — `title`/`body` are the PRD §8 lines verbatim, already the reference example for this voice.)

### `strings.sessionCard`
| Key | Old | New |
|---|---|---|
| `focusMinutesLabel` | `Menit fokus` | `Waktu fokus` |
| `awayLabel` | `Waktu Away` | `Waktu Absen` |
| `uncertainLabel` | `Belum jelas` | `Waktu belum jelas` |

All four tile labels now follow one consistent "Waktu ___" pattern (`sittingMinutesLabel: 'Waktu duduk'` already did). `awayLabel`'s fix also removes the only English word in the app's Indonesian copy; "Absen" (absence/attendance) is an everyday Indonesian school term, which fits the audience better than a literal translation.

(Every other `sessionCard` key — `title`, `downloadLabel`, `downloadNote`, `downloadError`, `pdfFooter`, `doneLabel`, `historyTitle`, delete-confirmation strings, `milestoneSessionCount`, `milestoneStreak`, `uncertainThresholdNote`, `firstCollapseLabel`, `firstCollapseUnknown` — unchanged: delete confirmations stay plain by the same rule as `endScreen`'s, and the rest already reads well.)

### `strings.endScreen`
| Key | Old | New |
|---|---|---|
| `doneTitle` | `Sesi selesai` | `Sesi selesai!` |

(Everything else, including both delete-profile confirmation strings, unchanged — same "destructive action stays plain" rule.)

### `strings.session`
No changes. Reread in full against this rubric: `stateLabels` are correctly neutral (session screen never editorializes, by design), and `breakTitle`/`breakBody`/`earlyBreak.*`/`extension.*` already use the target warm, permission-giving voice (e.g. `earlyBreak.body`: "Boleh istirahat dulu kalau perlu, nggak apa-apa."). This section was already the bar the rest of the app is being brought up to.

### `strings.media`
No changes. Chip labels (`laptop`, `phone`, `book`, `paper`, `mixed`, `other`) are plain category nouns, correctly unadorned. `title`/`requiredError` are short, functional, and already fine.

### `sessionObservation()` and `formatFocusLine()` (in `strings.ts`, not the `strings` object)
No changes — both already match the target voice (e.g. "Fokusmu paling kuat di X menit pertama." is plain, positive-only, PRD-aligned).

## Testing

No new pure-logic behavior is introduced (this is CSS/DOM/copy only), so no new unit tests. Existing tests to re-verify unchanged:
- `strings.test.ts` (`formatDuration`/`formatFocusLine` — untouched functions, still covered)
- Full suite (`npm test`) and `tsc --noEmit` must stay green throughout, per CLAUDE.md's Definition of Done.
- Manual grep for the three banned words across `src/` must return zero matches after the `optionMixed` fix (currently the only occurrence).
- Manual browser check of all seven `doodleMark` call sites, both paper-card layout changes, and the strengthened tilt/tape/grain, per the `run` skill's "drive it, don't just launch it" standard — screenshot each affected screen.

## Out of scope (explicitly not touched by this pass)

- `waking.png`'s red background and `drowsy.png`'s expression — still an open decision from the prior final review, unrelated to this pass's five causes.
- Any restructuring of Ready/Calibration/Session Card's existing bento layouts — those already got the full treatment; this pass only changes their doodle-mark assignment.
- `src/engine/`, `src/perception/`, `src/storage/` — no logic changes anywhere in this pass.
