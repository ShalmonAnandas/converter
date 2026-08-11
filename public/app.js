import { formatBytes, jsonTransform, jsonError, encodeBase64, decodeBase64, normalizeBase64, validateBase64, parseDataUri, convertTimestamp } from "./core.js";
import { parseCsv, detectDelimiter, inspectJwt, generateHash, formatXml, minifyXml } from "./tools.js";
import { csvRowsToXlsx, xlsxToCsv, markdownToDocx, docxToMarkdown } from "./office.js";

const tools = [
  { category:"STRUCTURED DATA", id:"json", icon:"{ }", name:"JSON Formatter", description:"Format, validate, minify, and sort JSON with precise diagnostics.", available:true },
  { category:"STRUCTURED DATA", id:"xml", icon:"</>", name:"XML Toolkit", description:"Format, minify, and validate XML with external entities disabled.", available:true },
  { category:"BASE64 & BINARY", id:"base64", icon:"64", name:"Base64 Studio", description:"Encode, decode, normalize, and validate text or binary payloads.", available:true },
  { category:"FILES", id:"spreadsheet", icon:"▦", name:"Spreadsheet", description:"Convert CSV to standards-compliant XLSX workbooks and XLSX sheets back to CSV.", available:true },
  { category:"DOCUMENTS", id:"documents", icon:"▤", name:"Document Converter", description:"Convert Markdown to Word DOCX and extract clean Markdown from DOCX files.", available:true },
  { category:"ENCODING", id:"url", icon:"%", name:"URL Encoder", description:"Percent-encode or decode URL components without sending data.", available:true },
  { category:"INSPECTORS", id:"timestamp", icon:"◷", name:"Timestamp", description:"Convert Unix seconds or milliseconds into precise ISO dates.", available:true },
  { category:"INSPECTORS", id:"jwt", icon:"•••", name:"JWT Inspector", description:"Inspect token headers, claims, and timestamps without implying verification.", available:true },
  { category:"GENERATORS", id:"hash", icon:"#", name:"Hash Generator", description:"Create SHA-256 and SHA-512 digests with Web Crypto.", available:true }
];
const configurations = {
  json:{ description:"Format, minify, validate, and recursively sort JSON.", sample:'{"project":"converter","private":true,"features":["format","validate","sort"]}', actions:["format","minify","sort"], actionLabel:"Format JSON" },
  base64:{ description:"Byte-correct UTF-8 Base64, Base64URL, validation, normalization, and Data URI inspection.", sample:"Private by default. Fast by design.", actions:["encode","decode","validate","normalize","parse data uri"], actionLabel:"Encode Base64" },
  url:{ description:"Encode and decode URL components locally in your browser.", sample:"https://example.com/search?q=local tools&sort=new", actions:["encode","decode"], actionLabel:"Encode URL" },
  timestamp:{ description:"Convert Unix timestamps into ISO 8601 UTC values.", sample:String(Math.floor(Date.now()/1000)), actions:["convert"], actionLabel:"Convert timestamp" }
  ,xml:{ description:"Pretty-print, minify, or validate well-formed XML. DOCTYPE is rejected for safety.", sample:'<catalog><item id="1"><name>Local tools</name></item></catalog>', actions:["format","minify","validate"], actionLabel:"Format XML" }
  ,spreadsheet:{ description:"Create a real XLSX workbook from CSV or extract the first XLSX worksheet as CSV.", sample:'name,role,active\nAda,Engineer,true\nLin,QA,true', actions:["csv to xlsx","xlsx to csv"], actionLabel:"Convert spreadsheet" }
  ,documents:{ description:"Generate a Word-compatible DOCX or extract headings and paragraphs from DOCX as Markdown.", sample:'# Release notes\n\n**Converter** keeps your content local.\n\n- Private\n- Fast\n- Downloadable', actions:["markdown to docx","docx to markdown"], actionLabel:"Convert document" }
  ,jwt:{ description:"Decode JWT header and payload locally. Decoding never verifies authenticity.", sample:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSIsImlhdCI6MTUxNjIzOTAyMn0.signature", actions:["inspect"], actionLabel:"Inspect JWT" }
  ,hash:{ description:"Generate cryptographic SHA-256 or SHA-512 hashes through Web Crypto.", sample:"Hash this text locally", actions:["generate"], actionLabel:"Generate hash" }
};
const $ = (selector) => document.querySelector(selector);
const nav = $("#toolNav"), grid = $("#toolGrid"), dialog = $("#commandDialog");
let activeTool = "json";
let activeFile = null;
let pendingDownload = null;

function renderNav(){ let category=""; nav.innerHTML=tools.map(tool=>{const heading=tool.category!==category?`<div class="nav-title">${(category=tool.category)}</div>`:"";return `${heading}<button class="nav-item" data-tool="${tool.id}"><span class="nav-icon">${tool.icon}</span>${tool.name}${tool.available?"":'<span class="soon">SOON</span>'}</button>`}).join(""); }
function renderGrid(filter=""){ const matches=tools.filter(t=>(t.name+t.description+t.category).toLowerCase().includes(filter.toLowerCase())); grid.innerHTML=matches.map(t=>`<button class="tool-card ${t.available?"available":""}" data-tool="${t.id}"><span class="tool-card-icon">${t.icon}</span><span class="card-arrow">↗</span><h3>${t.name}</h3><p>${t.description}</p><span class="card-tag">${t.available?"READY":"COMING SOON"}</span></button>`).join("") || `<p>No tools match “${filter}”.</p>`; }
function openTool(id){ const tool=tools.find(t=>t.id===id); if(!tool.available){ toast(`${tool.name} is on the delivery roadmap`); return; } activeTool=id; activeFile=null; pendingDownload=null; const config=configurations[id]; $("#workbenchIcon").textContent=tool.icon;$("#workbenchTitle").textContent=tool.name;$("#workbenchDescription").textContent=config.description;$("#inputEditor").value=config.sample;$("#outputEditor").value="";$("#diagnostic").classList.add("hidden"); renderOptions(config); updateSizes(); $("#workbench").classList.remove("hidden"); document.querySelectorAll(".nav-item").forEach(el=>el.classList.toggle("active",el.dataset.tool===id)); $("#workbench").scrollIntoView({behavior:"smooth",block:"start"}); }
function renderOptions(config) {
  const accepts = activeTool === "spreadsheet" ? ".csv,.xlsx,text/csv" : activeTool === "documents" ? ".md,.markdown,.docx,text/markdown,text/plain" : activeTool === "xml" ? ".xml,text/xml,application/xml" : "";
  const actionButtons = config.actions.map((action, index) => `<button type="button" class="action-choice${index === 0 ? " selected" : ""}" data-action="${action}">${action.replace(/\b\w/g, letter => letter.toUpperCase())}</button>`).join("");
  $("#options").innerHTML = `<div class="action-group" role="group" aria-label="Conversion action"><input id="actionSelect" type="hidden" value="${config.actions[0]}">${actionButtons}</div>`
    + (activeTool === "json" ? `<label class="option-group">INDENT <select id="indentSelect"><option value="2">2 spaces</option><option value="4">4 spaces</option><option value="tab">Tab</option></select></label>` : activeTool === "base64" ? `<label class="option-group">VARIANT <select id="variantSelect"><option value="standard">Standard</option><option value="url">Base64URL</option></select></label>` : activeTool === "timestamp" ? `<label class="option-group">UNIT <select id="unitSelect"><option value="seconds">Seconds</option><option value="milliseconds">Milliseconds</option></select></label>` : activeTool === "hash" ? `<label class="option-group">ALGORITHM <select id="algorithmSelect"><option>SHA-256</option><option>SHA-512</option></select></label>` : "")
    + (accepts ? `<label class="file-button">Open file<input id="fileInput" type="file" accept="${accepts}"></label>` : "");
  document.querySelectorAll(".action-choice").forEach(button => button.addEventListener("click", () => {
    $("#actionSelect").value = button.dataset.action;
    document.querySelectorAll(".action-choice").forEach(choice => choice.classList.toggle("selected", choice === button));
    $("#runButton").firstChild.textContent = `${button.textContent} `;
  }));
  $("#fileInput")?.addEventListener("change", async event => {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 25 * 1024 * 1024) return showDiagnostic("Files larger than 25 MB are not opened to protect browser memory.", false);
    activeFile = { name: file.name, buffer: await file.arrayBuffer() };
    if (!/\.(xlsx|docx)$/i.test(file.name)) $("#inputEditor").value = new TextDecoder().decode(activeFile.buffer);
    else $("#inputEditor").value = `${file.name} loaded (${formatBytes(file.size)}). Choose the matching conversion action.`;
    updateSizes(); toast(`${file.name} loaded locally`);
  });
  $("#runButton").firstChild.textContent = `${config.actionLabel} `;
}
async function run() {
  const input = $("#inputEditor").value, action = $("#actionSelect").value, start = performance.now();
  try {
    let output = "", detail = ""; pendingDownload = null;
    if (activeTool === "json") output = jsonTransform(input, action, $("#indentSelect").value);
    if (activeTool === "base64") { const urlSafe = $("#variantSelect").value === "url"; if (action === "encode") output = encodeBase64(input, urlSafe); if (action === "decode") output = decodeBase64(input); if (action === "normalize") output = normalizeBase64(input, urlSafe); if (action === "validate") output = JSON.stringify(validateBase64(input), null, 2); if (action === "parse data uri") output = JSON.stringify(parseDataUri(input), null, 2); }
    if (activeTool === "url") output = action === "encode" ? encodeURIComponent(input) : decodeURIComponent(input);
    if (activeTool === "timestamp") output = convertTimestamp(input, $("#unitSelect").value);
    if (activeTool === "xml") { if (action === "minify") output = minifyXml(input); else { const formatted = formatXml(input); output = action === "validate" ? `Valid XML document\nRoot element: ${new DOMParser().parseFromString(input, "application/xml").documentElement.nodeName}` : formatted; } }
    if (activeTool === "spreadsheet") {
      if (action === "csv to xlsx") { const source = activeFile && /\.csv$/i.test(activeFile.name) ? new TextDecoder().decode(activeFile.buffer) : input; const rows = parseCsv(source, detectDelimiter(source)); const bytes = csvRowsToXlsx(rows); pendingDownload = { blob: new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name: "converter.xlsx" }; output = `XLSX workbook ready\n${rows.length} rows × ${Math.max(0, ...rows.map(row => row.length))} columns\nUse Download to save the workbook.`; }
      else { if (!activeFile || !/\.xlsx$/i.test(activeFile.name)) throw new Error("Open an .xlsx file before converting to CSV"); output = await xlsxToCsv(activeFile.buffer); pendingDownload = { blob: new Blob([output], { type: "text/csv;charset=utf-8" }), name: activeFile.name.replace(/\.xlsx$/i, ".csv") }; }
    }
    if (activeTool === "documents") {
      if (action === "markdown to docx") { const source = activeFile && /\.(md|markdown)$/i.test(activeFile.name) ? new TextDecoder().decode(activeFile.buffer) : input; const bytes = markdownToDocx(source); pendingDownload = { blob: new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), name: "converter.docx" }; output = "Word-compatible DOCX ready. Use Download to save the document."; }
      else { if (!activeFile || !/\.docx$/i.test(activeFile.name)) throw new Error("Open a .docx file before converting to Markdown"); output = await docxToMarkdown(activeFile.buffer); pendingDownload = { blob: new Blob([output], { type: "text/markdown;charset=utf-8" }), name: activeFile.name.replace(/\.docx$/i, ".md") }; }
    }
    if (activeTool === "jwt") output = JSON.stringify(inspectJwt(input), null, 2);
    if (activeTool === "hash") output = await generateHash(input, $("#algorithmSelect").value);
    $("#outputEditor").value = output; showDiagnostic(`✓ Completed locally in ${(performance.now() - start).toFixed(1)} ms${detail}`, true);
  } catch (error) { $("#outputEditor").value = ""; showDiagnostic(activeTool === "json" ? jsonError(error, input) : error.message, false); }
  updateSizes();
}
function showDiagnostic(message,success){ const el=$("#diagnostic");el.textContent=message;el.classList.remove("hidden");el.classList.toggle("success",success); }
function updateSizes(){ $("#inputSize").textContent=formatBytes(new Blob([$("#inputEditor").value]).size);$("#outputSize").textContent=formatBytes(new Blob([$("#outputEditor").value]).size); }
function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),1800)}
function renderCommands(filter=""){const matches=tools.filter(t=>t.name.toLowerCase().includes(filter.toLowerCase()));$("#commandResults").innerHTML=matches.map(t=>`<button class="command-result" data-tool="${t.id}"><span class="tool-card-icon">${t.icon}</span><span><strong>${t.name}</strong><small>${t.category} · ${t.available?"Local processing":"Coming soon"}</small></span></button>`).join("");}
function openCommands(){renderCommands();dialog.showModal();$("#commandInput").value="";$("#commandInput").focus()}

renderNav();renderGrid();
document.addEventListener("click",e=>{const target=e.target.closest("[data-tool]");if(target){if(dialog.open) dialog.close();openTool(target.dataset.tool)}});
$("#filterInput").addEventListener("input",e=>renderGrid(e.target.value));$("#commandInput").addEventListener("input",e=>renderCommands(e.target.value));$("#commandButton").addEventListener("click",openCommands);$("#shortcutsButton").addEventListener("click",openCommands);
document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openCommands()}if(e.key==="Escape"&&dialog.open)dialog.close()});
$("#themeButton").addEventListener("click",()=>{const html=document.documentElement;html.dataset.theme=html.dataset.theme==="dark"?"light":"dark";localStorage.setItem("theme",html.dataset.theme)});document.documentElement.dataset.theme=localStorage.getItem("theme")||"dark";
$("#runButton").addEventListener("click",run);$("#inputEditor").addEventListener("input",updateSizes);$("#resetButton").addEventListener("click",()=>openTool(activeTool));$("#closeWorkbench").addEventListener("click",()=>$("#workbench").classList.add("hidden"));$("#copyButton").addEventListener("click",async()=>{if(!$("#outputEditor").value)return toast("Nothing to copy yet");await navigator.clipboard.writeText($("#outputEditor").value);toast("Output copied")});
$("#downloadButton").addEventListener("click",()=>{const output=$("#outputEditor").value;if(!output&&!pendingDownload)return toast("Nothing to download yet");const blob=pendingDownload?.blob||new Blob([output],{type:"text/plain;charset=utf-8"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=pendingDownload?.name||`converter-${activeTool}-output.txt`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),0);toast("Download started")});
