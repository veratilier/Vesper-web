const list = document.querySelector("#history-list");
const loadButton = document.querySelector("#load-more");
const labels = { longing: "思念", tenderness: "温柔", playfulness: "玩心", intensity: "浓度", attachment: "依恋", possessiveness: "占有欲" };
const kinds = { warmth: "温暖", absence: "离开", repair: "修复", shared_work: "共同做事", flirt: "暧昧" };
const sources = { user: "Vera 的真实互动", automation: "自动化记录", frontend: "前端记录" };
let cursor = null;

function time(value) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)).replaceAll("/", "-");
}
function escape(value) { const node = document.createElement("span"); node.textContent = String(value); return node.innerHTML; }
function stateLines(state) { return Object.entries(labels).map(([key, label]) => `<p>${label} ${state[key]}</p>`).join(""); }
function render(record) {
  const changes = Object.keys(labels).filter((key) => record.before[key] !== record.after[key]).map((key) => `${labels[key]} ${record.before[key]}→${record.after[key]}`).join(" · ");
  const reasons = Object.entries(record.reasons || {}).filter(([key, entries]) => labels[key] && Array.isArray(entries) && entries.length).map(([key, entries]) => `<p class="changes">${escape(labels[key])}：${escape(entries.join("；"))}</p>`).join("");
  const eventAt = record.eventAt || record.createdAt;
  const item = document.createElement("details"); item.className = "record";
  item.innerHTML = `<summary><p class="note">${escape(record.note)}</p><div class="meta">${escape(kinds[record.kind] || record.kind)} · ${escape(sources[record.interactionSource] || "自动化记录")} · ${escape(time(eventAt))}</div>${changes ? `<p class="changes">${escape(changes)}</p>` : ""}</summary><div class="full">${reasons ? `<section class="reasons"><h2>变化原因</h2>${reasons}</section>` : ""}<div class="states"><section class="state"><h2>更新前</h2>${stateLines(record.before)}</section><section class="state"><h2>更新后</h2>${stateLines(record.after)}</section></div></div>`;
  list.append(item);
}
async function load() {
  loadButton.disabled = true;
  const url = new URL("/api/history", location.origin); url.searchParams.set("limit", "20"); if (cursor) url.searchParams.set("cursor", cursor);
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) { if (response.status === 401) location.href = "/login?return_to=%2Fhistory"; return; }
  const data = await response.json(); data.records.forEach(render); cursor = data.nextCursor;
  loadButton.hidden = !cursor; loadButton.disabled = false;
  if (!list.children.length) list.innerHTML = '<p class="empty">还没有记录。</p>';
}
loadButton.addEventListener("click", load); void load();
