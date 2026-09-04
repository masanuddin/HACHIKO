/**
 * Benchmark information-hierarchy guards.
 *
 * The point of this layout is that runtime health stays READABLE. Model
 * Overview must not drift down the page when a busy frame produces twelve
 * detections instead of two — a metric you have to hunt for is a metric you
 * stop checking. These tests hold the ordering, the row cap, and the rule that
 * each runtime value has exactly one authoritative home.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CANDIDATES } from '../tools/benchmark/candidates.js';

const page = () =>
  readFileSync(new URL('../public/benchmark.html', import.meta.url), 'utf8');
const markup = () => { const h = page(); return h.slice(0, h.indexOf('<script type="module">')); };
const script = () => { const h = page(); return h.slice(h.indexOf('<script type="module">')); };

// ── §1/§2: the selector selects, nothing more ──────────────────────────
test('L1. the candidate selector is a 2x2 grid', () => {
  const css = page().match(/<style>([\s\S]*?)<\/style>/)[1];
  const rule = css.match(/\.scen\{([^}]*)\}/);
  assert.ok(rule, '.scen must be declared');
  assert.match(rule[1], /display:grid/);
  assert.match(rule[1], /grid-template-columns:1fr 1fr/);
  // Narrow screens may stack.
  assert.match(css, /@media\(max-width:1100px\)\{\.scen\{grid-template-columns:1fr\}\}/);
});

test('L2. the candidate card carries no model telemetry', () => {
  const m = markup();
  const card = m.slice(m.indexOf('<h2>Candidate model</h2>'),
                       m.indexOf('Benchmark capture'));
  // Metadata moved to Model Overview; the selector's only job is selection.
  for (const gone of ['mTask', 'mSize', 'mDeleg', 'mInfer']) {
    assert.ok(!card.includes(`id="${gone}"`),
      `#${gone} must not sit under the selector`);
  }
  assert.match(card, /id="models"/, 'the selector itself stays');
});

test('L3. all four candidates are still offered and loadable', () => {
  const js = script();
  assert.match(js, /for \(const c of CANDIDATES\)/,
    'buttons are generated from the candidate list, not hardcoded');
  assert.match(js, /runner\.load\(c\.id\)/, 'selection still loads the model');
  assert.match(js, /b\.classList\.add\('active'\)/, 'active model is highlighted');
  assert.equal(CANDIDATES.length, 4);
});

// ── §4: stable position is the whole point ─────────────────────────────
test('L4. Model Overview sits ABOVE the variable-length detail tables', () => {
  const m = markup();
  const overview = m.indexOf('Model overview');
  const target = m.indexOf('Live target output');
  const details = m.indexOf('Model output details');
  assert.ok(overview > 0 && target > 0 && details > 0, 'all three sections exist');
  assert.ok(overview < target,
    'Model Overview must precede Live Target Output');
  assert.ok(target < details,
    'variable-length detection details come last');
});

test('L5. detection count cannot move Model Overview', () => {
  const js = script();
  // Overview lives in its own card, so nothing below it can reflow it. The
  // detail table is also capped, which bounds how far anything can shift.
  assert.match(js, /const shown = dets\.slice\(0, 5\)/,
    'the detail table must be capped at 5 rows');
  assert.match(js, /\+\$\{dets\.length - shown\.length\} more/,
    'the remainder must be counted, not rendered');
  const m = markup();
  const ovCard = m.slice(m.indexOf('Model overview'), m.indexOf('Live target output'));
  assert.ok(!ovCard.includes('id="topDet"'),
    'Model Overview must not share a card with the detection table');
});

// ── §7: one authoritative home per runtime value ───────────────────────
test('L6. runtime values are not duplicated across panels', () => {
  const m = markup();
  // The old Model Runtime block is gone; its ids must not linger anywhere.
  for (const gone of ['hlLat', 'hlFps', 'hlDeleg', 'hlRaw', 'hlVideo']) {
    assert.ok(!m.includes(`id="${gone}"`),
      `${gone} duplicates Model Overview and must be removed`);
  }
  for (const own of ['ovModel', 'ovCap', 'ovSize', 'ovDelegate',
                     'ovInfer', 'ovFps', 'ovLat', 'ovVideo', 'ovRaw']) {
    assert.ok(m.includes(`id="${own}"`), `Model Overview missing #${own}`);
  }
  // Each authoritative cell is written exactly once.
  const js = script();
  for (const id of ['ovInfer', 'ovFps', 'ovLat', 'ovRaw']) {
    const writes = (js.match(new RegExp(`\\$\\('${id}'\\)\\.textContent`, 'g')) ?? []).length;
    assert.equal(writes, 1, `#${id} must have exactly one writer, found ${writes}`);
  }
});

test('L7. the header keeps one inference number, the detail lives in Overview', () => {
  const js = script();
  // Header orientation only; the authoritative view is Model Overview.
  // The header shows a bare number under an "ms" label so the status bar can
  // never wrap; the labelled detail lives in Model Overview.
  assert.match(js, /\$\('hInfer'\)\.textContent = obs\.inferenceMs\.toFixed\(1\)/);
  assert.ok(!js.includes("$('mInfer')"), 'the removed selector cell is gone');
});

// ── §5: target output as a comparison table ────────────────────────────
test('L8. live target output is a role-labelled table', () => {
  const m = markup();
  const block = m.slice(m.indexOf('id="objBlock"'), m.indexOf('id="insNote"'));
  assert.match(block, /<th>Target<\/th><th>Role<\/th><th>Detected<\/th>/);
  for (const id of ['roPerson', 'dtPerson', 'scPerson', 'pkPerson',
                    'roPhone', 'dtPhone', 'scPhone', 'pkPhone']) {
    assert.ok(block.includes(`id="${id}"`), `target table missing #${id}`);
  }
  // An undetected class must not display a numeric score.
  assert.match(script(), /: 'Not detected'/,
    'a score for something not detected is not information');
});

test('L9. Pose Lite still gets its own inspector', () => {
  const js = script();
  assert.match(js, /\$\('poseBlock'\)\.style\.display = pose \? '' : 'none'/);
  assert.match(js, /\$\('objBlock'\)\.style\.display = pose \? 'none' : ''/);
  // And Model Overview stays visible for pose too.
  const poseArm = js.slice(js.indexOf('if (pose) {'), js.indexOf('const phonePrimary'));
  assert.match(poseArm, /renderOverview\(obs\)/,
    'pose models must still show runtime health');
});

// ── §8: the trend is opt-in ────────────────────────────────────────────
test('L10. the confidence trend is collapsed by default', () => {
  const m = markup();
  assert.match(m, /id="trendWrap" style="display:none"/,
    'the trend must not consume space by default');
  assert.match(m, /id="btnTrend"/, 'and must be reachable');
  const js = script();
  // The buffer keeps running for diagnostics; only drawing is gated.
  assert.match(js, /if \(trendOpen\) drawSpark\(\)/);
  assert.match(js, /trend\.push\(/, 'the diagnostic buffer still fills');
});

// ── §12: zero-dash ─────────────────────────────────────────────────────
test('L11. the benchmark page renders no placeholder dashes', () => {
  const m = markup();
  const holders = [...m.matchAll(
    /<(?:span|td|b|div)[^>]*id="([A-Za-z0-9_]+)"[^>]*>\s*—\s*<\/(?:span|td|b|div)>/g)];
  assert.deepEqual(holders.map((x) => x[1]), [],
    'these elements still render a bare dash');
  // And no escaped dash literals survive in the script.
  assert.ok(!script().includes('\\u2014'),
    'escaped em-dash placeholders must be replaced with real states');
});

test('L12. formatters do not invent placeholders', () => {
  const js = script();
  // A formatter that silently returns a dash hides the reason a value is absent.
  assert.match(js, /const pct = \(v, absent = 'Not applicable'\)/);
  assert.match(js, /const num = \(v, d = 3, absent = 'Not applicable'\)/);
});

// ── Header must stay one line ──────────────────────────────────────────
test('L13. the header status bar cannot wrap', () => {
  const css = page().match(/<style>([\s\S]*?)<\/style>/)[1];
  const hstat = css.match(/\.hstat\{([^}]*)\}/);
  assert.ok(hstat, '.hstat must be declared');
  assert.match(hstat[1], /white-space:nowrap/, 'the bar itself must not wrap');
  // Label and value travel together, so a value can never drop under its label.
  const hgrp = css.match(/\.hgrp\{([^}]*)\}/);
  assert.ok(hgrp, '.hgrp must be declared');
  assert.match(hgrp[1], /display:inline-flex/);
  assert.match(hgrp[1], /white-space:nowrap/);
  // Long ids are clamped rather than allowed to push the buttons off-screen.
  assert.match(css, /\.hgrp b\{[^}]*text-overflow:ellipsis/);
});

test('L14. contextual header items are hidden until they mean something', () => {
  const m = markup();
  // "No scenario" / "No trial" wrapped the bar onto two lines. Hide instead.
  for (const wrap of ['hScenWrap', 'hRepWrap', 'hInferWrap']) {
    assert.match(m, new RegExp(`id="${wrap}"[^>]*hidden`),
      `#${wrap} must start hidden`);
  }
  const js = script();
  assert.match(js, /\$\('hScenWrap'\)\.hidden = !selected/);
  assert.match(js, /\$\('hRepWrap'\)\.hidden = !selected/);
  // And no sentence-length values remain in the bar.
  const bar = m.slice(m.indexOf('class="hstat"'), m.indexOf('hactions'));
  for (const verbose of ['Waiting for camera', 'No scenario selected', 'No model']) {
    assert.ok(!bar.includes(verbose),
      `"${verbose}" is too long for the status bar`);
  }
});

test('L15. the header drops items in priority order, never clipping', () => {
  const css = page().match(/<style>([\s\S]*?)<\/style>/)[1];
  // Least critical first: privacy badge, latency, page title, repetition.
  const order = ['privBadge', 'hInferWrap', '\\.page', 'hRepWrap'];
  const widths = order.map((sel) => {
    const mm = css.match(new RegExp(`@media\\(max-width:(\\d+)px\\)\\{[^}]*${sel}`));
    assert.ok(mm, `no breakpoint drops ${sel}`);
    return Number(mm[1]);
  });
  for (let i = 1; i < widths.length; i++) {
    assert.ok(widths[i] < widths[i - 1],
      `${order[i]} must drop at a narrower width than ${order[i - 1]}`);
  }
});

// ── Completion detail has one home ─────────────────────────────────────
test('L16. the permanent Completion card is gone', () => {
  const m = markup();
  // It repeated the same seven rows that View Benchmark Progress already
  // shows, for no extra insight, while taking a full card of column height.
  assert.ok(!m.includes('id="completion"'),
    'the Completion card duplicates the progress modal');
  assert.ok(!m.includes('id="hCompleteCard"'), 'and its header cell');
  // The one-line summary survives in the page header for orientation.
  assert.match(m, /id="hComplete"/, 'the header keeps the summary count');
  const js = script();
  assert.match(js, /\$\('hComplete'\)\.textContent/,
    'and it is still written from benchmarkCompletion');
});

test('L17. benchmark progress is one scannable table', () => {
  const js = script();
  const fn = js.slice(js.indexOf('function renderProgressModal'),
                      js.indexOf('const openScenModal'));
  assert.match(fn, /table class="vals prog"/, 'progress uses a real table');
  // Columns a reader actually compares down.
  for (const col of ['Model', 'Task', 'Trials', 'Scenarios', 'Status',
                     'Next scenario']) {
    assert.ok(fn.includes(`<th>${col}</th>`) || fn.includes(`>${col}<`),
      `progress table missing column ${col}`);
  }
  // A total row, so the overall state is readable without adding up seven rows.
  assert.match(fn, /ALL CANDIDATES/);
  assert.match(fn, /% of the official matrix/);
  // Explicit per-row state rather than a bare bar.
  for (const state of ['COMPLETE', 'NOT STARTED', 'IN PROGRESS']) {
    assert.ok(fn.includes(`'${state}'`), `progress must state ${state}`);
  }
});

test('L18. Pose Lite appears only for its presence task', () => {
  const js = script();
  const fn = js.slice(js.indexOf('function renderProgressModal'),
                      js.indexOf('const openScenModal'));
  // The presence challenger never runs the phone matrix, so it must not be
  // listed with a phone row it can never complete.
  assert.match(fn, /c\.task === 'pose' \? \['pose'\] : \['person', 'phone'\]/);
});
