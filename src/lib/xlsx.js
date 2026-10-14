// Writes real Excel workbooks with nothing but Node's own zlib.
// An .xlsx is a ZIP of XML parts, so there is no dependency here to keep patched.
// Totals are written as live SUM formulas with their value cached alongside, so the
// file both opens correctly everywhere and recalculates when someone edits a cell.
const zlib = require('zlib');

// ---------- zip ----------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function zip(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(raw, { level: 6 });
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(0, 30); ch.writeUInt32LE(0, 34);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
  // Control characters are not legal in XML and would make Excel refuse the file
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

function colName(n) { // 1 -> A, 27 -> AA
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
  return s;
}

// Excel stores a date as days since 1899-12-30. The app's world is Lagos time,
// so a timestamp is shifted to Lagos before being flattened into a serial number.
const LAGOS_MS = 60 * 60 * 1000;
function serial(d) {
  const t = d instanceof Date ? d : new Date(d);
  if (isNaN(t)) return null;
  return (t.getTime() + LAGOS_MS) / 86400000 + 25569;
}

// Excel limits: 31 characters, and these characters are not allowed at all
const sheetName = (s, i) => (String(s || `Sheet${i + 1}`).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`);

// ---------- styles ----------
// Index order must match the cellXfs list below.
const FMT = { text: 0, head: 1, int: 2, naira: 3, date: 4, datetime: 5, pct: 6, wrap: 7, title: 8,
  totalText: 9, totalInt: 10, totalNaira: 11, time: 12 };
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="5">
<numFmt numFmtId="170" formatCode="#,##0;(#,##0);&quot;-&quot;"/>
<numFmt numFmtId="171" formatCode="&quot;₦&quot;#,##0;(&quot;₦&quot;#,##0);&quot;-&quot;"/>
<numFmt numFmtId="172" formatCode="dd mmm yyyy"/>
<numFmt numFmtId="173" formatCode="dd mmm yyyy hh:mm"/>
<numFmt numFmtId="174" formatCode="hh:mm"/>
</numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Arial"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
<font><b/><sz val="14"/><name val="Arial"/></font>
<font><b/><sz val="11"/><name val="Arial"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0E4D5C"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF0"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top style="thin"><color rgb="FF0E4D5C"/></top><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="170" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
<xf numFmtId="171" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
<xf numFmtId="172" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
<xf numFmtId="173" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="170" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>
<xf numFmtId="171" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>
<xf numFmtId="174" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const NUMERIC = new Set(['int', 'naira', 'pct']);

// One cell. Numbers and dates are written as numbers so Excel can sum and sort them;
// everything else goes in as an inline string.
function cell(ref, value, type, styleOverride) {
  const s = styleOverride != null ? styleOverride : FMT[type] != null ? FMT[type] : FMT.text;
  if (value == null || value === '') return `<c r="${ref}" s="${s}"/>`;
  if (type === 'date' || type === 'datetime' || type === 'time') {
    const v = serial(value);
    return v == null ? `<c r="${ref}" s="${s}"/>` : `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  }
  if (NUMERIC.has(type)) {
    const n = Number(value);
    return Number.isFinite(n) ? `<c r="${ref}" s="${s}"><v>${n}</v></c>` : `<c r="${ref}" s="${s}"/>`;
  }
  if (type === 'bool') return `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${value ? 'Yes' : 'No'}</t></is></c>`;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

// A totals row: live SUM over the column, with the computed value cached so the
// number shows immediately even before Excel recalculates.
function totalCell(ref, col, letter, first, last, rows) {
  if (!col.total) return `<c r="${ref}" s="${FMT.totalText}"/>`;
  if (col.total === 'label') return `<c r="${ref}" s="${FMT.totalText}" t="inlineStr"><is><t>Total</t></is></c>`;
  const vals = rows.map(r => Number(r[col.key])).filter(Number.isFinite);
  const sum = vals.reduce((a, b) => a + b, 0);
  const v = col.total === 'avg' ? (vals.length ? sum / vals.length : 0) : sum;
  const fn = col.total === 'avg' ? 'AVERAGE' : 'SUM';
  const style = col.type === 'naira' ? FMT.totalNaira : FMT.totalInt;
  if (!rows.length) return `<c r="${ref}" s="${style}"><v>0</v></c>`;
  return `<c r="${ref}" s="${style}"><f>${fn}(${letter}${first}:${letter}${last})</f><v>${v}</v></c>`;
}

function sheetXml(sheet) {
  const cols = sheet.columns;
  const rows = sheet.rows || [];
  const widths = cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`).join('');
  const lastCol = colName(cols.length);

  const header = '<row r="1" ht="28" customHeight="1">' +
    cols.map((c, i) => cell(colName(i + 1) + '1', c.header, 'text', FMT.head)).join('') + '</row>';

  const body = rows.map((r, ri) => {
    const n = ri + 2;
    return `<row r="${n}">` + cols.map((c, i) => cell(colName(i + 1) + n, r[c.key], c.type)).join('') + '</row>';
  }).join('');

  const wantTotals = cols.some(c => c.total);
  const totalRowNo = rows.length + 2;
  const totals = wantTotals
    ? `<row r="${totalRowNo}">` + cols.map((c, i) =>
        totalCell(colName(i + 1) + totalRowNo, c, colName(i + 1), 2, rows.length + 1, rows)).join('') + '</row>'
    : '';

  const lastRow = wantTotals ? totalRowNo : Math.max(rows.length + 1, 1);
  // Freeze the header, and filter only the data rows so the totals row stays put
  const pane = '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
  const filter = rows.length ? `<autoFilter ref="A1:${lastCol}${rows.length + 1}"/>` : '';

  // Printed landscape, squeezed to one page wide, with the header repeating on every page
  const print = `<printOptions/><pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${lastCol}${lastRow}"/>${pane}<sheetFormatPr defaultRowHeight="15"/><cols>${widths}</cols><sheetData>${header}${body}${totals}</sheetData>${filter}${print}</worksheet>`;
}

// sheets: [{ name, columns: [{ header, key, width, type, total }], rows: [...] }]
// A column's `total` is 'sum', 'avg' or 'label'.
function workbook(sheets, meta = {}) {
  const used = new Set();
  const named = sheets.map((s, i) => {
    let n = sheetName(s.name, i), base = n, k = 2;
    while (used.has(n.toLowerCase())) { n = (base.slice(0, 28) + ' ' + k++); }
    used.add(n.toLowerCase());
    return { ...s, name: n };
  });

  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(meta.title || 'Waka Bonny report')}</dc:title><dc:creator>Waka Bonny</dc:creator><cp:lastModifiedBy>Waka Bonny</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Waka Bonny</Application></Properties>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="124519" fullCalcOnLoad="1"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES }
  ];
  named.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }));
  return zip(files);
}

// A safe, dated file name: "Waka Bonny rides 2026-10-01 to 2026-10-13.xlsx"
const fileName = (parts) => parts.filter(Boolean).join(' ').replace(/[^\w\- .]+/g, '').slice(0, 120) + '.xlsx';

module.exports = { workbook, fileName, serial };
