// Reconstruct the column-shifted continuation rows used by audit exports.
import { createZip, csvRowsToXlsx, xlsxToRows } from './office.js';
import { parseCsv } from './csv.js';

const LIMIT = 32767;
const safeName = value => String(value).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 100) || 'unknown';
const present = value => value !== undefined && value !== null && value !== '';

export function repairAuditRows(rows, chunkSize = 32759) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new Error('Chunk size must be a positive integer.');
  const header = rows[0];
  if (!header || header[0] !== 'Audit_Log_ID' || header[1] !== 'Journey_Ref_No') throw new Error('Expected Audit_Log_ID and Journey_Ref_No as the first two columns.');
  if (Array.from(header).some(h => typeof h !== 'string' || !h) || new Set(header).size !== header.length) throw new Error('Headers must be unique, non-empty text.');
  const records = [];
  let current, pending = null, continuations = 0;
  for (let n = 1; n < rows.length; n++) {
    const row = rows[n];
    if (!row.some(present)) continue;
    const start = /^\d+$/.test(String(row[0] ?? '')) && /^\d+$/.test(String(row[1] ?? ''));
    let offset;
    if (start) {
      if (pending !== null) throw new Error(`Row ${n + 1}: a new record appeared before the previous field ended. Check the chunk size.`);
      current = Array(header.length).fill(''); records.push(current); offset = 0;
    } else {
      if (!current || pending === null || !present(row[0])) throw new Error(`Row ${n + 1}: unexpected continuation. Check the identifiers and chunk size.`);
      offset = pending; continuations++;
    }
    let last = row.length - 1;
    while (last >= 0 && !present(row[last])) last--;
    if (offset + last >= header.length) throw new Error(`Row ${n + 1}: data extends beyond the header.`);
    for (let i = 0; i <= last; i++) {
      const value = row[i] ?? '';
      if (typeof value !== 'string') throw new Error(`Row ${n + 1}: unsupported cell value.`);
      if (!start && i === 0) current[offset] += value;
      else current[offset + i] = value;
    }
    pending = Array.from(row[last] ?? '').length === chunkSize ? offset + last : null;
  }
  if (pending !== null) throw new Error('The last field may be incomplete. Check the chunk size.');
  return { header, records, continuations };
}

function readableValue(value) {
  if (!value) return '(empty)';
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}

export function formatAuditLogs({ header, records }) {
  return records.map((record, i) => [
    `# ${i + 1}  Audit ${record[0]}  |  Journey ${record[1]}`,
    ...header.map((key, col) => `\n${key}\n${readableValue(record[col])}`),
  ].join('\n')).join('\n\n' + '─'.repeat(60) + '\n\n');
}

export async function buildAuditExport(buffer, { sheet = 1, chunkSize = 32759, name = 'logs' } = {}) {
  if (!Number.isSafeInteger(sheet) || sheet < 1) throw new Error('Worksheet number must be a positive integer.');
  const workbook = await xlsxToRows(buffer, { sheet, rejectFormulas: true });
  if (sheet > workbook.sheetNames.length) throw new Error(`Worksheet ${sheet} does not exist. This workbook has ${workbook.sheetNames.length} sheet(s).`);
  const result = repairAuditRows(workbook.rows, chunkSize);
  const files = {}, used = new Set();
  const output = result.records.map(record => record.map((value, index) => {
    if (value.length <= LIMIT) return value;
    const base = [record[1], record[0], result.header[index]].map(safeName).join('_');
    let filename = `${base}.json`, counter = 2;
    while (used.has(filename.toLowerCase())) filename = `${base}_${counter++}.json`;
    used.add(filename.toLowerCase());
    files[`json/${filename}`] = JSON.stringify({ journey_ref_no: record[1], audit_log_id: record[0], field: result.header[index], raw_data: value }, null, 2) + '\n';
    return `See json/${filename}`;
  }));
  const readable = formatAuditLogs(result);
  const base = safeName(name.replace(/\.xlsx$/i, ''));
  const expected = [result.header, ...output];
  const fixed = await csvRowsToXlsx(expected, { sheetName: 'Logs', forceText: true });
  const check = await xlsxToRows(fixed);
  if (check.rows.length !== expected.length || expected.some((row, i) => row.some((value, j) => (check.rows[i]?.[j] ?? '') !== value))) {
    throw new Error('The repaired workbook could not preserve every cell. No export was generated.');
  }
  files[`${base}_fixed.xlsx`] = fixed;
  files[`${base}_readable.txt`] = readable;
  return { ...result, sheetName: workbook.sheetNames[workbook.active], readable, extracted: used.size, bytes: await createZip(files) };
}

/** CSV rows normally contain complete values; some spreadsheet exports still
 * carry shifted 32,759-character continuation fragments. */
export function readAuditCsv(text, { chunkSize = 32759 } = {}) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new Error('Chunk size must be a positive integer.');
  const rows = parseCsv(text.replace(/^\uFEFF/, ''), ',');
  const header = rows[0];
  if (!header || header[0] !== 'Audit_Log_ID' || header[1] !== 'Journey_Ref_No') throw new Error('Expected Audit_Log_ID and Journey_Ref_No as the first two columns.');
  if (header.some(h => !h) || new Set(header).size !== header.length) throw new Error('Headers must be unique, non-empty text.');
  const records = [];
  let pending = null, record = null, continuations = 0;
  for (let n = 1; n < rows.length; n++) {
    const row = rows[n];
    if (!row.some(present)) continue;
    const isStart = /^\d+$/.test(row[0] ?? '') && present(row[1]);
    let last = row.length - 1;
    while (last >= 0 && !present(row[last])) last--;
    if (isStart) {
      if (last >= header.length) throw new Error(`CSV record ${n + 1} has more fields than the header.`);
      record = Array.from({length: header.length}, (_, i) => row[i] ?? '');
      records.push(record);
      pending = Array.from(row[last]).length === chunkSize ? last : null;
      continue;
    }
    if (!record || pending === null) throw new Error(`CSV record ${n + 1} is not a recognized audit record or continuation.`);
    let first = row.findIndex(present);
    // A single shifted fragment is unambiguous; multiple shifted fields are not.
    if (first > 0 && first !== last) throw new Error(`CSV record ${n + 1} has an ambiguous shifted continuation.`);
    if (pending + last - first >= header.length) throw new Error(`CSV record ${n + 1} extends beyond the header.`);
    record[pending] += row[first];
    for (let i = first + 1; i <= last; i++) record[pending + i - first] = row[i] ?? '';
    pending = Array.from(row[last]).length === chunkSize ? pending + last - first : null;
    continuations++;
  }
  return { header, records, continuations };
}

export function decodeAuditCsv(buffer, encoding = 'auto') {
  if (encoding === 'auto') {
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'UTF-8' }; }
    catch { return { text: new TextDecoder('windows-1252').decode(buffer), encoding: 'Windows-1252' }; }
  }
  if (!['utf-8', 'windows-1252'].includes(encoding)) throw new Error('Unsupported CSV encoding.');
  return { text: new TextDecoder(encoding, { fatal: true }).decode(buffer), encoding: encoding === 'utf-8' ? 'UTF-8' : 'Windows-1252' };
}

/** Read an audit worksheet, including the optional Overflow parts sheet. */
export async function readAuditWorkbook(buffer, { sheet = 1, chunkSize = 32759 } = {}) {
  if (!Number.isSafeInteger(sheet) || sheet < 1) throw new Error('Worksheet number must be a positive integer.');
  const book = await xlsxToRows(buffer, { sheet, rejectFormulas: true });
  if (sheet > book.sheetNames.length) throw new Error(`Worksheet ${sheet} does not exist. This workbook has ${book.sheetNames.length} sheet(s).`);
  const overflowIndex = book.sheetNames.indexOf('Overflow parts');
  let result;
  if (overflowIndex >= 0 && overflowIndex !== sheet - 1) {
    // This format stores each first segment in the Logs sheet, and remaining segments separately.
    result = repairAuditRows(book.rows, Number.MAX_SAFE_INTEGER);
    const overflow = await xlsxToRows(buffer, { sheet: overflowIndex + 1, rejectFormulas: true });
    if (overflow.rows[0]?.join('|') !== 'Audit_Log_ID|Journey_Ref_No|Field|Part|Text') throw new Error('Unrecognized Overflow parts sheet.');
    const byId = new Map();
    for (const row of result.records) {
      const key = JSON.stringify([row[0], row[1]]);
      if (byId.has(key)) throw new Error('Duplicate audit and journey identifiers make the overflow parts ambiguous.');
      byId.set(key, row);
    }
    const groups = new Map();
    for (const row of overflow.rows.slice(1)) {
      if (!row.some(present)) continue;
      const record = byId.get(JSON.stringify([row[0], row[1]]));
      const column = result.header.indexOf(row[2]);
      const part = Number(row[3]);
      if (!record || column < 0 || !Number.isSafeInteger(part) || part < 2) throw new Error('An overflow part does not match a record and field.');
      const key = JSON.stringify([row[0], row[1], row[2]]);
      if (!groups.has(key)) groups.set(key, { record, column, parts: [] });
      groups.get(key).parts.push([part, row[4] ?? '']);
    }
    for (const group of groups.values()) {
      group.parts.sort((a, b) => a[0] - b[0]);
      group.parts.forEach(([number, text], i) => {
        if (number !== i + 2) throw new Error('Overflow parts are missing or duplicated.');
        group.record[group.column] += text;
      });
    }
  } else result = repairAuditRows(book.rows, chunkSize);
  return { ...result, sheetName: book.sheetNames[book.active] };
}

export function auditTimeline({ header, records }) {
  const index = name => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const value = (row, name) => row[index(name)] ?? '';
  return records.map((row, order) => ({ row, order, operation: value(row, 'Operation_Type'), timestamp: value(row, 'Created_On'), service: value(row, 'Service_Name'), status: value(row, 'Status_Code'), message: value(row, 'Status_Message'), auditId: row[0], journey: row[1] }))
    .sort((a, b) => {
      const time = item => Date.parse(item.timestamp.replace(' ', 'T'));
      const x = time(a), y = time(b);
      return Number.isNaN(x) ? (Number.isNaN(y) ? a.order - b.order : 1) : Number.isNaN(y) ? -1 : x - y || a.order - b.order;
    });
}

// Indent JSON tokens without parsing and reserializing values (which can change
// large numbers or discard duplicate keys). Validate first, then retain tokens.
export function formatPayload(raw) {
  try { JSON.parse(raw); } catch { return { text: raw, valid: false }; }
  let result = '', depth = 0, quoted = false, escaped = false;
  const pad = () => '  '.repeat(depth);
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quoted) {
      result += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') { quoted = true; result += ch; }
    else if (ch === '{' || ch === '[') {
      result += ch; depth++;
      let next = i + 1;
      while (next < raw.length && /\s/.test(raw[next])) next++;
      if (raw[next] !== '}' && raw[next] !== ']') result += '\n' + pad();
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (!/[{[]\s*$/.test(result)) result += '\n' + pad();
      result += ch;
    } else if (ch === ',') result += ',\n' + pad();
    else if (ch === ':') result += ': ';
    else if (!/\s/.test(ch)) result += ch;
  }
  return { text: result, valid: true };
}
