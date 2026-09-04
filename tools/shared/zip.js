/**
 * HACHIKO — minimal ZIP writer  (tools/shared)
 * ============================================
 * Store-only (no compression) ZIP, so that one click hands the tester a single
 * archive instead of firing three separate downloads — which browsers commonly
 * block as "multiple downloads" after the first file.
 *
 * Store-only is deliberate: DEFLATE would need a compression library, and the
 * export payload is small text. The archive is a normal .zip that Windows
 * Explorer, macOS Archive Utility, Excel, pandas and R all open directly.
 *
 * Spec: PKWARE APPNOTE 4.3 — local file header, central directory, EOCD.
 * No ZIP64: the export is far below the 4 GB / 65535-entry limits.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time, the only timestamp format the base ZIP header carries. */
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * Build a ZIP archive from in-memory text files.
 *
 * @param {Array<{name: string, content: string}>} files
 * @param {Date} [now] archive timestamp, injectable so tests are deterministic
 * @returns {Uint8Array} the complete archive
 */
export function buildZip(files, now = new Date()) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    // UTF-8 content, always. Excel reads CSV as UTF-8 given the BOM the
    // exporters already prepend; we must not re-encode here.
    const data = enc.encode(f.content);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // local file header signature
    lv.setUint16(4, 20, true);           // version needed (2.0)
    lv.setUint16(6, 0x0800, true);       // flags: bit 11 = UTF-8 filename
    lv.setUint16(8, 0, true);            // method 0 = stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed size == uncompressed
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);           // extra field length
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);   // central directory signature
    cv.setUint16(4, 20, true);           // version made by
    cv.setUint16(6, 20, true);           // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);      // offset of this local header
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);     // end of central directory
  ev.setUint16(8, files.length, true);   // entries on this disk
  ev.setUint16(10, files.length, true);  // total entries
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);        // offset of central directory

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of locals) { out.set(b, p); p += b.length; }
  for (const b of centrals) { out.set(b, p); p += b.length; }
  out.set(eocd, p);
  return out;
}

export default buildZip;
