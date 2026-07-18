const state = { catalog: [], localDocuments: [], selected: new Set() };
const sourceList = document.querySelector("#sourceList");
const selectionCount = document.querySelector("#selectionCount");
const analyzeButton = document.querySelector("#analyzeButton");
const questionInput = document.querySelector("#questionInput");
const results = document.querySelector("#results");
const emptyState = document.querySelector("#emptyState");
const libraryMeta = document.querySelector("#libraryMeta");
const toast = document.querySelector("#toast");

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => { toast.hidden = true; }, 4200);
}

function formatBytes(bytes) { return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`; }
function sourceId(source) { return `${source.kind}:${source.id}`; }
function renderSources() {
  const sources = [...state.catalog.map((item) => ({ ...item, kind: "catalog" })), ...state.localDocuments.map((item) => ({ ...item, kind: "local" }))];
  sourceList.replaceChildren();
  libraryMeta.textContent = sources.length ? `${sources.length} local source${sources.length === 1 ? "" : "s"}` : "No local sources";
  if (!sources.length) sourceList.innerHTML = '<p class="library-note">No transcript files found yet.</p>';
  for (const source of sources) {
    const id = sourceId(source); const label = document.createElement("label"); label.className = `source ${state.selected.has(id) ? "selected" : ""}`;
    const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = state.selected.has(id);
    checkbox.addEventListener("change", () => { checkbox.checked ? state.selected.add(id) : state.selected.delete(id); renderSources(); updateSelection(); });
    const text = document.createElement("span"); const name = document.createElement("span"); name.className = "source-name"; name.textContent = source.title;
    const meta = document.createElement("span"); meta.className = "source-meta"; meta.textContent = `${source.kind === "local" ? "Added file" : "Library"} · ${formatBytes(source.bytes || source.content.length)}`;
    text.append(name, meta); label.append(checkbox, text); sourceList.append(label);
  }
}
function updateSelection() { const count = state.selected.size; selectionCount.textContent = count ? `${count} source${count === 1 ? "" : "s"} selected` : "No sources selected"; }
function addDocuments(documents, skipped = []) {
  for (const document of documents) {
    if (!state.localDocuments.some((item) => item.id === document.id)) state.localDocuments.push(document);
    state.selected.add(`local:${document.id}`);
  }
  renderSources(); updateSelection();
  if (skipped.length) showToast(`${skipped.length} file${skipped.length === 1 ? " was" : "s were"} skipped. Use .txt or .md files up to 1 MB.`);
}
async function loadStatus() {
  const response = await fetch("/api/status"); const data = await response.json(); state.catalog = data.transcripts;
  const status = document.querySelector("#engineStatus"); const modelSelect = document.querySelector("#modelSelect");
  status.textContent = data.models.length ? `${data.models.length} local model${data.models.length === 1 ? "" : "s"} ready` : "Extractive local analysis";
  for (const model of data.models) { const option = document.createElement("option"); option.value = model.name; option.textContent = model.name; modelSelect.append(option); }
  renderSources(); updateSelection();
}
async function selectedDocuments() {
  const documents = [];
  for (const item of state.catalog) if (state.selected.has(`catalog:${item.id}`)) { const response = await fetch(`/api/transcript?id=${encodeURIComponent(item.id)}`); documents.push(await response.json()); }
  for (const item of state.localDocuments) if (state.selected.has(`local:${item.id}`)) documents.push(item);
  return documents;
}
function renderResults(payload) {
  const analysis = payload.analysis; document.querySelector("#overview").textContent = analysis.overview; document.querySelector("#engineBadge").textContent = payload.engine;
  const findings = document.querySelector("#findings"); findings.replaceChildren();
  for (const item of analysis.findings) { const node = document.querySelector("#findingTemplate").content.cloneNode(true); node.querySelector("h4").textContent = item.title; node.querySelector("p").textContent = item.detail; const evidence = node.querySelector(".evidence"); for (const quote of item.evidence || []) { const block = document.createElement("div"); block.className = "quote"; block.textContent = `"${quote.quote}"`; const source = document.createElement("span"); source.textContent = quote.source; block.append(source); evidence.append(block); } findings.append(node); }
  const themes = document.querySelector("#themes"); themes.replaceChildren(); for (const theme of analysis.themes) { const tag = document.createElement("span"); tag.className = "theme"; tag.textContent = theme.label; const count = document.createElement("b"); count.textContent = ` ${theme.count}`; tag.append(count); themes.append(tag); }
  const followUps = document.querySelector("#followUps"); followUps.replaceChildren(); for (const item of analysis.followUps) { const question = document.createElement("button"); question.className = "follow-up"; question.type = "button"; question.textContent = item; question.addEventListener("click", () => { questionInput.value = item; questionInput.focus(); }); followUps.append(question); }
  emptyState.hidden = true; results.hidden = false;
}
document.querySelector("#fileInput").addEventListener("change", async (event) => { const documents = []; for (const file of event.target.files) documents.push({ id: `${file.name}-${file.lastModified}`, title: file.name.replace(/\.[^.]+$/, ""), content: await file.text(), bytes: file.size }); addDocuments(documents); event.target.value = ""; });
const openFolderButton = document.querySelector("#openFolderButton");
openFolderButton.addEventListener("click", async () => { if (window.desktop) await window.desktop.openTranscriptFolder(); });
if (window.desktop) {
  document.querySelector(".icon-button").addEventListener("click", async (event) => {
    event.preventDefault();
    const result = await window.desktop.chooseTranscripts();
    addDocuments(result.documents, result.skipped);
  });
  window.desktop.onTranscriptImport((result) => addDocuments(result.documents, result.skipped));
} else {
  openFolderButton.hidden = true;
}
analyzeButton.addEventListener("click", async () => { try { const documents = await selectedDocuments(); if (!documents.length) throw new Error("Select a transcript first."); analyzeButton.disabled = true; analyzeButton.textContent = "Reading sources..."; const response = await fetch("/api/analyze", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ documents, question:questionInput.value, mode:document.querySelector("#modeSelect").value, model:document.querySelector("#modelSelect").value }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); renderResults(payload); } catch (error) { window.alert(error.message); } finally { analyzeButton.disabled = false; analyzeButton.textContent = "Find insights"; } });
questionInput.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") analyzeButton.click(); });
loadStatus().catch((error) => { document.querySelector("#engineStatus").textContent = "Server connection failed"; console.error(error); });
