'use strict';
/*
  Builds the Logs export as a real Excel workbook (.xlsx) with native charts.
    Sheet "Log":        every confirmed entry (date, weekday, task, start, end, hours) + a tally per task at the end
    Sheet "Statistics": headline numbers, hours by task (bar), hours by month or day (column), daily trend (line)
  Totals are live formulas (with their values stored too), so the sheet stays right if rows are edited.
  rows: [{ date:'YYYY-MM-DD', title, start:'HH:MM', end:'HH:MM' }]   (confirmed entries only)
*/
const JSZip = require('jszip');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const ref = (c, r) => col(c) + r;
const serial = ymd => { const [y, m, d] = ymd.split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };
const frac = hm => { const [h, m] = hm.split(':').map(Number); return (h * 60 + m) / 1440; };
const hoursOf = r => { let d = frac(r.end) - frac(r.start); if (d < 0) d += 1; return Math.round(d * 24 * 100) / 100; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// cell writers: n = number, s = text, f = formula (+ cached value)
const cN = (c, r, v, st) => `<c r="${ref(c, r)}" s="${st}"><v>${v}</v></c>`;
const cS = (c, r, v, st) => `<c r="${ref(c, r)}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
const cF = (c, r, f, v, st, text) => text ? `<c r="${ref(c, r)}" s="${st}" t="str"><f>${esc(f)}</f><v>${esc(v)}</v></c>` : `<c r="${ref(c, r)}" s="${st}"><f>${esc(f)}</f><v>${v}</v></c>`;
const row = (r, cells, ht) => `<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells.join('')}</row>`;

// style indices (see styles())
const ST = { def: 0, title: 1, head: 2, date: 3, text: 4, time: 5, hrs: 6, bold: 7, boldHrs: 8, pct: 9, wday: 10, kLabel: 11, kVal: 12, int: 13, note: 14, sub: 15, kInt: 16 };
function styles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="5"><numFmt numFmtId="164" formatCode="mmm d, yyyy"/><numFmt numFmtId="165" formatCode="h:mm AM/PM"/><numFmt numFmtId="166" formatCode="0.00"/><numFmt numFmtId="167" formatCode="0.0%"/><numFmt numFmtId="168" formatCode="ddd"/></numFmts>
<fonts count="6">
<font><sz val="10"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="15"/><color rgb="FF3B2A7A"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="10"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="16"/><color rgb="FF3B2A7A"/><name val="Arial"/><family val="2"/></font>
<font><i/><sz val="9"/><color rgb="FF7A7392"/><name val="Arial"/><family val="2"/></font>
</fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF5B4AA8"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1ECFF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top style="thin"><color rgb="FF5B4AA8"/></top><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFD9D2F2"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="17">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="166" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="168" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="166" fontId="4" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="1" fontId="4" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

// ---- charts (DrawingML). Colors follow the Logs palette.
const PAL = ['8B6CF0', 'F28CB8', 'F2C063', '6CC7E0', '7FD6A8', 'B39CFF'];
function chartXml({ kind, title, cats, vals, color, xTitle, yTitle }) {
  const ser = `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${esc(yTitle)}</c:v></c:tx>
<c:spPr>${kind === 'line' ? `<a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln>` : `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`}</c:spPr>
${kind === 'line' ? '<c:marker><c:symbol val="none"/></c:marker>' : '<c:invertIfNegative val="0"/>'}
${kind !== 'line' ? `<c:dLbls><c:numFmt formatCode="0.0" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="4A4366"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>` : ''}
<c:cat><c:${cats.str ? 'strRef' : 'numRef'}><c:f>${esc(cats.f)}</c:f>${cats.str ? `<c:strCache><c:ptCount val="${cats.v.length}"/>${cats.v.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>` : `<c:numCache><c:formatCode>${esc(cats.fmt)}</c:formatCode><c:ptCount val="${cats.v.length}"/>${cats.v.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache>`}</c:${cats.str ? 'strRef' : 'numRef'}></c:cat>
<c:val><c:numRef><c:f>${esc(vals.f)}</c:f><c:numCache><c:formatCode>0.00</c:formatCode><c:ptCount val="${vals.v.length}"/>${vals.v.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val>
${kind === 'line' ? '<c:smooth val="0"/>' : ''}</c:ser>`;
  const axTitle = t => `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="0"><a:solidFill><a:srgbClr val="6B6488"/></a:solidFill></a:defRPr></a:pPr><a:r><a:rPr lang="en-US" sz="900" b="0"><a:solidFill><a:srgbClr val="6B6488"/></a:solidFill></a:rPr><a:t>${esc(t)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
  const txt = `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="6B6488"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
  const grid = `<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E6E1F5"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>`;
  const plot = kind === 'line'
    ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser}<c:marker val="1"/><c:axId val="501"/><c:axId val="502"/></c:lineChart>`
    : `<c:barChart><c:barDir val="${kind === 'bar' ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser}<c:gapWidth val="60"/><c:axId val="501"/><c:axId val="502"/></c:barChart>`;
  const catPos = kind === 'bar' ? 'l' : 'b', valPos = kind === 'bar' ? 'b' : 'l';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:roundedCorners val="0"/>
<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1300" b="1"><a:solidFill><a:srgbClr val="3B2A7A"/></a:solidFill></a:defRPr></a:pPr><a:r><a:rPr lang="en-US" sz="1300" b="1"><a:solidFill><a:srgbClr val="3B2A7A"/></a:solidFill></a:rPr><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}
<c:catAx><c:axId val="501"/><c:scaling><c:orientation val="${kind === 'bar' ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${catPos}"/>${xTitle ? axTitle(xTitle) : ''}<c:numFmt formatCode="${esc(cats.fmt || 'General')}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="CFC7EA"/></a:solidFill></a:ln></c:spPr>${txt}<c:crossAx val="502"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>${kind === 'line' && cats.v.length > 31 ? `<c:tickLblSkip val="${Math.ceil(cats.v.length / 12)}"/><c:tickMarkSkip val="${Math.ceil(cats.v.length / 12)}"/>` : ''}<c:noMultiLvlLbl val="0"/></c:catAx>
<c:valAx><c:axId val="502"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="${valPos}"/>${grid}${axTitle('Hours')}<c:numFmt formatCode="0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txt}<c:crossAx val="501"/><c:crosses val="${kind === 'bar' ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>
<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>
<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>
<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="E1DBF3"/></a:solidFill></a:ln></c:spPr>
</c:chartSpace>`;
}
function anchor(id, rid, c1, r1, c2, r2) {
  return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${c2}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id + 1}" name="Chart ${id}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
}

async function buildLogsWorkbook({ rows, label, app = 'M.I.K.U' }) {
  rows = rows.filter(r => r.date && r.start && r.end).slice().sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const N = rows.length, first = 4, last = first + N - 1;            // data rows on the Log sheet
  const rng = c => N ? `Log!$${c}$${first}:$${c}$${last}` : `Log!$${c}$${first}:$${c}$${first}`;
  // ---------- Log sheet
  const L = [];
  L.push(row(1, [cS(0, 1, `${app} · Logs · ${label}`, ST.title)], 24));
  L.push(row(2, [cS(0, 2, 'Confirmed (verified) hours only. Hours are worked out from Start and End; the tally below adds them up per task.', ST.note)]));
  L.push(row(3, ['Date', 'Day', 'Task', 'Start', 'End', 'Hours'].map((h, i) => cS(i, 3, h, ST.head)), 20));
  rows.forEach((x, i) => {
    const r = first + i, h = hoursOf(x);
    L.push(row(r, [cN(0, r, serial(x.date), ST.date), cF(1, r, `A${r}`, serial(x.date), ST.wday), cS(2, r, x.title, ST.text), cN(3, r, frac(x.start), ST.time), cN(4, r, frac(x.end), ST.time),
      cF(5, r, `IF(E${r}>=D${r},(E${r}-D${r})*24,(E${r}+1-D${r})*24)`, h, ST.hrs)]));
  });
  // tally: total hours per task (each "logged experience" combined)
  const tasks = [...new Set(rows.map(r => r.title))];
  const byTask = tasks.map(t => [t, Math.round(rows.filter(r => r.title === t).reduce((s, r) => s + hoursOf(r), 0) * 100) / 100]).sort((a, b) => b[1] - a[1]);
  const total = Math.round(byTask.reduce((s, x) => s + x[1], 0) * 100) / 100;
  let r = (N ? last : first) + 2;
  L.push(row(r, [cS(0, r, 'Total hours by task', ST.sub)])); r++;
  const tHead = r; L.push(row(r, ['Task', 'Hours', 'Share', 'Entries'].map((h, i) => cS(i + 2, r, h, ST.head)), 20)); r++;
  const tFirst = r;
  byTask.forEach(([t, h]) => {
    L.push(row(r, [cS(2, r, t, ST.text), cF(3, r, `SUMIF(${rng('C').replace('Log!', '')},C${r},${rng('F').replace('Log!', '')})`, h, ST.hrs),
      cF(4, r, `IF($D$${tFirst + byTask.length}=0,0,D${r}/$D$${tFirst + byTask.length})`, total ? h / total : 0, ST.pct),
      cF(5, r, `COUNTIF(${rng('C').replace('Log!', '')},C${r})`, rows.filter(x => x.title === t).length, ST.int)])); r++;
  });
  const tLast = r - 1, totRow = r;
  L.push(row(r, [cS(2, r, 'All tasks', ST.bold), cF(3, r, byTask.length ? `SUM(D${tFirst}:D${tLast})` : '0', total, ST.boldHrs), cF(4, r, byTask.length ? `SUM(E${tFirst}:E${tLast})` : '0', total ? 1 : 0, ST.pct), cF(5, r, byTask.length ? `SUM(F${tFirst}:F${tLast})` : '0', N, ST.int)]));
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols><col min="1" max="1" width="15" customWidth="1"/><col min="2" max="2" width="7" customWidth="1"/><col min="3" max="3" width="30" customWidth="1"/><col min="4" max="5" width="12" customWidth="1"/><col min="6" max="6" width="10" customWidth="1"/></cols>
<sheetData>${L.join('')}</sheetData>
${N ? `<autoFilter ref="A3:F${last}"/>` : ''}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="portrait" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;

  // ---------- Statistics sheet
  const days = [...new Set(rows.map(x => x.date))];
  const dayHours = days.map(d => Math.round(rows.filter(x => x.date === d).reduce((s, x) => s + hoursOf(x), 0) * 100) / 100);
  const longest = N ? Math.max(...rows.map(hoursOf)) : 0;
  // periods: by month for long ranges, by day for short ones
  const span = days.length ? serial(days[days.length - 1]) - serial(days[0]) + 1 : 0;
  const byMonth = span > 45;
  const periods = [];
  if (byMonth) {
    const ys = [...new Set(rows.map(x => x.date.slice(0, 4)))];
    for (const y of ys) for (let m = 1; m <= 12; m++) { const key = `${y}-${String(m).padStart(2, '0')}`; const v = rows.filter(x => x.date.startsWith(key)).reduce((s, x) => s + hoursOf(x), 0); if (ys.length === 1 || v) periods.push({ label: `${MON[m - 1]} ${y}`, from: serial(key + '-01'), to: serial(m === 12 ? `${+y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`), v: Math.round(v * 100) / 100 }); }
  } else {
    days.forEach((d, i) => periods.push({ label: `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8)}`, from: serial(d), to: serial(d) + 1, v: dayHours[i] }));
  }
  // every calendar day in the range, for the trend line (empty days count as 0)
  const trend = [], weekly = span > 62;
  if (days.length) {
    let s0 = serial(days[0]); const sEnd = serial(days[days.length - 1]);
    if (weekly) s0 -= ((s0 + 5) % 7);                       // back to Monday (serial 2 = Mon Jan 1 1900)
    for (let s = s0; s <= sEnd; s += weekly ? 7 : 1) { const e = s + (weekly ? 7 : 1); const v = rows.filter(x => serial(x.date) >= s && serial(x.date) < e).reduce((a, x) => a + hoursOf(x), 0); trend.push({ s, e, v: Math.round(v * 100) / 100 }); }
  }
  const S = [];
  S.push(row(1, [cS(0, 1, `${app} · Statistics · ${label}`, ST.title)], 24));
  S.push(row(2, [cS(0, 2, 'All numbers are confirmed hours from the Log tab.', ST.note)]));
  const k = (c, rr, lab, f, v, st) => [cS(c, rr, lab, ST.kLabel), cF(c, rr + 1, f, v, st)];
  S.push(row(4, [cS(0, 4, 'Total hours', ST.kLabel), cS(2, 4, 'Days worked', ST.kLabel), cS(4, 4, 'Avg per worked day', ST.kLabel), cS(6, 4, 'Longest session (h)', ST.kLabel)]));
  S.push(row(5, [
    cF(0, 5, `SUM(${rng('F')})`, total, ST.kVal),
    cF(2, 5, N ? `SUMPRODUCT(1/COUNTIF(${rng('A')},${rng('A')}))` : '0', days.length, ST.kInt),
    cF(4, 5, 'IF(C5=0,0,A5/C5)', days.length ? Math.round(total / days.length * 100) / 100 : 0, ST.kVal),
    cF(6, 5, `MAX(${rng('F')})`, longest, ST.kVal)], 30));
  S.push(row(6, [cS(0, 6, 'Most worked task', ST.kLabel)]));
  S.push(row(7, [cF(0, 7, byTask.length ? `INDEX(Log!$C$${tFirst}:$C$${tLast},MATCH(MAX(Log!$D$${tFirst}:$D$${tLast}),Log!$D$${tFirst}:$D$${tLast},0))` : '"—"', byTask.length ? byTask[0][0] : '—', ST.bold, true)]));
  // table: hours by task (feeds the bar chart)
  let sr = 9;
  S.push(row(sr, [cS(0, sr, 'Task', ST.head), cS(1, sr, 'Hours', ST.head)], 20)); sr++;
  const bFirst = sr;
  byTask.forEach(([t, h], i) => { S.push(row(sr, [cF(0, sr, `Log!C${tFirst + i}`, t, ST.text, true), cF(1, sr, `Log!D${tFirst + i}`, h, ST.hrs)])); sr++; });
  const bLast = Math.max(bFirst, sr - 1);
  sr += 1;
  const pHead = sr; S.push(row(sr, [cS(0, sr, byMonth ? 'Month' : 'Day', ST.head), cS(1, sr, 'Hours', ST.head)], 20)); sr++;
  const pFirst = sr;
  periods.forEach(p => { S.push(row(sr, [cS(0, sr, p.label, ST.text), cF(1, sr, `SUMIFS(${rng('F')},${rng('A')},">="&${p.from},${rng('A')},"<"&${p.to})`, p.v, ST.hrs)])); sr++; });
  const pLast = Math.max(pFirst, sr - 1);
  // daily series for the trend line, kept off to the side (columns Q:R)
  const dFirst = 10;
  const dRows = trend.map((t, i) => [cN(16, dFirst + i, t.s, ST.date), cF(17, dFirst + i, weekly ? `SUMIFS(${rng('F')},${rng('A')},">="&Q${dFirst + i},${rng('A')},"<"&(Q${dFirst + i}+7))` : `SUMIF(${rng('A')},Q${dFirst + i},${rng('F')})`, t.v, ST.hrs)]);
  const dLast = Math.max(dFirst, dFirst + trend.length - 1);
  // merge the side columns into the existing rows
  const byRow = new Map(); S.forEach(x => { const m = x.match(/^<row r="(\d+)"/); byRow.set(+m[1], x); });
  byRow.set(9, (byRow.get(9) || row(9, [])).replace('</row>', cS(16, 9, weekly ? 'Week of' : 'Date', ST.head) + cS(17, 9, 'Hours', ST.head) + '</row>'));
  dRows.forEach((cells, i) => { const rr = dFirst + i; const ex = byRow.get(rr); byRow.set(rr, ex ? ex.replace('</row>', cells.join('') + '</row>') : row(rr, cells)); });
  const sheet2Rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(x => x[1]).join('');
  const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="2" width="11" customWidth="1"/><col min="3" max="3" width="13" customWidth="1"/><col min="4" max="4" width="4" customWidth="1"/><col min="5" max="5" width="18" customWidth="1"/><col min="6" max="6" width="4" customWidth="1"/><col min="7" max="7" width="18" customWidth="1"/><col min="8" max="16" width="9" customWidth="1"/><col min="17" max="17" width="14" customWidth="1"/><col min="18" max="18" width="9" customWidth="1"/></cols>
<sheetData>${sheet2Rows}</sheetData>
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="1"/>
<drawing r:id="rId1"/>
</worksheet>`;

  // ---------- charts
  const charts = [
    chartXml({ kind: 'bar', title: 'Hours by task', yTitle: 'Hours', color: PAL[0], cats: { str: true, f: `Statistics!$A$${bFirst}:$A$${bLast}`, v: byTask.map(x => x[0]) }, vals: { f: `Statistics!$B$${bFirst}:$B$${bLast}`, v: byTask.map(x => x[1]) } }),
    chartXml({ kind: 'col', title: byMonth ? 'Hours by month' : 'Hours by day', yTitle: 'Hours', color: PAL[1], cats: { str: true, f: `Statistics!$A$${pFirst}:$A$${pLast}`, v: periods.map(p => p.label) }, vals: { f: `Statistics!$B$${pFirst}:$B$${pLast}`, v: periods.map(p => p.v) } }),
    chartXml({ kind: 'line', title: weekly ? 'Weekly hours' : 'Daily hours', yTitle: 'Hours', color: PAL[3], cats: { str: false, fmt: 'mmm d', f: `Statistics!$Q$${dFirst}:$Q$${dLast}`, v: trend.map(t => t.s) }, vals: { f: `Statistics!$R$${dFirst}:$R$${dLast}`, v: trend.map(t => t.v) } })
  ];
  const taskH = Math.max(14, Math.min(30, 6 + byTask.length * 1.6)) | 0;
  const drawing = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${anchor(1, 'rId1', 4, 8, 15, 8 + taskH)}${anchor(2, 'rId2', 4, 9 + taskH, 15, 9 + taskH + 18)}${anchor(3, 'rId3', 4, 10 + taskH + 18, 15, 10 + taskH + 36)}
</xdr:wsDr>`;

  // ---------- package
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
<Override PartName="/xl/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
<Override PartName="/xl/charts/chart3.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(app)} Logs ${esc(label)}</dc:title><dc:creator>${esc(app)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`);
  zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets><sheet name="Log" sheetId="1" r:id="rId1"/><sheet name="Statistics" sheetId="2" r:id="rId2"/></sheets>
<definedNames>${N ? `<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Log!$A$3:$F$${last}</definedName>` : ''}<definedName name="_xlnm.Print_Area" localSheetId="1">Statistics!$A$1:$O$${Math.max(pLast, 10 + taskH + 37)}</definedName></definedNames>
<calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', styles());
  zip.file('xl/worksheets/sheet1.xml', sheet1);
  zip.file('xl/worksheets/sheet2.xml', sheet2);
  zip.file('xl/worksheets/_rels/sheet2.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  zip.file('xl/drawings/drawing1.xml', drawing);
  zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[1, 2, 3].map(i => `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${i}.xml"/>`).join('')}</Relationships>`);
  charts.forEach((c, i) => zip.file(`xl/charts/chart${i + 1}.xml`, c));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildLogsWorkbook, hoursOf };
