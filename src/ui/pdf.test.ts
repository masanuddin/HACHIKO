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

  it('shows sub-minute durations in seconds', () => {
    const pdf = pdfText(record({ durationsMs: { ...emptyDurations(), FOKUS: 30_000 } }))
    expect(pdf).toContain('30 detik')
    expect(pdf).not.toContain('30 menit')
  })

  it('shows whole-minute durations in minutes', () => {
    const pdf = pdfText(record({ durationsMs: { ...emptyDurations(), FOKUS: 60_000 } }))
    expect(pdf).toContain('1 menit')
  })

  it('reports "Waktu tidak fokus" as the present-but-not-focused total', () => {
    const pdf = pdfText(record({ durationsMs: { ...emptyDurations(), FOKUS: 60_000, TERALIH: 120_000 } }))
    expect(pdf).toContain('2 menit')
  })

  it('includes the study topic when present', () => {
    const pdf = pdfText(record({ studyTopic: 'Matematika - Integral' }))
    expect(pdf).toContain('Matematika - Integral')
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
    const pdf = pdfText(record())
    const header = 'xref\n0 7\n'
    const tableStart = pdf.indexOf(header) + header.length

    const offsets: number[] = []
    let pos = tableStart + 20 // skip the free entry
    for (let i = 0; i < 6; i++) {
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
})

describe('pdfFilename', () => {
  it('formats a timestamp into hachiko-session-YYYY-MM-DD-HH-mm.pdf', () => {
    expect(pdfFilename(new Date(2026, 8, 10, 14, 5).getTime())).toMatch(
      /^hachiko-session-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.pdf$/,
    )
  })
})
