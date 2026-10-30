// Reconstruct the column-shifted continuation rows used by audit exports.
import { createZip, csvRowsToXlsx, xlsxToRows } from './office.js';

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
