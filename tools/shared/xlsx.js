/**
 * HACHIKO — minimal XLSX writer  (tools/shared)
 * =============================================
 * Writes an OOXML SpreadsheetML workbook using the ZIP writer already in this
 * folder. An .xlsx IS a ZIP of XML parts, so no third-party library is needed.
 *
 * ── WHY NOT SheetJS / ExcelJS ────────────────────────────────────────────
 * The pages are fully offline: models and the MediaPipe bundle are vendored,
 * and the only npm dependency is @mediapipe. A bundled spreadsheet library
 * would add hundreds of KB and a build step to emit a handful of static
 * tables. The subset needed here — inline strings, numbers, a few fills, a
 * frozen pane and an autofilter — is small and stable, and we already own a
 * tested ZIP writer.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────
 * This is a PRESENTATION layer. It formats values it is handed; it computes no
 * scientific quantity and contains no spreadsheet formulas, so a workbook can
 * never disagree with the JSON master it was built from.
 *
 * No macros, no external references, no network calls.
 */

import { buildZip } from './zip.js';

/** Escape the five XML entities. Sheet content is user/scenario text. */
function esc(v) {
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // Control characters are illegal in XML 1.0 and would corrupt the file.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** A1-style column name: 0 -> A, 26 -> AA. */
export function colName(index) {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Style ids, in the order they are written into styles.xml.
 * Restrained on purpose: legible when printed, and readable to anyone who
 * cannot distinguish the fills.
 */
export const S = Object.freeze({
  DEFAULT: 0,
  TITLE: 1,       // report title
  LABEL: 2,       // session-panel label
  VALUE: 3,       // session-panel value
  HEADER: 4,      // table header
  PASS: 5,        // subtle green
  FAIL: 6,        // subtle red
  WARN: 7,        // subtle amber — INVALID / PRELIMINARY / INCOMPLETE
  NUM2: 8,        // 2 decimals
  NUM1: 9,        // 1 decimal
  PCT1: 10,       // percentage, 1 decimal
  MUTED: 11,      // de-emphasised text (awaiting data)
  SECTION: 12,    // section heading
  // Appended, never inserted: every id above is referenced by workbooks that
  // have already passed review, so renumbering them would silently restyle
  // cells elsewhere.
  MUTED_WRAP: 13, // de-emphasised text that must wrap (readiness wording)
});

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
<numFmt numFmtId="164" formatCode="0.00"/>
<numFmt numFmtId="165" formatCode="0.0"/>
<numFmt numFmtId="166" formatCode="0.0%"/>
</numFmts>
<fonts count="6">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><sz val="11"/><color rgb="FF505050"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF1F3864"/><name val="Calibri"/></font>
<font><sz val="11"/><color rgb="FF808080"/><name val="Calibri"/></font>
</fonts>
<fills count="7">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE2EFDA"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFCE4E4"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFB0B0B0"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * How many styles styles.xml actually defines.
 *
 * Read from the stylesheet itself so the two can never drift: a cell pointing
 * past the end of cellXfs is silently ignored by some readers and rendered
 * wrong by others, which is exactly the kind of fault that survives a test
 * suite and a parser check and only shows up in Excel.
 */
const STYLE_COUNT = Number(STYLES_XML.match(/<cellXfs count="(\d+)"/)[1]);

/**
 * One cell.
 * @typedef {{v: *, s?: number}|string|number|null} Cell
 */

function cellXml(cell, ref) {
  const val = (cell && typeof cell === 'object' && 'v' in cell) ? cell.v : cell;
  const style = (cell && typeof cell === 'object' && 's' in cell) ? cell.s : S.DEFAULT;
  if (!Number.isInteger(style) || style < 0 || style >= STYLE_COUNT) {
    throw new RangeError(
      `cell ${ref}: style ${style} is not defined in styles.xml `
      + `(0..${STYLE_COUNT - 1})`);
  }
  const sAttr = style ? ` s="${style}"` : '';

  // A blank cell is genuinely blank — never coerced to 0 or "".
  if (val === null || val === undefined || val === '') {
    return sAttr ? `<c r="${ref}"${sAttr}/>` : '';
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    return `<c r="${ref}"${sAttr}><v>${val}</v></c>`;
  }
  if (typeof val === 'boolean') {
    return `<c r="${ref}"${sAttr} t="b"><v>${val ? 1 : 0}</v></c>`;
  }
  // Inline strings avoid a shared-string table: simpler, and the payload here
  // is small enough that de-duplication buys nothing.
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">`
    + `${esc(val)}</t></is></c>`;
}

function sheetXml(sheet) {
  const rows = sheet.rows.map((row, r) => {
    const cells = row.map((cell, c) => cellXml(cell, `${colName(c)}${r + 1}`)).join('');
    const h = sheet.rowHeights?.[r];
    return `<row r="${r + 1}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cells}</row>`;
  }).join('');

  const cols = (sheet.widths ?? []).map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');

  // Freeze panes: everything above/left of the split stays on screen.
  let pane = '';
  if (sheet.freeze) {
    const { row = 0, col = 0 } = sheet.freeze;
    const top = `${colName(col)}${row + 1}`;
    pane = `<pane xSplit="${col}" ySplit="${row}" topLeftCell="${top}"`
      + ` activePane="bottomRight" state="frozen"/>`;
  }

  const filter = sheet.autoFilter
    ? `<autoFilter ref="${sheet.autoFilter}"/>` : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols ? `<cols>${cols}</cols>` : ''}
<sheetData>${rows}</sheetData>
${filter}
</worksheet>`;
}

/**
 * Build a workbook.
 *
 * @param {Array<{name: string, rows: Cell[][], widths?: number[],
 *                freeze?: {row?: number, col?: number}, autoFilter?: string,
 *                rowHeights?: Object}>} sheets
 * @param {Date} [now]
 * @returns {Uint8Array} the .xlsx bytes
 */
export function buildXlsx(sheets, now = new Date()) {
  if (!sheets.length) throw new Error('a workbook needs at least one sheet');

  const sheetEntries = sheets.map((s, i) => ({
    id: i + 1, rid: `rId${i + 1}`, file: `xl/worksheets/sheet${i + 1}.xml`, sheet: s,
  }));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheetEntries.map((e) => `<Override PartName="/${e.file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetEntries.map((e) =>
  `<sheet name="${esc(e.sheet.name)}" sheetId="${e.id}" r:id="${e.rid}"/>`).join('')}</sheets>
</workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheetEntries.map((e) =>
  `<Relationship Id="${e.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${e.id}.xml"/>`).join('')}
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  return buildZip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: wbRels },
    { name: 'xl/styles.xml', content: STYLES_XML },
    ...sheetEntries.map((e) => ({ name: e.file, content: sheetXml(e.sheet) })),
  ], now);
}

export default buildXlsx;
