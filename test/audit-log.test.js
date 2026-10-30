import test from 'node:test';
import assert from 'node:assert/strict';
import { repairAuditRows, formatAuditLogs, buildAuditExport } from '../public/lib/audit-log.js';
import { csvRowsToXlsx, xlsxToRows, readZip, createZip } from '../public/lib/office.js';

const header = ['Audit_Log_ID', 'Journey_Ref_No', 'Request', 'Response', 'Tail'];
test('reconstructs multiple shifted continuations without changing fields', () => {
  const repaired = repairAuditRows([header, ['1', '002', 'abcde'], ['fghij'], ['kl', '{"ok":true}', 'end'], ['2', '003', '=literal', '', 'x']], 5);
  assert.deepEqual(repaired.records, [['1', '002', 'abcdefghijkl', '{"ok":true}', 'end'], ['2', '003', '=literal', '', 'x']]);
  assert.equal(repaired.continuations, 2);
  assert.match(formatAuditLogs(repaired), /"ok": true/);
  assert.match(formatAuditLogs(repaired), /=literal/);
});
test('rejects ambiguous or truncated data', () => {
  assert.throws(() => repairAuditRows([header, ['1', '2', 'abcde']], 5), /incomplete/);
  assert.throws(() => repairAuditRows([header, ['1', '2', 'abcde'], ['3', '4', 'x']], 5), /previous field/);
  assert.throws(() => repairAuditRows([header, ['unrecognized']], 5), /unexpected continuation/);
  assert.throws(() => repairAuditRows([header, ['1', '2', 'abcde'], ['x', 'y', 'z', 'too far']], 5), /beyond/);
});
test('ZIP contains preserved oversized values, literal IDs and a readable view', async () => {
  const large = 'x'.repeat(32759) + '💡'.repeat(10);
  const input = await csvRowsToXlsx([header, ['123', '00002', 'x'.repeat(32759)], ['💡'.repeat(10), '{"a":1}', '=literal']], { forceText: true });
  const result = await buildAuditExport(input, { name: 'test.xlsx' });
  const zip = await readZip(result.bytes);
  assert.equal(result.extracted, 1);
  const json = JSON.parse(new TextDecoder().decode(zip.get('json/00002_123_Request.json')));
  assert.equal(json.raw_data, large);
  const fixed = await xlsxToRows(zip.get('test_fixed.xlsx'));
  assert.deepEqual(fixed.rows[1], ['123', '00002', 'See json/00002_123_Request.json', '{"a":1}', '=literal']);
  assert.match(new TextDecoder().decode(zip.get('test_readable.txt')), /"a": 1/);
  await assert.rejects(() => buildAuditExport(input, { sheet: 2 }), /does not exist/);
});
test('rejects formulas rather than silently losing expressions', async () => {
  const input = await csvRowsToXlsx([header, ['1','2','value']]);
  const entries = await readZip(input);
  const decoder = new TextDecoder();
  const files = Object.fromEntries(entries);
  files['xl/worksheets/sheet1.xml'] = decoder.decode(files['xl/worksheets/sheet1.xml']).replace('<c r="C2" t="inlineStr"><is><t xml:space="preserve">value</t></is></c>', '<c r="C2"><f>1+1</f><v>2</v></c>');
  const formulaWorkbook = await createZip(files);
  await assert.rejects(() => buildAuditExport(formulaWorkbook), /Formula cell C2/);
});

test('timeline sorts timestamps and keeps source payloads attached to each call', async () => {
  const { auditTimeline } = await import('../public/lib/audit-log.js');
  const h = ['Audit_Log_ID', 'Journey_Ref_No', 'FE_Request', 'Operation_Type', 'Created_On', 'Status_Code', 'Service_Name'];
  const timeline = auditTimeline({ header: h, records: [
    ['10', '2', '{"id":10}', 'Later', '2026-10-29 19:31:00+05:30', '500', 'svc'],
    ['11', '2', '{"id":11}', 'Earlier', '2026-10-29 14:00:00Z', '200', 'svc'],
    ['12', '2', 'raw', 'Unknown', '', '', 'svc'],
  ] });
  assert.deepEqual(timeline.map(r => r.operation), ['Earlier', 'Later', 'Unknown']);
  assert.equal(timeline[0].row[2], '{"id":11}');
  assert.equal(timeline[1].status, '500');
});

test('viewer reads original split exports with complete payloads', async () => {
  const { readAuditWorkbook } = await import('../public/lib/audit-log.js');
  const input = await csvRowsToXlsx([header, ['1','2','abcde'], ['fghij'], ['kl','response','tail']], { forceText: true });
  const data = await readAuditWorkbook(input, { chunkSize: 5 });
  assert.deepEqual(data.records[0], ['1','2','abcdefghijkl','response','tail']);
  assert.equal(data.continuations, 2);
});

test('viewer rejoins a separate Overflow parts sheet in part order', async () => {
  const { readAuditWorkbook } = await import('../public/lib/audit-log.js');
  const main = await readZip(await csvRowsToXlsx([header, ['1','2','abc','response','tail']], { forceText: true }));
  const parts = await readZip(await csvRowsToXlsx([
    ['Audit_Log_ID','Journey_Ref_No','Field','Part','Text'],
    ['1','2','Request','3','ghi'], ['1','2','Request','2','def'],
  ], { forceText: true }));
  const decoder = new TextDecoder();
  const files = Object.fromEntries(main);
  files['xl/worksheets/sheet2.xml'] = parts.get('xl/worksheets/sheet1.xml');
  files['xl/workbook.xml'] = decoder.decode(main.get('xl/workbook.xml')).replace('</sheets>', '<sheet name="Overflow parts" sheetId="2" r:id="rId3"/></sheets>');
  files['xl/_rels/workbook.xml.rels'] = decoder.decode(main.get('xl/_rels/workbook.xml.rels')).replace('</Relationships>', '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>');
  const workbook = await createZip(files);
  const data = await readAuditWorkbook(workbook);
  assert.equal(data.records[0][2], 'abcdefghi');
});

test('JSON viewer preserves large numbers, duplicate keys, strings and raw non-JSON', async () => {
  const { formatPayload } = await import('../public/lib/audit-log.js');
  const source = '{"n":12345678901234567890,"n":1,"text":"a, {\\\"x\\\"}","empty":[],"obj":{}}';
  const result = formatPayload(source);
  assert.equal(result.valid, true);
  assert.match(result.text, /12345678901234567890/);
  assert.equal((result.text.match(/"n"/g) ?? []).length, 2);
  assert.deepEqual(JSON.parse(result.text), JSON.parse(source));
  assert.deepEqual(formatPayload('not json'), { text: 'not json', valid: false });
});

test('CSV viewer keeps complete oversized fields, quoted JSON, CRLF and scientific IDs', async () => {
  const { readAuditCsv } = await import('../public/lib/audit-log.js');
  const { serializeRows } = await import('../public/lib/csv.js');
  const h = ['Audit_Log_ID','Journey_Ref_No','Operation_Type','FE_Request','Created_On'];
  const payload = JSON.stringify({ text: 'x'.repeat(40000), newline: 'a\r\nb', number: 1 });
  const csv = '\ufeff' + serializeRows([h, ['1','9.66796E+11','Save',payload,'2026-10-30 10:00:00+05:30'], ['2','003','Next','value','']], ',', {protect:false, eol:'\r\n'});
  const parsed = readAuditCsv(csv);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.continuations, 0);
  assert.equal(parsed.records[0][1], '9.66796E+11');
  assert.equal(parsed.records[0][3], payload);
  assert.equal(parsed.records[1][1], '003');
});

test('CSV reconstructs shifted fragments and handles a single offset continuation', async () => {
  const { readAuditCsv } = await import('../public/lib/audit-log.js');
  const h = 'Audit_Log_ID,Journey_Ref_No,FE_Request,FE_Response\r\n';
  const parsed = readAuditCsv(h + '1,9.66796E+11,abcde,\r\nfghij,,,\r\n,klmno\r\npq,answer,,\r\n', { chunkSize: 5 });
  assert.deepEqual(parsed.records, [['1','9.66796E+11','abcdefghijklmnopq','answer']]);
  assert.equal(parsed.continuations, 3);
  assert.throws(() => readAuditCsv(h + '1,2,abcde,\n,x,y,\n', { chunkSize: 5 }), /ambiguous/);
});

test('CSV encoding is detected without replacing invalid UTF-8 bytes', async () => {
  const { decodeAuditCsv } = await import('../public/lib/audit-log.js');
  assert.equal(decodeAuditCsv(Uint8Array.from([0x63,0x61,0x66,0xe9])).text, 'café');
  assert.equal(decodeAuditCsv(Uint8Array.from([0x63,0x61,0x66,0xc3,0xa9])).encoding, 'UTF-8');
  assert.throws(() => decodeAuditCsv(Uint8Array.from([0xff]), 'utf-8'));
});

test('CSV parsing retains a carriage return inside a quoted final field', async () => {
  const { parseCsv } = await import('../public/lib/csv.js');
  assert.deepEqual(parseCsv('a,"last\r"\r\n'), [['a','last\r']]);
});
