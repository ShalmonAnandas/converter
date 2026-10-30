import { readAuditWorkbook, auditTimeline, formatPayload } from './lib/audit-log.js';

const PAYLOADS = [ ['FE_Request', 'FE request'], ['FE_Response', 'FE response'], ['Bank_API_Request', 'BE request'], ['Bank_API_Response', 'BE response'] ];
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const shown = value => value ? escape(value) : '<span class="audit-muted">—</span>';

export function createAuditViewer(root) {
  root.innerHTML = `
    <div class="audit-upload">
      <div><h2>Explore an audit export</h2><p>Choose an XLSX file to view its API calls. Your data stays in this browser.</p></div>
      <label class="button primary audit-file">Open XLSX<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>
    </div>
    <div class="audit-settings">
      <label>Worksheet <input data-sheet type="number" value="1" min="1" step="1"></label>
      <label>Chunk size <input data-chunk type="number" value="32759" min="1" step="1"></label>
      <button class="button tiny" data-reload type="button">Reload</button>
      <span data-filename class="audit-muted">No file selected</span>
    </div>
    <p class="audit-message" data-message role="status" aria-live="polite">Select an audit export to get started.</p>
    <div class="audit-workspace" data-workspace hidden>
      <section class="audit-list-panel" aria-label="API call timeline">
        <div class="audit-section-head"><div><h2>Timeline</h2><span data-count class="audit-muted"></span></div></div>
        <input class="audit-search" data-search type="search" placeholder="Filter operation, service, status, ID…" aria-label="Filter timeline">
        <div class="audit-timeline" data-timeline></div>
      </section>
      <section class="audit-detail" data-detail aria-label="API call details"><p class="audit-muted">Select a call to see its details.</p></section>
    </div>
    <dialog class="audit-dialog" data-dialog aria-labelledby="audit-dialog-title">
      <div class="audit-dialog-head"><div><h2 id="audit-dialog-title"></h2><p class="audit-muted" data-format></p></div><button class="button tiny" data-close type="button">Close</button></div>
      <div class="audit-dialog-tools"><button class="button tiny" data-toggle type="button">Show raw</button><button class="button tiny" data-copy type="button">Copy</button><span data-copy-status role="status" class="audit-muted"></span></div>
      <pre class="audit-json" data-json tabindex="0"></pre>
    </dialog>`;
  const $ = sel => root.querySelector(sel);
  let file = null, records = [], header = [], selected = null, current = '', formatted = '', raw = false, generation = 0;
  const message = text => { $('[data-message]').textContent = text; };
  const field = (row, name) => row[header.findIndex(h => h.toLowerCase() === name.toLowerCase())] ?? '';

  function renderTimeline() {
    const term = $('[data-search]').value.trim().toLowerCase();
    const filtered = records.filter(item => [item.operation, item.timestamp, item.service, item.status, item.message, item.auditId, item.journey].some(v => String(v).toLowerCase().includes(term)));
    $('[data-count]').textContent = `${filtered.length} of ${records.length} calls · oldest first`;
    $('[data-timeline]').innerHTML = filtered.length ? filtered.map(item => `
      <button type="button" class="audit-call" data-record="${item.order}" aria-pressed="${item.order === selected}">
        <span class="audit-dot" aria-hidden="true"></span><span class="audit-call-content">
          <span class="audit-call-title">${shown(item.operation || 'Unnamed operation')}</span>
          <span class="audit-call-time">${shown(item.timestamp)}</span>
          <span class="audit-call-meta"><span>${shown(item.service)}</span><span>Status: ${shown(item.status)}</span></span>
          <span class="audit-call-meta">Audit ${shown(item.auditId)} · Journey ${shown(item.journey)}</span>
        </span>
      </button>`).join('') : '<p class="audit-muted audit-empty">No calls match this filter.</p>';
  }
  function renderDetail(item) {
    selected = item.order;
    const extra = header.map((name, i) => [name, item.row[i] ?? '']).filter(([name]) => !PAYLOADS.some(([key]) => key.toLowerCase() === name.toLowerCase()));
    $('[data-detail]').innerHTML = `<div class="audit-detail-head"><span class="audit-eyebrow">API call</span><h2>${shown(item.operation || 'Unnamed operation')}</h2><p>${shown(item.timestamp)} · ${shown(item.service)}</p></div>
      <div class="audit-info">${extra.map(([name, value]) => `<div><span>${escape(name.replaceAll('_', ' '))}</span><strong>${shown(value)}</strong></div>`).join('')}</div>
      <h3>Request &amp; response</h3><div class="audit-payloads">${PAYLOADS.map(([key, label]) => {
        const value = field(item.row, key);
        const snippet = value ? value.slice(0, 150).replace(/\s+/g, ' ') : '';
        return `<button class="audit-payload" type="button" data-payload="${key}" ${value ? '' : 'disabled'}><span>${label}</span><small>${value ? escape(snippet) : 'No data'}</small><b aria-hidden="true">↗</b></button>`;
      }).join('')}</div>`;
    renderTimeline();
  }
  async function load() {
    if (!file) { message('Choose an XLSX file first.'); return; }
    const token = ++generation;
    records = []; header = []; selected = null; $('[data-workspace]').hidden = true;
    if (!/\.xlsx$/i.test(file.name)) { message('Please choose an XLSX file.'); return; }
    if (file.size > 64 * 1024 * 1024) { message('The file exceeds the 64 MB limit.'); return; }
    message('Reading workbook locally…');
    try {
      const parsed = await readAuditWorkbook(await file.arrayBuffer(), { sheet: Number($('[data-sheet]').value), chunkSize: Number($('[data-chunk]').value) });
      if (token !== generation) return;
      header = parsed.header; records = auditTimeline(parsed);
      $('[data-search]').value = '';
      $('[data-workspace]').hidden = false;
      message(`${parsed.sheetName} · ${records.length} calls · ${parsed.continuations} continuation rows reconstructed`);
      if (records.length) renderDetail(records[0]);
      else { $('[data-detail]').innerHTML = '<p class="audit-muted">No calls in this worksheet.</p>'; renderTimeline(); }
    } catch (error) { if (token === generation) message(`Could not read the file: ${error.message}`); }
  }
  $('input[type=file]').addEventListener('change', event => { file = event.target.files[0] ?? null; $('[data-filename]').textContent = file?.name ?? 'No file selected'; if (file) load(); });
  $('[data-reload]').addEventListener('click', load);
  $('[data-search]').addEventListener('input', renderTimeline);
  $('[data-timeline]').addEventListener('click', event => {
    const button = event.target.closest('[data-record]');
    if (button) { const item = records.find(r => r.order === Number(button.dataset.record)); if (item) renderDetail(item); }
  });
  $('[data-detail]').addEventListener('click', event => {
    const button = event.target.closest('[data-payload]');
    const item = records.find(r => r.order === selected);
    if (!button || !item) return;
    current = field(item.row, button.dataset.payload); raw = false;
    const parsed = formatPayload(current);
    const valid = parsed.valid; formatted = parsed.text;
    $('#audit-dialog-title').textContent = `${PAYLOADS.find(([key]) => key === button.dataset.payload)?.[1] ?? 'Payload'} · ${item.operation || item.auditId}`;
    $('[data-format]').textContent = current.startsWith('See json/') ? 'This payload is in a separate JSON file and is not loaded. Open the original export to view it.' : valid ? 'Formatted JSON · original data remains unchanged' : 'Raw text · this field is not valid JSON';
    $('[data-json]').textContent = formatted;
    $('[data-toggle]').hidden = !valid;
    $('[data-toggle]').textContent = 'Show raw';
    $('[data-copy-status]').textContent = '';
    $('[data-dialog]').showModal();
  });
  $('[data-close]').addEventListener('click', () => $('[data-dialog]').close());
  $('[data-toggle]').addEventListener('click', () => { raw = !raw; $('[data-json]').textContent = raw ? current : formatted; $('[data-toggle]').textContent = raw ? 'Show formatted' : 'Show raw'; });
  $('[data-copy]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(raw ? current : formatted); $('[data-copy-status]').textContent = 'Copied'; } catch { $('[data-copy-status]').textContent = 'Copy failed; select the text to copy.'; } });
  return { reset() { generation++; file = null; records = []; header = []; selected = null; $('input[type=file]').value = ''; $('[data-workspace]').hidden = true; $('[data-filename]').textContent = 'No file selected'; message('Select an audit export to get started.'); } };
}
