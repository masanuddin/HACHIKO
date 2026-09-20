import { strings, formatDuration, sessionObservation, sessionTitle } from './strings'
import { computeMetrics, type SessionRecord } from '../storage/sessions'
import { STAMP_ALPHA_BASE64, STAMP_HEIGHT, STAMP_RGB_BASE64, STAMP_WIDTH } from './stampData'

/**
 * A tiny, dependency-free PDF writer (CLAUDE.md: no new dependencies).
 * It emits a minimal PDF 1.4 document using the built-in Type1 Helvetica
 * fonts, so every string here must stay Latin ASCII - which all current
 * Indonesian copy is. This is a clean export of the Session Card, not a
 * dump of raw telemetry; it reuses computeMetrics + the shared formatters
 * so the numbers always match the on-screen report.
 *
 * PDF generation is pure (no DOM) and testable under Node; only the
 * download trigger at the bottom touches the browser.
 */

const PAGE_W = 595
const PAGE_H = 842

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Plain base64 decoder - no Buffer (Node-only), no atob (browser-only),
 *  so this stays a pure function usable identically in both, same as the
 *  rest of this module's "no DOM, testable under Node" contract. */
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const ch of b64) {
    const value = BASE64_CHARS.indexOf(ch)
    if (value === -1) continue // '=' padding or whitespace
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  const out = new Uint8Array(bytes.length)
  out.set(bytes)
  return out
}

function toBytes(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s)
}

function concatBytes(parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

// RGB fill colors (0..1 triplets), from the fixed palette in tokens.css.
const C = {
  cream: '0.992 0.973 0.953',
  sand: '0.961 0.922 0.878',
  amber: '0.910 0.576 0.290',
  ink: '0.169 0.149 0.133',
  muted: '0.541 0.498 0.463',
}

// The stamp's placement on the page - sized to keep its source aspect
// ratio, positioned under the tail end (the trailing seconds) of the
// hero Fokus value (drawn at colLeft=76, y=655, size 34 - see
// buildContent). Clear
// of the detail-metrics row below it (label/value text tops out around
// y=620) and the card's own top edge (y=710) with margin either side.
const STAMP_DRAW_W = 92
const STAMP_DRAW_H = Math.round((STAMP_DRAW_W * STAMP_HEIGHT) / STAMP_WIDTH)
const STAMP_X = 250
const STAMP_Y = 618

const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function escapePdf(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function drawText(font: 'F1' | 'F2', size: number, x: number, y: number, color: string, str: string): string {
  return `BT\n/${font} ${size} Tf\n${color} rg\n1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm\n(${escapePdf(str)}) Tj\nET`
}

function wrap(str: string, maxChars: number): string[] {
  const words = str.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (cur === '') cur = w
    else if (`${cur} ${w}`.length <= maxChars) cur = `${cur} ${w}`
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur !== '') lines.push(cur)
  return lines
}

function sessionTimestamp(startedAt: number): string {
  const d = new Date(startedAt)
  return `${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()} - ${pad2(d.getHours())}.${pad2(d.getMinutes())}`
}

/** The Helvetica Type1 fonts here are Latin-1 only (see module docstring).
 *  A study topic is user-authored free text, so only render it when every
 *  character is representable; otherwise skip it rather than emit a glyph
 *  that the font can't draw. The on-screen Session Card is unaffected. */
function isLatin1Safe(s: string): boolean {
  return /^[\u0020-\u007E\u00A0-\u00FF]*$/.test(s)
}

/** Builds the page content stream (text + a filled card) for one session.
 *  `name` is the student's own profile name (see storage/profile.ts) -
 *  passed in rather than read here, since this module stays pure/DOM-free
 *  and testable under Node, and profile storage is a browser-only,
 *  localStorage-backed concern the caller already has loaded. */
function buildContent(record: SessionRecord, name?: string): string {
  const s = strings.sessionCard
  const m = computeMetrics(record)
  const title = isLatin1Safe(name ?? '') ? sessionTitle(name) : s.title

  const focusValue = formatDuration(m.focusMs)
  const sittingValue = formatDuration(m.sittingMs)
  const awayValue = formatDuration(m.awayMs)
  const uncertainValue = formatDuration(m.notFocusedMs)

  const out: string[] = []

  // Header
  out.push(drawText('F2', 15, 64, 790, C.amber, strings.common.appName))
  out.push(drawText('F2', 26, 64, 756, C.ink, title))
  out.push(drawText('F1', 11, 64, 738, C.muted, sessionTimestamp(record.startedAt)))

  // Study topic (metadata), shown in the header gap when present and
  // Latin-1 representable. Single line; long topics simply clip at the
  // right edge rather than reflowing the fixed summary card below.
  if (record.studyTopic && isLatin1Safe(record.studyTopic)) {
    out.push(drawText('F1', 12, 64, 720, C.ink, record.studyTopic))
  }

  // Summary card (sand background)
  out.push(`${C.sand} rg`)
  out.push('48 560 499 150 re')
  out.push('f')

  // The stamp, overlapping the card's top-right corner (547, 710) like a
  // seal on a paper document - drawn AFTER the card fill so it sits on
  // top of it, not underneath.
  out.push('q')
  out.push(`${STAMP_DRAW_W} 0 0 ${STAMP_DRAW_H} ${STAMP_X} ${STAMP_Y} cm`)
  out.push('/Im0 Do')
  out.push('Q')

  // Fokus is the headline number - alone, large, no "dari" comparison -
  // same hierarchy as the Session Card's hero bento tile. The remaining
  // three metrics sit below it in a row, same as they always have.
  const colLeft = 76
  const colMid = 226
  const colRight = 376
  out.push(drawText('F1', 11, colLeft, 692, C.muted, s.focusMinutesLabel))
  out.push(drawText('F2', 34, colLeft, 655, C.ink, focusValue))

  out.push(drawText('F1', 11, colLeft, 612, C.muted, s.sittingMinutesLabel))
  out.push(drawText('F2', 13, colLeft, 594, C.ink, sittingValue))
  out.push(drawText('F1', 11, colMid, 612, C.muted, s.awayLabel))
  out.push(drawText('F2', 13, colMid, 594, C.ink, awayValue))
  out.push(drawText('F1', 11, colRight, 612, C.muted, s.notFocusedLabel))
  out.push(drawText('F2', 13, colRight, 594, C.ink, uncertainValue))

  // Summary message, wrapped to the content width.
  let obsY = 520
  for (const line of wrap(sessionObservation(m.firstCollapseAtMs), 70)) {
    out.push(drawText('F1', 12, 64, obsY, C.ink, line))
    obsY -= 17
  }

  // Footer
  out.push(drawText('F1', 9, 64, 40, C.muted, s.pdfFooter))

  return `${out.join('\n')}\n`
}

function buildPdfDocument(content: string): Uint8Array<ArrayBuffer> {
  const obj1 = '<< /Type /Catalog /Pages 2 0 R >>'
  const obj2 = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
  const obj3 = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /XObject << /Im0 8 0 R >> >> /Contents 4 0 R >>`
  const obj4 = `<< /Length ${content.length} >>\nstream\n${content}endstream`
  const obj5 = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  const obj6 = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'

  // Object 7: the stamp's alpha channel, a DeviceGray SMask. Object 8:
  // the stamp's RGB pixels, referencing object 7 via /SMask. Both are
  // raw, uncompressed 8-bit samples (no /Filter) - consistent with this
  // writer's content stream (also uncompressed) and avoiding any need
  // for a deflate implementation in the shipped app. Built as raw bytes,
  // not strings, since TextEncoder (used for every other object here)
  // would UTF-8-mangle arbitrary pixel byte values >= 0x80.
  const stampRgb = base64ToBytes(STAMP_RGB_BASE64)
  const stampAlpha = base64ToBytes(STAMP_ALPHA_BASE64)

  const obj7 = concatBytes([
    toBytes(
      `7 0 obj\n<< /Type /XObject /Subtype /Image /Width ${STAMP_WIDTH} /Height ${STAMP_HEIGHT} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${stampAlpha.length} >>\nstream\n`,
    ),
    stampAlpha,
    toBytes('\nendstream\nendobj\n'),
  ])

  const obj8 = concatBytes([
    toBytes(
      `8 0 obj\n<< /Type /XObject /Subtype /Image /Width ${STAMP_WIDTH} /Height ${STAMP_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 7 0 R /Length ${stampRgb.length} >>\nstream\n`,
    ),
    stampRgb,
    toBytes('\nendstream\nendobj\n'),
  ])

  const bodyParts = [
    toBytes(`1 0 obj\n${obj1}\nendobj\n`),
    toBytes(`2 0 obj\n${obj2}\nendobj\n`),
    toBytes(`3 0 obj\n${obj3}\nendobj\n`),
    toBytes(`4 0 obj\n${obj4}\nendobj\n`),
    toBytes(`5 0 obj\n${obj5}\nendobj\n`),
    toBytes(`6 0 obj\n${obj6}\nendobj\n`),
    obj7,
    obj8,
  ]

  const header = toBytes('%PDF-1.4\n')
  const offsets: number[] = []
  let cursor = header.length
  for (const part of bodyParts) {
    offsets.push(cursor)
    cursor += part.length
  }
  const xrefOffset = cursor

  let xref = `xref\n0 ${bodyParts.length + 1}\n`
  xref += '0000000000 65535 f\r\n'
  for (const off of offsets) {
    xref += `${off.toString().padStart(10, '0')} 00000 n\r\n`
  }
  const trailer = `trailer\n<< /Size ${bodyParts.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return concatBytes([header, ...bodyParts, toBytes(xref), toBytes(trailer)])
}

/** Generates a human-readable PDF for the current session. Pure - no DOM.
 *  `name` is optional and comes from the caller's already-loaded profile
 *  (see buildContent's doc comment for why this module doesn't load it
 *  itself); omitting it falls back to the plain, unpersonalized title. */
export function buildSessionReportPdf(record: SessionRecord, name?: string): Uint8Array<ArrayBuffer> {
  return buildPdfDocument(buildContent(record, name))
}

/** `hachiko-session-YYYY-MM-DD-HH-mm.pdf`, from the session's start time. */
export function pdfFilename(startedAt: number): string {
  const d = new Date(startedAt)
  return `hachiko-session-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}-${pad2(d.getMinutes())}.pdf`
}

/** Student-initiated local download (mirrors storage/telemetry downloadJsonl). */
export function downloadPdf(filename: string, bytes: Uint8Array<ArrayBuffer>): void {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
