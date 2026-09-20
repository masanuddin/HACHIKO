#!/usr/bin/env node
/**
 * The A/B/C ablation from PRD §11. Runs one recorded telemetry JSONL file
 * through the real FocusEngine three times under different configs:
 *
 *   A: visual only        { useDeclaredMedia: false, useObjects: false }
 *   B: + declared media    { useDeclaredMedia: true,  useObjects: true  }
 *   C: B + a recorded clarification answer applied to whatever
 *      B left UNCERTAIN
 *
 * This deliberately reuses src/engine/focusEngine.ts rather than
 * reimplementing the decision table - the whole point of keeping the
 * engine pure (CLAUDE.md constraint 4) is that this script costs nothing.
 *
 * Usage:
 *   node tools/replay.ts <telemetry.jsonl> [--media=book,paper] [--clarify=book|phone|mixed]
 *
 * Node 24+ strips TypeScript types natively, so this runs directly with
 * no build step and no dependency beyond the repo's own engine code.
 */
import { readFileSync } from 'node:fs'
import { FocusEngine, calibrate, DEFAULT_CONFIG } from '../src/engine/focusEngine.ts'
import type { EngineConfig, Frame, FocusState, Media } from '../src/engine/focusEngine.ts'

interface TelemetryRow {
  t: number
  faceFound: boolean
  yaw: number | null
  pitch: number | null
  eyeBlink: number | null
  objects: string[]
}

function parseArgs(argv: string[]): { path: string; media: Media[]; clarify: 'book' | 'phone' | 'mixed' | null } {
  const path = argv.find((a) => !a.startsWith('--'))
  if (!path) {
    console.error('Usage: node tools/replay.ts <telemetry.jsonl> [--media=book,paper] [--clarify=book|phone|mixed]')
    process.exit(1)
  }

  const mediaArg = argv.find((a) => a.startsWith('--media='))
  const media = (mediaArg ? mediaArg.slice('--media='.length).split(',') : ['book']) as Media[]

  const clarifyArg = argv.find((a) => a.startsWith('--clarify='))
  const clarify = (clarifyArg?.slice('--clarify='.length) ?? null) as 'book' | 'phone' | 'mixed' | null

  return { path, media, clarify }
}

function loadRows(path: string): TelemetryRow[] {
  const text = readFileSync(path, 'utf-8')
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TelemetryRow)
}

function toFrame(row: TelemetryRow): Frame {
  return { t: row.t, faceFound: row.faceFound, yaw: row.yaw, pitch: row.pitch, eyeBlink: row.eyeBlink, objects: row.objects }
}

interface RunResult {
  durationsMs: Record<FocusState, number>
  uncertainMs: number
  uncertainPercent: number
  transitions: number
}

// A telemetry file can now be a joined multi-cycle recording (several
// Work cycles' rows concatenated by session.ts's runSession), with a
// real multi-minute gap between cycles where the Break screen ran and
// no frames were captured. That gap isn't a data glitch, but attributing
// it wholesale to whatever state the engine reports on the first row
// after the gap would skew this tool's numbers by minutes per boundary.
// Cap it well above any real inter-frame interval (frames arrive up to
// 5fps, ~200ms apart) but far below a multi-minute Break gap.
const MAX_FRAME_GAP_MS = 2000

function run(rows: TelemetryRow[], cfg: EngineConfig, media: Media[]): RunResult {
  const settled = rows.filter((r) => r.t - (rows[0]?.t ?? 0) >= 3000 && r.faceFound && r.yaw !== null && r.pitch !== null)
  const cone =
    settled.length > 0
      ? calibrate(rows.map(toFrame), cfg)
      : { yawMid: 0, yawTol: cfg.coneFloorRad, pitchMid: 0, pitchTol: cfg.coneFloorRad }

  const engine = new FocusEngine(cfg, cone, media)

  const durationsMs: Record<FocusState, number> = {
    FOKUS: 0,
    TERALIH: 0,
    TIDAK_HADIR: 0,
    UNCERTAIN: 0,
    MENGANTUK: 0,
  }

  let lastT: number | null = null
  let lastState: FocusState | null = null
  let transitions = 0
  let uncertainMs = 0

  for (const row of rows) {
    const dt = lastT === null ? 0 : Math.min(MAX_FRAME_GAP_MS, Math.max(0, row.t - lastT))
    lastT = row.t

    const out = engine.step(toFrame(row))
    durationsMs[out.state] += dt
    if (out.state === 'UNCERTAIN') uncertainMs += dt
    if (out.state !== lastState) {
      transitions += 1
      lastState = out.state
    }
  }

  const totalActiveMs = durationsMs.FOKUS + durationsMs.TERALIH + durationsMs.MENGANTUK + uncertainMs
  const uncertainPercent = totalActiveMs > 0 ? uncertainMs / totalActiveMs : 0

  return { durationsMs, uncertainMs, uncertainPercent, transitions }
}

/** System C: fold whatever System B left UNCERTAIN into the clarified bucket. */
function applyClarification(resultB: RunResult, clarify: 'book' | 'phone' | 'mixed' | null): RunResult {
  const durationsMs = { ...resultB.durationsMs }
  let uncertainMs = resultB.uncertainMs

  if (clarify === 'book') {
    durationsMs.FOKUS += uncertainMs
    durationsMs.UNCERTAIN -= uncertainMs
    uncertainMs = 0
  } else if (clarify === 'phone' || clarify === 'mixed') {
    durationsMs.TERALIH += uncertainMs
    durationsMs.UNCERTAIN -= uncertainMs
    uncertainMs = 0
  }

  const totalActiveMs = durationsMs.FOKUS + durationsMs.TERALIH + durationsMs.MENGANTUK + uncertainMs
  return {
    durationsMs,
    uncertainMs,
    uncertainPercent: totalActiveMs > 0 ? uncertainMs / totalActiveMs : 0,
    transitions: resultB.transitions,
  }
}

function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function printTable(results: Record<'A' | 'B' | 'C', RunResult>): void {
  const states: FocusState[] = ['FOKUS', 'TERALIH', 'TIDAK_HADIR', 'UNCERTAIN', 'MENGANTUK']
  const cols: ('A' | 'B' | 'C')[] = ['A', 'B', 'C']

  const header = ['metric', ...cols.map((c) => `System ${c}`)]
  const rows: string[][] = states.map((state) => [state, ...cols.map((c) => fmtMs(results[c].durationsMs[state]))])
  rows.push(['uncertain %', ...cols.map((c) => `${(results[c].uncertainPercent * 100).toFixed(1)}%`)])
  rows.push(['transitions', ...cols.map((c) => String(results[c].transitions))])

  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const printRow = (r: string[]) => console.log(r.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  |  '))

  printRow(header)
  printRow(widths.map((w) => '-'.repeat(w)))
  for (const r of rows) printRow(r)
}

function main(): void {
  const { path, media, clarify } = parseArgs(process.argv.slice(2))
  const rows = loadRows(path)

  const resultA = run(rows, { ...DEFAULT_CONFIG, useDeclaredMedia: false, useObjects: false }, media)
  const resultB = run(rows, { ...DEFAULT_CONFIG, useDeclaredMedia: true, useObjects: true }, media)
  const resultC = applyClarification(resultB, clarify)

  console.log(`\nReplaying ${rows.length} frames from ${path} (declared media: ${media.join(', ') || '(none)'})\n`)
  printTable({ A: resultA, B: resultB, C: resultC })
  console.log(
    `\nPRD §8 threshold: uncertain time must stay under 20%. System B is ${
      resultB.uncertainPercent > 0.2 ? 'over' : 'under'
    } that line.`,
  )
}

main()
