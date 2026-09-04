/**
 * Guards against the failure mode that made every button on the debug harness
 * inert: a module-level SyntaxError aborts evaluation, so the onclick
 * assignments at the bottom of the script never run. The buttons still render,
 * still look enabled, and do nothing — with no visible error on the page.
 *
 * These are static checks on purpose. They catch the defect at commit time
 * rather than during a live test session in front of a camera.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, p), 'utf8');

const PAGES = ['../public/index.html', '../public/benchmark.html'];

const scriptOf = (html) => {
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(m, 'the page must carry a module script');
  return m[1];
};

for (const page of PAGES) {
  const name = page.split('/').pop();

  test(`P1. ${name} module script parses`, () => {
    const src = scriptOf(read(page));
    // A parse failure here is exactly the defect: nothing after it ever runs.
    assert.doesNotThrow(
      () => new vm.SourceTextModule(src, { identifier: name }),
      'the page script must parse; a SyntaxError silently disables every button',
    );
  });

  test(`P2. ${name} declares no identifier twice at module scope`, () => {
    const src = scriptOf(read(page));
    // Strip strings and comments so declarations inside them are not counted.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
      .replace(/'(?:\\.|[^'\\])*'/g, "''")
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/`(?:\\.|[^`\\])*`/g, '``');
    const seen = new Map();
    for (const line of stripped.split('\n')) {
      // Only module-scope declarations, i.e. no leading indentation.
      const m = line.match(/^(?:const|let|class)\s+([A-Za-z_$][\w$]*)\s*[=;{]/);
      if (!m) continue;
      const prev = seen.get(m[1]);
      assert.equal(prev, undefined,
        `'${m[1]}' is declared twice at module scope — the second declaration ` +
        'throws before any handler binds');
      seen.set(m[1], true);
    }
  });

  test(`P3. ${name} binds a handler for every button it renders`, () => {
    const html = read(page);
    const src = scriptOf(html);
    // Buttons written into the markup with an id are operated from JS; each one
    // must have an onclick assigned, or it is dead on arrival.
    const ids = [...html.matchAll(/<button[^>]*\bid="([A-Za-z0-9_]+)"/g)]
      .map((m) => m[1]);
    assert.ok(ids.length >= 5, 'expected the page to declare real controls');
    for (const btnId of ids) {
      // The two pages use different accessor helpers: id('x') and $('x').
      const bound = new RegExp(
        `(?:id|\\$)\\('${btnId}'\\)\\.onclick|\\b${btnId}\\.onclick`).test(src);
      assert.ok(bound, `#${btnId} renders but never receives an onclick`);
    }
  });

  test(`P4. ${name} references only elements that exist`, () => {
    const html = read(page);
    const cut = html.indexOf('<script type="module">');
    const markup = html.slice(0, cut);
    const src = html.slice(cut);
    const present = new Set(
      [...markup.matchAll(/id="([A-Za-z0-9_]+)"/g)].map((m) => m[1]));
    // id('x') returns null for a missing node, and the first property write
    // against it throws inside the render loop.
    const referenced = new Set(
      [...src.matchAll(/(?:\bid|\$)\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]));
    const missing = [...referenced].filter((x) => !present.has(x));
    assert.deepEqual(missing, [],
      `these ids are read from the DOM but never rendered: ${missing.join(', ')}`);
  });
}
