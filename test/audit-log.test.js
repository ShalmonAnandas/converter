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
