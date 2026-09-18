// The interface. Everything it renders comes from the registry, so this file
// knows about controls and layout but never about individual tools.

import { TOOLS, TOOL_CATEGORIES, TOOLS_BY_ID, searchTools, dependentOptions } from "./registry.js";
import { formatBytes } from "./lib/bytes.js";

const $ = (selector) => document.querySelector(selector);

const dom = {
  sidebar: $("#sidebar"),
  sidebarNav: $("#sidebarNav"),
  sidebarFilter: $("#sidebarFilter"),
  scrim: $("#scrim"),
  menuButton: $("#menuButton"),
  home: $("#home"),
  catalogue: $("#catalogue"),
  workbench: $("#workbench"),
  toolIcon: $("#toolIcon"),
  toolTitle: $("#toolTitle"),
  toolBlurb: $("#toolBlurb"),
  actionBar: $("#actionBar"),
  fieldBar: $("#fieldBar"),
  panes: $("#panes"),
  inputPane: $("#inputPane"),
  inputLabel: $("#inputLabel"),
  inputArea: $("#inputArea"),
  inputMeter: $("#inputMeter"),
  secondaryPane: $("#secondaryPane"),
  secondaryLabel: $("#secondaryLabel"),
  secondaryArea: $("#secondaryArea"),
  secondaryMeter: $("#secondaryMeter"),
  outputPane: $("#outputPane"),
  outputArea: $("#outputArea"),
  outputMeter: $("#outputMeter"),
  report: $("#report"),
  cards: $("#cards"),
  diff: $("#diff"),
  rawButton: $("#rawButton"),
  preview: $("#preview"),
  previewButton: $("#previewButton"),
  swatches: $("#swatches"),
  status: $("#status"),
  fileButton: $("#fileButton"),
  fileInput: $("#fileInput"),
  fileChip: $("#fileChip"),
  runButton: $("#runButton"),
  dialog: $("#commandDialog"),
  commandInput: $("#commandInput"),
  commandResults: $("#commandResults"),
  toast: $("#toast"),
};

const MAX_FILE_BYTES = 64 * 1024 * 1024;

const state = {
  tool: null,
  action: null,
  options: {},
  file: null,
  download: null,
  previewHtml: "",
  previewOpen: false,
  rows: null,
  cardValues: null,
  diffLines: null,
  rawOpen: false,
  commandIndex: 0,
  commandMatches: [],
  liveTimer: 0,
  running: false,
};

/* ------------------------------------------------------------- utilities */

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function toast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => dom.toast.classList.remove("show"), 2200);
}

function byteSize(value) {
  return formatBytes(new TextEncoder().encode(value).length);
}

const isApple = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || "");

/* --------------------------------------------------------------- sidebar */

function renderSidebar(filter = "") {
  const matches = filter ? new Set(searchTools(filter).map((tool) => tool.id)) : null;
  const open = new Set([...dom.sidebarNav.querySelectorAll('.nav-group[data-open="true"]')].map((group) => group.dataset.category));
  const fragments = [];

  for (const category of TOOL_CATEGORIES) {
    const tools = TOOLS.filter((tool) => tool.category === category && (!matches || matches.has(tool.id)));
    if (!tools.length) continue;
    const expanded = filter ? true : open.size ? open.has(category) : tools.some((tool) => tool.id === state.tool?.id) || category === TOOL_CATEGORIES[0];
    fragments.push(`
      <div class="nav-group" data-category="${escapeHtml(category)}" data-open="${expanded}">
        <button class="nav-group-head" type="button" aria-expanded="${expanded}">
          <span class="caret" aria-hidden="true">▾</span>
          ${escapeHtml(category)}
          <span class="nav-group-count">${tools.length}</span>
        </button>
        <div class="nav-list">
          ${tools.map((tool) => `
            <button class="nav-item" type="button" data-tool="${tool.id}" ${state.tool?.id === tool.id ? 'aria-current="true"' : ""}>
              <span class="nav-icon" aria-hidden="true">${escapeHtml(tool.icon)}</span>
              <span>${escapeHtml(tool.name)}</span>
            </button>`).join("")}
        </div>
      </div>`);
  }
  dom.sidebarNav.innerHTML = fragments.join("") || '<p class="empty">No tools match that filter.</p>';
}

function renderCatalogue(filter = "") {
  const visible = filter ? searchTools(filter) : TOOLS;
  if (!visible.length) {
    dom.catalogue.innerHTML = `<p class="empty">Nothing matches “${escapeHtml(filter)}”. Try a format name such as <strong>yaml</strong>, <strong>base64</strong>, or <strong>cron</strong>.</p>`;
    return;
  }
  const sections = TOOL_CATEGORIES.map((category) => {
    const tools = visible.filter((tool) => tool.category === category);
    if (!tools.length) return "";
    return `
      <section class="category">
        <div class="category-head">
          <h2>${escapeHtml(category)}</h2>
          <span>${tools.length} tool${tools.length === 1 ? "" : "s"}</span>
        </div>
        <div class="tool-grid">
          ${tools.map((tool) => `
            <button class="tool-card" type="button" data-tool="${tool.id}">
              <span class="tool-icon" aria-hidden="true">${escapeHtml(tool.icon)}</span>
              <h3>${escapeHtml(tool.name)}</h3>
              <p>${escapeHtml(tool.blurb)}</p>
              <span class="tool-tags">${(tool.actions.length ? tool.actions : tool.keywords ?? []).slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</span>
            </button>`).join("")}
        </div>
      </section>`;
  });
  dom.catalogue.innerHTML = sections.join("");
}

/* -------------------------------------------------------------- controls */

function visibleFields() {
  if (!state.tool) return [];
  return state.tool.fields.filter((field) => !field.when || field.when.includes(state.action));
}

function renderActions() {
  const tool = state.tool;
  if (!tool.actions.length) {
    dom.actionBar.innerHTML = "";
    dom.actionBar.hidden = true;
    return;
  }
  dom.actionBar.hidden = false;
  dom.actionBar.innerHTML = tool.actions.map((action) => `
    <button class="action-pill" type="button" data-action="${escapeHtml(action)}" aria-pressed="${action === state.action}">
      ${escapeHtml(action.replace(/^\w/, (letter) => letter.toUpperCase()))}
    </button>`).join("");
}

function renderFields() {
  const fields = visibleFields();
  dom.fieldBar.hidden = fields.length === 0;
  dom.fieldBar.innerHTML = fields.map((field) => {
    const value = state.options[field.id];
    const id = `field-${field.id}`;
    if (field.type === "toggle") {
      return `<label class="field field-toggle" for="${id}">
        <input type="checkbox" id="${id}" data-field="${field.id}"${value ? " checked" : ""}>
        <span>${escapeHtml(field.label)}</span>
      </label>`;
    }
    if (field.type === "color") {
      return `<label class="field field-color" for="${id}">
        <input type="color" id="${id}" data-field="${field.id}" value="${escapeHtml(normalizeColor(value))}">
        <span>${escapeHtml(field.label)}</span>
      </label>`;
    }
    if (field.type === "select") {
      const choices = field.dependsOn ? dependentOptions(state.tool, field, state.options) : field.options ?? [];
      return `<label class="field" for="${id}">
        <span>${escapeHtml(field.label)}</span>
        <select id="${id}" data-field="${field.id}">
          ${choices.map((choice) => `<option value="${escapeHtml(choice)}"${String(choice) === String(value) ? " selected" : ""}>${escapeHtml(field.labels?.[choice] ?? choice)}</option>`).join("")}
        </select>
      </label>`;
    }
    const numeric = field.type === "number";
    return `<label class="field" for="${id}">
      <span>${escapeHtml(field.label)}</span>
      <input type="${numeric ? "number" : "text"}" id="${id}" data-field="${field.id}" value="${escapeHtml(value ?? "")}"
        ${field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : ""}
        ${field.min !== undefined ? `min="${field.min}"` : ""}
        ${field.max !== undefined ? `max="${field.max}"` : ""}
        ${field.step !== undefined ? `step="${field.step}"` : ""}>
      ${field.help ? `<small>${escapeHtml(field.help)}</small>` : ""}
    </label>`;
  }).join("");
}

function normalizeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value)) ? value : "#000000";
}

function defaultOptions(tool) {
  const options = {};
  for (const field of tool.fields) {
    let value = field.value;
    if (field.dependsOn) {
      const choices = dependentOptions(tool, field, options);
      if (!choices.includes(value)) value = choices[0];
    }
    options[field.id] = value;
  }
  return options;
}

/* ------------------------------------------------------------ open a tool */

function sampleFor(tool, action) {
  return tool.input.samples?.[action] ?? tool.input.sample ?? "";
}

function inputHidden(tool, action) {
  if (tool.input.hidden) return true;
  return Boolean(tool.input.hiddenWhen?.includes(action));
}

function openTool(id, { push = true, keepInput = false } = {}) {
  const tool = TOOLS_BY_ID.get(id);
  if (!tool) { showHome(); return; }

  const sameTool = state.tool?.id === id;
  state.tool = tool;
  if (!sameTool) {
    state.action = tool.actions[0] ?? null;
    state.options = defaultOptions(tool);
    state.file = null;
  }
  state.download = null;
  state.previewHtml = "";
  state.previewOpen = false;

  dom.home.hidden = true;
  dom.workbench.hidden = false;
  dom.toolIcon.textContent = tool.icon;
  dom.toolTitle.textContent = tool.name;
  dom.toolBlurb.textContent = tool.blurb;

  renderActions();
  renderFields();

  dom.inputLabel.textContent = tool.input.label ?? "Input";
  dom.inputArea.placeholder = tool.input.placeholder ?? "Paste or type here…";
  if (!keepInput) dom.inputArea.value = sampleFor(tool, state.action);
  dom.inputPane.hidden = inputHidden(tool, state.action);

  dom.secondaryPane.hidden = !tool.secondary;
  if (tool.secondary) {
    dom.secondaryLabel.textContent = tool.secondary.label ?? "Compare with";
    if (!keepInput) dom.secondaryArea.value = tool.secondary.sample ?? "";
  }

  dom.fileButton.hidden = !tool.input.accept;
  if (tool.input.accept) dom.fileInput.accept = tool.input.accept;
  dom.fileChip.hidden = !state.file;
  if (state.file) dom.fileChip.textContent = `${state.file.name} · ${formatBytes(state.file.size)} · held in memory only`;

  dom.outputArea.value = "";
  state.rawOpen = false;
  clearResultViews();
  dom.preview.hidden = true;
  dom.previewButton.hidden = true;
  dom.previewButton.setAttribute("aria-pressed", "false");
  dom.swatches.hidden = true;
  dom.status.hidden = true;
  dom.runButton.firstChild.nodeValue = runLabel();

  layoutPanes();
  updateMeters();
  renderSidebar(dom.sidebarFilter.value);
  closeSidebar();

  if (push && location.hash !== `#/${id}`) history.pushState({ tool: id }, "", `#/${id}`);
  document.title = `${tool.name} — Converter`;
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

  if (shouldAutoRun()) run({ silent: true });
}

function runLabel() {
  if (!state.tool) return "Run";
  if (!state.action) return "Run";
  return state.action.replace(/^\w/, (letter) => letter.toUpperCase());
}

function layoutPanes() {
  const panes = 1 + (dom.inputPane.hidden ? 0 : 1) + (dom.secondaryPane.hidden ? 0 : 1);
  dom.panes.dataset.panes = String(panes);
  // With no input to show, every layout collapses to a full-width result.
  dom.panes.dataset.layout = dom.inputPane.hidden ? "stack" : state.tool?.layout ?? "split";
}

function shouldAutoRun() {
  return Boolean(state.tool?.live) || inputHidden(state.tool, state.action);
}

function showHome({ push = true } = {}) {
  state.tool = null;
  dom.workbench.hidden = true;
  dom.home.hidden = false;
  document.title = "Converter — 92 developer tools, one workspace";
  renderSidebar(dom.sidebarFilter.value);
  if (push && location.hash !== "#/") history.pushState({}, "", "#/");
}

/* ------------------------------------------------------------------- run */

async function run({ silent = false } = {}) {
  const tool = state.tool;
  if (!tool || state.running) return;
  state.running = true;
  const started = performance.now();
  try {
    const result = await tool.run({
      input: dom.inputArea.value,
      secondary: dom.secondaryArea.value,
      action: state.action,
      options: state.options,
      file: state.file,
      tool,
    });
    const payload = typeof result === "string" ? { text: result } : result ?? { text: "" };
    dom.outputArea.value = payload.text ?? "";
    state.download = payload.download ?? null;

    state.previewHtml = payload.html ?? (tool.output.preview ? payload.text ?? "" : "");
    dom.previewButton.hidden = !state.previewHtml;
    if (state.previewHtml && (payload.html || state.previewOpen)) setPreview(true);
    else setPreview(false);

    renderResult(payload);

    if (payload.swatches?.length) {
      dom.swatches.hidden = false;
      dom.swatches.innerHTML = payload.swatches.slice(0, 24).map((value) => `<span class="swatch"><i style="background:${escapeHtml(value)}"></i>${escapeHtml(value)}</span>`).join("");
    } else dom.swatches.hidden = true;

    const elapsed = performance.now() - started;
    const note = payload.note ? ` · ${payload.note}` : "";
    setStatus(`Completed locally in ${elapsed < 1 ? elapsed.toFixed(2) : elapsed.toFixed(1)} ms${note}`, "good");
  } catch (error) {
    dom.outputArea.value = "";
    dom.swatches.hidden = true;
    setPreview(false);
    dom.previewButton.hidden = true;
    clearResultViews();
    // An automatic run over an empty box should not nag; a deliberate one should.
    if (silent && !dom.inputArea.value.trim() && !inputHidden(tool, state.action)) {
      dom.status.hidden = true;
      return;
    }
    const message = tool.describeError ? tool.describeError(error, dom.inputArea.value) : error.message;
    setStatus(message || "Something went wrong.", "bad");
  } finally {
    state.running = false;
    updateMeters();
  }
}

function setStatus(message, tone) {
  dom.status.hidden = false;
  dom.status.textContent = message;
  dom.status.dataset.tone = tone;
}

/** Picks the richest view the result supports: rows, cards, or plain text. */
function renderResult(payload) {
  state.rows = payload.rows ?? null;
  state.cardValues = cardValuesFor(payload);
  state.diffLines = diffLinesFor(payload);

  if (state.diffLines) {
    dom.diff.innerHTML = state.diffLines.map(({ kind, text }) => `<div class="diff-line" data-kind="${kind}">${escapeHtml(text) || "&nbsp;"}</div>`).join("");
  }
  if (state.rows) {
    dom.report.innerHTML = state.rows.map(renderReportRow).join("");
    dom.cards.hidden = true;
  } else if (state.cardValues) {
    dom.cards.innerHTML = state.cardValues.map((value, index) => `
      <button class="value-card" type="button" data-value="${escapeHtml(value)}">
        <span class="index" aria-hidden="true">${index + 1}</span>
        <code>${escapeHtml(value)}</code>
        <span class="hint">Copy</span>
      </button>`).join("");
    dom.report.hidden = true;
  }

  const structured = Boolean(state.rows || state.cardValues || state.diffLines);
  dom.rawButton.hidden = !structured;
  dom.rawButton.setAttribute("aria-pressed", String(state.rawOpen));
  applyResultView();
}

/** Splits a unified-style listing so additions and removals can be coloured. */
function diffLinesFor(payload) {
  if (!state.tool?.output.diff || payload.rows) return null;
  const text = payload.text ?? "";
  if (!text.trim() || text.split("\n").length > 4000) return null;
  return text.split("\n").map((line) => {
    if (/^\+ /.test(line)) return { kind: "add", text: line };
    if (/^- /.test(line)) return { kind: "remove", text: line };
    if (/^~ /.test(line)) return { kind: "change", text: line };
    if (/^ {4}[+-] /.test(line)) return { kind: line.trimStart().startsWith("+") ? "add" : "remove", text: line };
    return { kind: "same", text: line };
  });
}

function cardValuesFor(payload) {
  if (!state.tool?.cards || payload.rows) return null;
  const lines = (payload.text ?? "").split("\n").filter((line) => line.trim());
  if (!lines.length || lines.length > 200) return null;
  return lines.every((line) => line.length <= 96) ? lines : null;
}

function renderReportRow(row) {
  if (row.type === "blank") return "";
  if (row.type === "heading") return `<div class="report-heading">${escapeHtml(row.label)}</div>`;
  const tone = row.tone ? ` data-tone="${escapeHtml(row.tone)}"` : "";
  return `<div class="report-row"${tone}>
    <dt>${escapeHtml(row.label)}</dt>
    <dd><span>${escapeHtml(row.value)}</span><button class="copy-value" type="button" data-value="${escapeHtml(row.value)}">Copy</button></dd>
  </div>`;
}

function clearResultViews() {
  state.rows = null;
  state.cardValues = null;
  state.diffLines = null;
  dom.report.hidden = true;
  dom.report.innerHTML = "";
  dom.cards.hidden = true;
  dom.cards.innerHTML = "";
  dom.diff.hidden = true;
  dom.diff.innerHTML = "";
  dom.rawButton.hidden = true;
  dom.outputArea.hidden = false;
}

/** Shows exactly one of: preview, report, cards, or the raw text box. */
function applyResultView() {
  const plain = state.rawOpen;
  const previewReady = Boolean(state.previewHtml) && state.previewOpen;
  // A visual tool can show its picture and its numbers at the same time.
  const paired = !plain && previewReady && Boolean(state.rows) && state.tool?.layout === "canvas";
  const showPreview = !plain && previewReady;
  const showReport = !plain && Boolean(state.rows) && (paired || !showPreview);
  const showCards = !plain && !showPreview && !showReport && Boolean(state.cardValues);
  const showDiff = !plain && !showPreview && !showReport && !showCards && Boolean(state.diffLines);
  dom.preview.hidden = !showPreview;
  dom.report.hidden = !showReport;
  dom.cards.hidden = !showCards;
  dom.diff.hidden = !showDiff;
  dom.outputArea.hidden = showPreview || showReport || showCards || showDiff;
  dom.outputPane.dataset.view = paired ? "paired" : "single";
}

function setPreview(open) {
  state.previewOpen = open && Boolean(state.previewHtml);
  dom.previewButton.setAttribute("aria-pressed", String(state.previewOpen));
  if (state.previewOpen) dom.preview.innerHTML = sanitize(state.previewHtml);
  applyResultView();
}

/** Renders generated markup for preview with scripts and event handlers removed. */
function sanitize(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const node of template.content.querySelectorAll("script, iframe, object, embed, link, meta, base")) node.remove();
  for (const node of template.content.querySelectorAll("*")) {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on")) node.removeAttribute(attribute.name);
      else if ((name === "href" || name === "src" || name === "xlink:href") && /^(javascript|vbscript):/i.test(value)) node.removeAttribute(attribute.name);
    }
  }
  return template.innerHTML;
}

function updateMeters() {
  dom.inputMeter.textContent = byteSize(dom.inputArea.value);
  dom.secondaryMeter.textContent = byteSize(dom.secondaryArea.value);
  dom.outputMeter.textContent = byteSize(dom.outputArea.value);
}

function scheduleLive() {
  if (!state.tool?.live) return;
  clearTimeout(state.liveTimer);
  state.liveTimer = setTimeout(() => run({ silent: true }), 180);
}

/* ------------------------------------------------------------- palette */

function renderCommandResults(query = "") {
  state.commandMatches = (query ? searchTools(query) : TOOLS).slice(0, 60);
  state.commandIndex = 0;
  if (!state.commandMatches.length) {
    dom.commandResults.innerHTML = `<p class="empty">No tool matches “${escapeHtml(query)}”.</p>`;
    return;
  }
  dom.commandResults.innerHTML = state.commandMatches.map((tool, index) => `
    <button class="command-result" type="button" role="option" data-tool="${tool.id}" data-active="${index === 0}">
      <span class="tool-icon" aria-hidden="true">${escapeHtml(tool.icon)}</span>
      <span>
        <strong>${escapeHtml(tool.name)}</strong>
        <small>${escapeHtml(tool.category)} · ${escapeHtml(tool.blurb)}</small>
      </span>
    </button>`).join("");
}

function moveCommandSelection(delta) {
  const items = [...dom.commandResults.querySelectorAll(".command-result")];
  if (!items.length) return;
  items[state.commandIndex]?.setAttribute("data-active", "false");
  state.commandIndex = (state.commandIndex + delta + items.length) % items.length;
  const active = items[state.commandIndex];
  active.setAttribute("data-active", "true");
  active.scrollIntoView({ block: "nearest" });
}

function openPalette() {
  renderCommandResults();
  dom.commandInput.value = "";
  if (!dom.dialog.open) dom.dialog.showModal();
  dom.commandInput.focus();
}

/* ------------------------------------------------------------- sidebar UI */

function openSidebar() {
  dom.sidebar.dataset.open = "true";
  dom.scrim.hidden = false;
  dom.menuButton.setAttribute("aria-expanded", "true");
}

function closeSidebar() {
  dom.sidebar.dataset.open = "false";
  dom.scrim.hidden = true;
  dom.menuButton.setAttribute("aria-expanded", "false");
}

/* ----------------------------------------------------------------- files */

async function acceptFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    setStatus(`That file is ${formatBytes(file.size)}. Files above ${formatBytes(MAX_FILE_BYTES)} are not opened, to keep this tab responsive.`, "bad");
    return;
  }
  const buffer = await file.arrayBuffer();
  state.file = { name: file.name, size: file.size, type: file.type, buffer, blob: file };
  dom.fileChip.hidden = false;
  dom.fileChip.textContent = `${file.name} · ${formatBytes(file.size)} · held in memory only`;
  if (!inputHidden(state.tool, state.action) && /\.(txt|csv|tsv|json|ya?ml|toml|xml|md|markdown|html?|css|js|sql|log|svg|ndjson)$/i.test(file.name)) {
    dom.inputArea.value = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  }
  updateMeters();
  toast(`${file.name} opened locally`);
  await run({ silent: true });
}

/* ----------------------------------------------------------------- wiring */

document.addEventListener("click", (event) => {
  const toolTarget = event.target.closest("[data-tool]");
  if (toolTarget) {
    if (dom.dialog.open) dom.dialog.close();
    openTool(toolTarget.dataset.tool);
    return;
  }
  const groupHead = event.target.closest(".nav-group-head");
  if (groupHead) {
    const group = groupHead.closest(".nav-group");
    const open = group.dataset.open !== "true";
    group.dataset.open = String(open);
    groupHead.setAttribute("aria-expanded", String(open));
    return;
  }
  const actionPill = event.target.closest(".action-pill");
  if (actionPill) {
    const next = actionPill.dataset.action;
    if (next === state.action) return;
    const previousSample = sampleFor(state.tool, state.action);
    state.action = next;
    renderActions();
    renderFields();
    dom.inputPane.hidden = inputHidden(state.tool, state.action);
    layoutPanes();
    const nextSample = sampleFor(state.tool, state.action);
    if (nextSample && dom.inputArea.value.trim() === previousSample.trim()) dom.inputArea.value = nextSample;
    dom.runButton.firstChild.nodeValue = runLabel();
    updateMeters();
    if (shouldAutoRun()) run({ silent: true });
  }
});

dom.fieldBar.addEventListener("input", (event) => {
  const control = event.target.closest("[data-field]");
  if (!control) return;
  const field = state.tool.fields.find((entry) => entry.id === control.dataset.field);
  if (!field) return;
  const value = field.type === "toggle" ? control.checked : field.type === "number" ? Number(control.value) : control.value;
  state.options[field.id] = value;
  if (field.binds === "input") dom.inputArea.value = value;
  if (state.tool.fields.some((entry) => entry.dependsOn === field.id)) {
    for (const dependent of state.tool.fields.filter((entry) => entry.dependsOn === field.id)) {
      const choices = dependentOptions(state.tool, dependent, state.options);
      if (!choices.includes(state.options[dependent.id])) state.options[dependent.id] = choices[0];
    }
    renderFields();
  }
  updateMeters();
  if (state.tool.live) scheduleLive();
});

dom.inputArea.addEventListener("input", () => {
  const picker = state.tool?.fields.find((field) => field.binds === "input");
  if (picker) {
    const value = dom.inputArea.value.trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) {
      state.options[picker.id] = value;
      const control = dom.fieldBar.querySelector(`[data-field="${picker.id}"]`);
      if (control) control.value = value;
    }
  }
  updateMeters();
  scheduleLive();
});

dom.secondaryArea.addEventListener("input", () => { updateMeters(); scheduleLive(); });

// The key-code tool identifies whatever you press. Tab and Escape are left
// alone so the field never becomes a keyboard trap.
const PASS_THROUGH_KEYS = new Set(["Tab", "Escape"]);

dom.inputArea.addEventListener("keydown", (event) => {
  if (!state.tool?.captureKeys) return;
  if (PASS_THROUGH_KEYS.has(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  dom.inputArea.value = String(event.keyCode);
  updateMeters();
  run({ silent: true });
});

dom.runButton.addEventListener("click", () => run());
$("#resetButton").addEventListener("click", () => {
  state.file = null;
  dom.fileInput.value = "";
  openTool(state.tool.id, { push: false });
  toast("Tool reset");
});
$("#closeTool").addEventListener("click", () => showHome());
$("#clearButton").addEventListener("click", () => {
  dom.inputArea.value = "";
  dom.inputArea.focus();
  updateMeters();
  scheduleLive();
});
$("#pasteButton").addEventListener("click", async () => {
  try {
    const value = await navigator.clipboard.readText();
    if (!value) { toast("The clipboard is empty"); return; }
    dom.inputArea.value = value;
    updateMeters();
    await run({ silent: true });
    toast("Pasted from the clipboard");
  } catch {
    toast("This browser blocked clipboard reading — paste with the keyboard instead");
    dom.inputArea.focus();
  }
});
$("#copyButton").addEventListener("click", async () => {
  if (!dom.outputArea.value) { toast("There is nothing to copy yet"); return; }
  try {
    await navigator.clipboard.writeText(dom.outputArea.value);
    toast("Output copied");
  } catch {
    dom.outputArea.select();
    document.execCommand?.("copy");
    toast("Output copied");
  }
});
$("#swapButton").addEventListener("click", () => {
  if (!dom.outputArea.value) { toast("Run the tool first, then swap"); return; }
  dom.inputArea.value = dom.outputArea.value;
  dom.outputArea.value = "";
  updateMeters();
  toast("Output moved into the input");
  if (state.tool?.live) run({ silent: true });
});
$("#downloadButton").addEventListener("click", () => {
  const output = dom.outputArea.value;
  if (!state.download && !output) { toast("There is nothing to download yet"); return; }
  const blob = state.download?.blob ?? new Blob([output], { type: "text/plain;charset=utf-8" });
  const name = state.download?.name ?? state.tool?.output.filename ?? `converter-${state.tool?.id ?? "output"}.txt`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Saving ${name}`);
});
dom.previewButton.addEventListener("click", () => setPreview(!state.previewOpen));
dom.rawButton.addEventListener("click", () => {
  state.rawOpen = !state.rawOpen;
  dom.rawButton.setAttribute("aria-pressed", String(state.rawOpen));
  applyResultView();
});

dom.outputPane.addEventListener("click", async (event) => {
  const trigger = event.target.closest("[data-value]");
  if (!trigger) return;
  await copyValue(trigger.dataset.value);
  if (trigger.classList.contains("value-card")) {
    trigger.classList.add("copied");
    trigger.querySelector(".hint").textContent = "Copied";
    setTimeout(() => {
      trigger.classList.remove("copied");
      const hint = trigger.querySelector(".hint");
      if (hint) hint.textContent = "Copy";
    }, 1400);
  }
});

async function copyValue(value) {
  try {
    await navigator.clipboard.writeText(value);
    toast("Copied");
  } catch {
    toast("This browser blocked copying — select the value instead");
  }
}

dom.fileInput.addEventListener("change", (event) => acceptFile(event.target.files[0]));

for (const zone of [dom.inputArea, dom.inputPane]) {
  zone.addEventListener("dragover", (event) => { event.preventDefault(); });
  zone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    event.preventDefault();
    acceptFile(file);
  });
}

dom.sidebarFilter.addEventListener("input", (event) => {
  renderSidebar(event.target.value);
  if (!state.tool) renderCatalogue(event.target.value);
});

dom.menuButton.addEventListener("click", () => (dom.sidebar.dataset.open === "true" ? closeSidebar() : openSidebar()));
dom.scrim.addEventListener("click", closeSidebar);

$("#commandButton").addEventListener("click", openPalette);
$("#heroSearch").addEventListener("click", openPalette);
$("#heroBrowse").addEventListener("click", () => dom.catalogue.scrollIntoView({ behavior: "smooth", block: "start" }));

dom.commandInput.addEventListener("input", (event) => renderCommandResults(event.target.value));
dom.commandInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") { event.preventDefault(); moveCommandSelection(1); }
  else if (event.key === "ArrowUp") { event.preventDefault(); moveCommandSelection(-1); }
  else if (event.key === "Enter") {
    event.preventDefault();
    const chosen = state.commandMatches[state.commandIndex];
    if (chosen) { dom.dialog.close(); openTool(chosen.id); }
  }
});

document.addEventListener("keydown", (event) => {
  const modifier = isApple ? event.metaKey : event.ctrlKey;
  if (modifier && event.key.toLowerCase() === "k") { event.preventDefault(); openPalette(); return; }
  if (modifier && event.key === "Enter" && state.tool) { event.preventDefault(); run(); return; }
  if (event.key === "Escape") {
    if (dom.dialog.open) dom.dialog.close();
    else if (dom.sidebar.dataset.open === "true") closeSidebar();
  }
  if (event.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "")) {
    event.preventDefault();
    openPalette();
  }
});

$("#themeButton").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(next);
  localStorage.setItem("converter-theme", next);
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#themeIcon").textContent = theme === "light" ? "◐" : "◑";
  $("#themeButton").setAttribute("aria-label", `Switch to the ${theme === "light" ? "dark" : "light"} theme`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f6f7fb" : "#0e0f14");
}

window.addEventListener("popstate", () => routeFromHash({ push: false }));

function routeFromHash({ push = true } = {}) {
  const id = location.hash.replace(/^#\/?/, "");
  if (id && TOOLS_BY_ID.has(id)) openTool(id, { push });
  else showHome({ push: push && location.hash !== "" });
}

/* ------------------------------------------------------------------ boot */

function boot() {
  const stored = localStorage.getItem("converter-theme");
  applyTheme(stored === "light" || stored === "dark" ? stored : (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"));

  const shortcut = isApple ? "⌘ K" : "Ctrl K";
  $("#commandHint").textContent = shortcut;
  $("#heroHint").textContent = shortcut;

  const count = String(TOOLS.length);
  document.querySelector(".command-trigger-label").textContent = `Search ${count} tools…`;
  document.querySelector(".hero-facts strong").textContent = count;
  document.querySelector(".hero-lead").textContent = `${count} working tools for the formats you touch every day — data, text, encoding, crypto, colour, networking, dates, and Office documents. Every byte is processed in this tab.`;

  renderSidebar();
  renderCatalogue();
  routeFromHash({ push: false });
}

boot();
