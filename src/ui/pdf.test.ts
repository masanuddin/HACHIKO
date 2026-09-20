import { describe, expect, it } from 'vitest'
import { buildSessionReportPdf, pdfFilename } from './pdf'
import { emptyDurations, type SessionRecord } from '../storage/sessions'

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's-test',
    startedAt: new Date(2026, 8, 10, 14, 5).getTime(),
    declaredMedia: ['laptop'],
    durationsMs: emptyDurations(),
    distractionEvents: [],
    recoveryTimesMs: [],
    uncertainMs: 0,
    firstCollapseAtMs: null,
    clarification: null,
    ...overrides,
  }
}

function pdfText(rec: SessionRecord): string {
  return new TextDecoder().decode(buildSessionReportPdf(rec))
}

/** Exact byte<->char mapping (unlike UTF-8 decoding), for tests that need
 *  to validate byte offsets - the PDF now embeds a raw binary image
 *  stream, so a UTF-8 decode would corrupt any offset arithmetic done on
 *  the resulting string (invalid byte sequences collapse into a single
 *  U+FFFD, shifting every later character's index relative to its true
 *  byte offset). Chunked to avoid a call-stack blowout on large buffers. */
function bytesToBinaryString(bytes: Uint8Array): string {
  let s = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return s
}

describe('buildSessionReportPdf', () => {
  it('emits a structurally valid PDF with the report content', () => {
    const pdf = pdfText(record())
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    expect(pdf).toContain('%%EOF')
    expect(pdf).toContain('/Type /Catalog')
    expect(pdf).toContain('/BaseFont /Helvetica')
    expect(pdf).toContain('HACHIKO')
    expect(pdf).toContain('Kartu Sesi')
    expect(pdf).toContain('Waktu fokus')
    expect(pdf).toContain('Waktu duduk')
    expect(pdf).toContain('Waktu absen')
    expect(pdf).toContain('Waktu tidak fokus')
  })

  it('shows sub-minute durations zero-padded within the full HHh:MMm:SSs shape', () => {
    const pdf = pdfText(record({ durationsMs: { ...emptyDurations(), FOKUS: 30_000 } }))
    expect(pdf).toContain('00h:00m:30s')
  })

  it('shows whole-minute durations with zero seconds', () => {
    const pdf = pdfText(record({ durationsMs: { ...emptyDurations(), FOKUS: 60_000 } }))
    expect(pdf).toContain('00h:01m:00s')
  })

  it('reports "Waktu tidak fokus" as the present-but-not-focused total', () => {
    const pdf = pdfText(record({ durationsMs: { ...emptyDurations(), FOKUS: 60_000, TERALIH: 120_000 } }))
    expect(pdf).toContain('00h:02m:00s')
  })

  it('includes the study topic when present', () => {
    const pdf = pdfText(record({ studyTopic: 'Matematika - Integral' }))
    expect(pdf).toContain('Matematika - Integral')
  })

  it('includes the student name in the title when provided', () => {
    const pdf = new TextDecoder().decode(buildSessionReportPdf(record(), 'Budi'))
    expect(pdf).toContain('Kartu Sesi Budi')
  })

  it('omits the study topic for old records without one (still valid)', () => {
    const pdf = pdfText(record())
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    expect(pdf).toContain('%%EOF')
  })

  it('omits a non-Latin-1 topic rather than emitting an undrawable glyph', () => {
    const pdf = pdfText(record({ studyTopic: 'Matematika \u{1F600}' }))
    expect(pdf).not.toContain('Matematika')
  })

  it('has a self-consistent cross-reference table', () => {
    // 8 objects now (6 text/font objects + the stamp's SMask and RGB
    // image XObjects) - byte offsets, so this walks the raw buffer via
    // an exact byte<->char mapping, not a UTF-8 decode (see
    // bytesToBinaryString's doc comment).
    const pdf = bytesToBinaryString(buildSessionReportPdf(record()))
    const header = 'xref\n0 9\n'
    const tableStart = pdf.indexOf(header) + header.length

    const offsets: number[] = []
    let pos = tableStart + 20 // skip the free entry
    for (let i = 0; i < 8; i++) {
      offsets.push(Number(pdf.slice(pos, pos + 10)))
      pos += 20
    }

    offsets.forEach((off, i) => {
      const marker = `${i + 1} 0 obj`
      expect(pdf.slice(off, off + marker.length)).toBe(marker)
    })

    const startxref = pdf.match(/startxref\n(\d+)\n%%EOF/)
    expect(startxref).not.toBeNull()
    const sx = Number(startxref![1])
    expect(pdf.slice(sx, sx + 5)).toBe('xref\n')
  })

  it('embeds the stamp as an image XObject with an alpha SMask', () => {
    const pdf = pdfText(record())
    expect(pdf).toContain('/Subtype /Image')
    expect(pdf).toContain('/ColorSpace /DeviceRGB')
    expect(pdf).toContain('/ColorSpace /DeviceGray')
    expect(pdf).toContain('/SMask 7 0 R')
    expect(pdf).toContain('/XObject << /Im0 8 0 R >>')
    expect(pdf).toContain('/Im0 Do')
  })
})

describe('pdfFilename', () => {
  it('formats a timestamp into hachiko-session-YYYY-MM-DD-HH-mm.pdf', () => {
    expect(pdfFilename(new Date(2026, 8, 10, 14, 5).getTime())).toMatch(
      /^hachiko-session-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.pdf$/,
    )
  })
})
