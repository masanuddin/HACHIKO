/**
 * Benchmark analysis levels (spec §B, §D–§Q, §W).
 *
 * The locked hierarchy is TRIAL → SCENARIO → MODEL → COMPARISON → RANKING, and
 * the whole point of separating them is that a single strong scenario must not
 * be able to masquerade as an overall result. These tests hold each level's
 * arithmetic, and hold the rule that partial evidence is always labelled as
 * such — "100%" from one repetition is the most dangerous number this tool can
 * print.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildScenarioSummaries, scenarioStrengths, buildModelSummaries,
  buildRecommendation, requiredScenarios,
} from '../tools/benchmark/exportResults.js';

const page = () =>
  readFileSync(new URL('../public/benchmark.html', import.meta.url), 'utf8');
const script = () => { const h = page(); return h.slice(h.indexOf('<script type="module">')); };

const OPT = { requiredRepetitions: 3 };
const mk = (o = {}) => ({
  modelId: 'edl0-f16', task: 'person', scenarioId: 'frontal_seated',
  repetition: 1, expectedTargetPresent: true, expected: true,
  detected: true, maxScore: 0.5, falsePositive: false, falseNegative: false,
  inferenceMs: 16, valid: true, ...o,
});

// ── §D/§E: positive scenarios ──────────────────────────────────────────
test('A1. a positive scenario aggregates repetitions correctly', () => {
  const rows = buildScenarioSummaries([
    mk({ repetition: 1, detected: true, maxScore: 0.6 }),
    mk({ repetition: 2, detected: false, maxScore: 0.2 }),
    mk({ repetition: 3, detected: false, maxScore: 0.4 }),
  ], OPT);
  assert.equal(rows.length, 1, 'one row per model x task x scenario');
  const r = rows[0];
  assert.equal(r.repetitionsCompleted, 3);
  assert.equal(r.detectionCount, 1);
  assert.equal(Number((r.detectionRate * 100).toFixed(1)), 33.3);
  assert.equal(r.complete, true);
});

test('A2. median peak target score is a median OF per-trial peaks', () => {
  // Each trial's maxScore is already the peak inside its bounded window, so
  // this must be the median across those peaks — not a peak of medians.
  const r = buildScenarioSummaries([
    mk({ repetition: 1, maxScore: 0.6 }),
    mk({ repetition: 2, maxScore: 0.2 }),
    mk({ repetition: 3, maxScore: 0.4 }),
  ], OPT)[0];
  assert.equal(r.medianPeakTargetScore, 0.4);
});

// ── §F: negative controls ask the opposite question ────────────────────
const NEG = [
  mk({ scenarioId: 'empty_frame', expectedTargetPresent: false, expected: false,
       repetition: 1, detected: false, maxScore: 0.10 }),
  mk({ scenarioId: 'empty_frame', expectedTargetPresent: false, expected: false,
       repetition: 2, detected: true, maxScore: 0.70, falsePositive: true }),
  mk({ scenarioId: 'empty_frame', expectedTargetPresent: false, expected: false,
       repetition: 3, detected: true, maxScore: 0.55, falsePositive: true }),
];

test('A3. a negative control reports false detections, not detection rate', () => {
  const r = buildScenarioSummaries(NEG, OPT)[0];
  assert.equal(r.scenarioType, 'negative_control');
  assert.equal(r.falseDetections, 2);
  assert.equal(Number((r.falsePositiveRate * 100).toFixed(1)), 66.7);
  // A median PEAK is a positive-scenario concept; it must not be offered here.
  assert.equal(r.medianPeakTargetScore, null);
});

test('A4. max false target score covers every negative repetition', () => {
  const r = buildScenarioSummaries(NEG, OPT)[0];
  // 0.70 came from a repetition that fired; the metric must also account for
  // near-misses on repetitions the model got right.
  assert.equal(r.maxFalseTargetScore, 0.7);
  assert.equal(r.maxFalseDetectionScore, 0.7);
});

// ── §J: partial evidence is never presented as final ───────────────────
test('A5. a single repetition is not a complete scenario', () => {
  const r = buildScenarioSummaries([mk({ repetition: 1, detected: true })], OPT)[0];
  assert.equal(r.repetitionsCompleted, 1);
  assert.equal(r.complete, false);
  assert.equal(r.detectionRate, 1, 'the raw rate is 1/1');
  // The UI must never print that bare: 100% from one trial is meaningless.
  const js = script();
  assert.match(js, /\$\{num\}\/\$\{den\}/, 'the denominator travels with the rate');
  assert.match(js, /PRELIM/, 'and partial rows are labelled');
});

// ── §G/§H: Pose Lite is not an object detector ─────────────────────────
test('A6. pose presence scenarios use presence outcomes only', () => {
  const r = buildScenarioSummaries([
    mk({ modelId: 'pose-lite', task: 'pose', repetition: 1, detected: true }),
    mk({ modelId: 'pose-lite', task: 'pose', repetition: 2, detected: true }),
    mk({ modelId: 'pose-lite', task: 'pose', repetition: 3, detected: false }),
  ], OPT)[0];
  assert.equal(r.detectionCount, 2, 'presence successes');
  assert.equal(Number((r.detectionRate * 100).toFixed(1)), 66.7);

  const js = script();
  // The score columns are gated on task, so pose gets no fabricated confidence.
  assert.match(js, /if \(tk !== 'pose'\) cells\.push/,
    'object score columns must be skipped for pose');
  assert.match(js, /Presence Success Rate/);
  assert.match(js, /body geometry, not object/,
    'and the page must say why no score is shown');
});

// ── §O: strengths and weaknesses come from real summaries ──────────────
test('A7. strengths and weaknesses are derived, not invented', () => {
  const trials = [
    ...[1, 2, 3].map((i) => mk({ scenarioId: 'frontal_seated', repetition: i, detected: true })),
    ...[1, 2, 3].map((i) => mk({ scenarioId: 'back_facing', repetition: i, detected: i === 1 })),
    ...[1, 2, 3].map((i) => mk({ scenarioId: 'empty_frame', expectedTargetPresent: false,
      expected: false, repetition: i, detected: false })),
  ];
  const sw = scenarioStrengths(trials, 'edl0-f16', 'person', OPT);
  assert.deepEqual(sw.strong.map((x) => x.scenarioId).sort(),
    ['empty_frame', 'frontal_seated']);
  assert.deepEqual(sw.weak.map((x) => x.scenarioId), ['back_facing']);
  // On a negative control, "success" is correctly staying silent.
  assert.equal(sw.strong.find((x) => x.scenarioId === 'empty_frame').hits, 3);
});

test('A8. an incomplete scenario is never counted as a strength or weakness', () => {
  const sw = scenarioStrengths(
    [mk({ scenarioId: 'back_facing', repetition: 1, detected: false })],
    'edl0-f16', 'person', OPT);
  assert.equal(sw.strong.length, 0);
  assert.equal(sw.weak.length, 0, 'one repetition is not evidence of a weakness');
});

// ── §M: missing data is not "not applicable" ───────────────────────────
test('A9. missing evidence names what is missing', () => {
  const js = script();
  assert.match(js, /Awaiting positive trials/);
  assert.match(js, /Awaiting negative-control data/);
  assert.match(js, /Awaiting positive \+ negative data/);
  // "Not applicable" tells a tester to stop looking; that is only true when the
  // metric genuinely does not apply.
  const cmp = js.slice(js.indexOf('function renderComparisonTab'));
  assert.ok(!/Not applicable/.test(cmp.slice(0, cmp.indexOf('function '))),
    'the comparison table must not call missing data "Not applicable"');
});

// ── §K/§P: model level and ranking eligibility ─────────────────────────
const completeSet = (modelId, task) => {
  const out = [];
  for (const sc of requiredScenarios(task)) {
    for (let r = 1; r <= 3; r++) {
      out.push(mk({ modelId, task, scenarioId: sc.id, repetition: r,
        expectedTargetPresent: sc.expect, expected: sc.expect,
        detected: sc.expect, maxScore: sc.expect ? 0.8 : 0.05,
        falsePositive: false }));
    }
  }
  return out;
};

test('A10. a model summary aggregates every required scenario', () => {
  const rows = buildModelSummaries(completeSet('edl2-f16', 'phone'), OPT);
  const r = rows.find((x) => x.model === 'edl2-f16');
  assert.equal(r.completenessFlag, 'COMPLETE');
  assert.equal(r.scenariosCompleted, requiredScenarios('phone').length);
  assert.ok(r.finalRank >= 1);
});

test('A11. an incomplete model is never ranked', () => {
  const rows = buildModelSummaries([
    ...completeSet('edl2-f16', 'phone'),
    mk({ modelId: 'edl0-f16', task: 'phone', scenarioId: 'screen_portrait' }),
  ], OPT);
  const partial = rows.find((x) => x.model === 'edl0-f16');
  assert.equal(partial.completenessFlag, 'INCOMPLETE');
  assert.equal(partial.finalRank, null);
});

test('A12. ranking waits for every assigned candidate', () => {
  const js = script();
  assert.match(js, /Final ranking becomes available after all/);
  assert.match(js, /complete\.length < assigned/,
    'ranking must gate on all assigned candidates being complete');
});

// ── §V: deletion propagates through every derived level ────────────────
test('A13. deleting the last trial recalculates every level', () => {
  const trials = [
    mk({ repetition: 1, detected: true, maxScore: 0.6 }),
    mk({ repetition: 2, detected: true, maxScore: 0.5 }),
    mk({ repetition: 3, detected: true, maxScore: 0.4 }),
  ];
  let r = buildScenarioSummaries(trials, OPT)[0];
  assert.equal(r.complete, true);
  assert.equal(r.detectionRate, 1);

  trials.pop();                       // Delete Last Trial
  r = buildScenarioSummaries(trials, OPT)[0];
  assert.equal(r.repetitionsCompleted, 2, 'scenario summary recalculates');
  assert.equal(r.complete, false, 'and stops claiming completeness');
  assert.equal(r.medianPeakTargetScore, 0.55, 'and the median re-derives');

  // Model level and ranking eligibility follow from the same source.
  const rows = buildModelSummaries(trials, OPT);
  assert.equal(rows[0].completenessFlag, 'INCOMPLETE');
  assert.equal(rows[0].finalRank, null);
  assert.equal(buildRecommendation(trials, OPT).strategy, 'INCOMPLETE');
});

// ── §T: no vague terminology survives ──────────────────────────────────
test('A14. vague column labels are gone', () => {
  const html = page();
  // "Scenario Results" is the TAB name and is fine; the banned label is the
  // singular column header that said nothing about what was measured.
  for (const vague of ['>Scenario Result<', 'Relevant Metric',
                       'Peak / Relevant', 'Official Status', '>DONE<']) {
    assert.ok(!html.includes(vague), `vague label "${vague}" must be removed`);
  }
  // And the explicit ones are present.
  for (const explicit of ['Detection Rate', 'False Positive Rate',
                          'Median Peak Target Score', 'Max False Target Score',
                          'Presence Success Rate', 'Coverage']) {
    assert.ok(html.includes(explicit), `missing explicit label "${explicit}"`);
  }
});

test('A15. the right panel is two tabs, not stacked permanent cards', () => {
  const html = page();
  const m = html.slice(0, html.indexOf('<script type="module">'));
  assert.match(m, /Model analysis/i);
  assert.match(m, />Scenario Results</);
  assert.match(m, />Model Comparison</);
  assert.match(m, /id="tabScen" class="atabpane on"/, 'Scenario Results is default');
  // Ranking and recommendation live inside a tab and render only when eligible.
  assert.ok(!/<div class="subhead">Ranking<\/div>/.test(m),
    'no permanent Ranking heading');
  assert.ok(!m.includes('id="completion"'), 'no permanent Completion card');
});

// ── Table fit: a clipped column is a lost column ───────────────────────
test('A16. explicit metric names survive as tooltips, not wide headers', () => {
  const js = script();
  // The right panel is ~425px. A 24-character header clipped the row it
  // labelled, so headers are short and the full term moved to the tooltip —
  // the terminology is still exact, it just is not what sets column width.
  for (const [short, full] of [
    ['Rate', 'Detection Rate'],
    ['Med peak', 'Median Peak Target Score'],
    ['FP rate', 'False Positive Rate'],
    ['Max false', 'Max False Target Score'],
    ['Success rate', 'Presence Success Rate'],
  ]) {
    assert.ok(js.includes(`'${short}', '${full}`),
      `header "${short}" must carry the full term "${full}" in its tooltip`);
  }
  // And the header cells actually render the tooltip.
  assert.match(js, /<th title="\$\{full\}">\$\{h\}<\/th>/,
    'scenario headers must emit their tooltip');
});

test('A17. no analysis header is wide enough to clip its column', () => {
  const js = script();
  // Extract the short labels from the header tuples.
  const shorts = [...js.matchAll(/\['([A-Za-z0-9 ]{1,14})', '[^']+'\]/g)]
    .map((m) => m[1]);
  assert.ok(shorts.length >= 10, 'header tuples must be present');
  for (const h of shorts) {
    assert.ok(h.length <= 12,
      `header "${h}" is ${h.length} chars — too wide for a 425px panel`);
  }
  // Comparison headers are literal <th> elements.
  const cmp = [...js.matchAll(/<th title="[^"]+">([A-Za-z0-9 ]+)<\/th>/g)]
    .map((m) => m[1]);
  for (const h of cmp) {
    assert.ok(h.length <= 8, `comparison header "${h}" is too wide`);
  }
});

test('A18. empty cells say what is absent, in words', () => {
  const js = script();
  // A middle dot or a dash is not a state; it is punctuation standing in for
  // one. Every empty cell names its condition.
  assert.ok(!/>·<\/span>/.test(js), 'no middle-dot placeholders');
  assert.ok(!/>—<\/span>/.test(js), 'no em-dash placeholders');
  assert.match(js, /not run/, 'empty cells read as a real state');
  assert.match(js, /title="No repetitions recorded yet"/,
    'and explain themselves on hover');
});

test('A19. the analysis panel has breathing room', () => {
  const css = page().match(/<style>([\s\S]*?)<\/style>/)[1];
  // The table sat flush against the selector row, reading as one dense block.
  assert.match(css, /#anScenBody\{margin-top:\d+px\}/,
    'the scenario table must be separated from its controls');
  assert.match(css, /\.atabpane table\.vals td\{padding-top:\d+px/,
    'rows need vertical padding');
  assert.match(page(), /class="tabs" style="margin-bottom:9px"/,
    'the tab row must be separated from the content below it');
});
