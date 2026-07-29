const STORAGE_KEY = "kol-content-audit.v4";
const sections = ["brief", "script", "draft", "post"];
const riskWords = ["第一", "唯一", "保证", "治愈", "永久", "绝对", "100%", "全网最低", "立刻见效"];
const stopWords = new Set(["需要", "要求", "必须", "可以", "客户", "博主", "视频", "脚本", "修改", "内容", "拍摄", "发布", "文案", "caption", "brief", "方向", "一致"]);

let state = loadState();
let activeView = "overview";
let activeProjectId = state.projects[0].id;
let activeCreatorId = state.projects[0].creators[0].id;
let activeSection = "brief";
let activeFilter = "all";
let lastAudit = null;

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultCreator(name = "博主 1") {
  return {
    id: uid("creator"),
    name,
    scriptRounds: [
      { scriptName: "脚本初稿", scriptText: "", scriptFile: "", feedbackText: "" },
      { scriptName: "脚本二稿", scriptText: "", scriptFile: "", feedbackText: "" }
    ],
    draftRounds: [
      { title: "视频初稿", videoFile: "", feedbackText: "" },
      { title: "视频修改稿", videoFile: "", feedbackText: "" }
    ],
    posts: [{ url: "", caption: "", source: "" }]
  };
}

function defaultProject(name = "项目 1") {
  return {
    id: uid("project"),
    name,
    brief: "",
    briefFile: "",
    creators: [defaultCreator()]
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved?.projects?.length) return saved;
  } catch {}
  return { projects: [defaultProject()] };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function project() {
  return state.projects.find(item => item.id === activeProjectId) || state.projects[0];
}

function creator() {
  const p = project();
  return p.creators.find(item => item.id === activeCreatorId) || p.creators[0];
}

function el(id) {
  return document.getElementById(id);
}

function esc(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalize(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function splitItems(text) {
  return String(text || "")
    .split(/[\n。；;.!?？]+/)
    .map(item => item.replace(/^[-*•\d.、\s]+/, "").trim())
    .filter(item => item.length >= 3);
}

function terms(text) {
  const normalized = normalize(text);
  const cn = normalized.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  const en = normalized.match(/[a-z0-9#@][a-z0-9#@_-]{2,}/g) || [];
  return [...cn, ...en].filter(item => !stopWords.has(item)).slice(0, 40);
}

function looseMatch(requirement, target, minHits = 1) {
  const requirementTerms = terms(requirement);
  const targetText = normalize(target);
  const found = requirementTerms.filter(term => targetText.includes(term));
  if (!requirementTerms.length) return { level: "missing", found };
  if (found.length >= minHits) return { level: "done", found };
  if (found.length > 0) return { level: "maybe", found };
  return { level: "missing", found };
}

function directionMatch(brief, script) {
  const briefItems = splitItems(brief);
  const scriptText = normalize(script);
  const matched = briefItems.filter(item => terms(item).some(term => scriptText.includes(term)));
  if (!briefItems.length || !normalize(script)) return { level: "missing", found: [] };
  const ratio = matched.length / briefItems.length;
  if (ratio >= 0.35 || matched.length >= 2) return { level: "done", found: matched.slice(0, 3).map(item => item.slice(0, 20)) };
  if (matched.length >= 1) return { level: "maybe", found: matched.slice(0, 2).map(item => item.slice(0, 20)) };
  return { level: "missing", found: [] };
}

function statusText(level) {
  return level === "done" ? "已完成" : level === "maybe" ? "疑似缺失" : "未修改";
}

function setSection(section) {
  activeSection = section;
  document.querySelectorAll(".section-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.section === section));
  sections.forEach(item => el(`${item}Section`).classList.toggle("hidden", item !== section));
}

function setView(view) {
  activeView = view;
  document.querySelectorAll(".side-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  el("overviewView").classList.toggle("hidden", view !== "overview");
  el("projectView").classList.toggle("hidden", view !== "project");
}

function renderSelectors() {
  el("projectSelect").innerHTML = state.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  el("projectSelect").value = activeProjectId;
  el("creatorSelect").innerHTML = project().creators.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  el("creatorSelect").value = activeCreatorId;
}

function renderOverview() {
  el("overviewView").innerHTML = `
    <div class="overview-head">
      <h2>项目总览</h2>
      <button id="overviewAddProject" type="button">新增项目</button>
    </div>
    <div class="project-grid">
      ${state.projects.map(p => `
        <button class="project-card" data-project-id="${p.id}" type="button">
          <strong>${esc(p.name)}</strong>
          <span>${p.creators.length} 位博主 · ${p.brief ? "已上传 Brief" : "未上传 Brief"}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function renderBrief() {
  const p = project();
  el("briefSection").innerHTML = `
    <div class="section-head">
      <h2>Brief</h2>
      <label class="file-button">上传 Brief
        <input id="briefFile" type="file" accept=".txt,.md,.csv,.json,.srt,.vtt">
      </label>
    </div>
    <textarea id="briefText" placeholder="粘贴客户 brief、方向、核心卖点、发布关键词、禁用词等...">${esc(p.brief)}</textarea>
    <p class="file-status">${p.briefFile ? `已读取：${esc(p.briefFile)}` : "未上传文件"}</p>
  `;
}

function renderScript() {
  const c = creator();
  el("scriptSection").innerHTML = `
    <div class="section-head">
      <h2>Script</h2>
      <button id="addScriptRound" type="button">添加一轮</button>
    </div>
    <div class="rounds">
      ${c.scriptRounds.map((round, index) => `
        <article class="round-card">
          <div class="round-title">
            <strong>第 ${index + 1} 轮：${esc(round.scriptName || `脚本${index + 1}稿`)}</strong>
            ${c.scriptRounds.length > 1 ? `<button class="ghost remove-script-round" data-index="${index}" type="button">删除</button>` : ""}
          </div>
          <div class="script-layout">
            <div class="script-main">
              <label><span>脚本内容</span><textarea class="script-text" data-index="${index}" placeholder="粘贴脚本内容...">${esc(round.scriptText)}</textarea></label>
            </div>
            <aside class="upload-panel">
              <label class="file-button wide">上传脚本文件<input class="script-file" data-index="${index}" type="file" accept=".txt,.md,.csv,.json,.srt,.vtt"></label>
              <p class="file-status">${round.scriptFile ? `已读取：${esc(round.scriptFile)}` : "支持 txt / md / srt / vtt"}</p>
            </aside>
          </div>
          <label><span>客户对本版脚本的反馈</span><textarea class="script-feedback" data-index="${index}" placeholder="用于审核下一版脚本是否按意见修改...">${esc(round.feedbackText)}</textarea></label>
        </article>
      `).join("")}
    </div>
  `;
}

function renderDraft() {
  const c = creator();
  el("draftSection").innerHTML = `
    <div class="section-head">
      <h2>Draft</h2>
      <button id="addDraftRound" type="button">添加一轮</button>
    </div>
    <div class="rounds">
      ${c.draftRounds.map((round, index) => `
        <article class="round-card">
          <div class="round-title">
            <strong>第 ${index + 1} 轮：${esc(round.title || `视频${index + 1}稿`)}</strong>
            ${c.draftRounds.length > 1 ? `<button class="ghost remove-draft-round" data-index="${index}" type="button">删除</button>` : ""}
          </div>
          <div class="draft-upload">
            <label class="file-button wide">上传视频<input class="draft-video" data-index="${index}" type="file" accept="video/*"></label>
            <span class="file-status">${round.videoFile ? `已上传：${esc(round.videoFile)}` : "未上传视频"}</span>
          </div>
          <label><span>客户对本版视频的反馈</span><textarea class="draft-feedback" data-index="${index}" placeholder="用于审核下一版 Draft 是否按意见修改...">${esc(round.feedbackText || "")}</textarea></label>
        </article>
      `).join("")}
    </div>
  `;
}

function renderPost() {
  const c = creator();
  el("postSection").innerHTML = `
    <div class="section-head">
      <h2>Post</h2>
      <button id="addPost" type="button">新增链接</button>
    </div>
    <div class="rounds">
      ${c.posts.map((post, index) => `
        <article class="round-card">
          <div class="round-title">
            <strong>发布链接 ${index + 1}</strong>
            ${c.posts.length > 1 ? `<button class="ghost remove-post" data-index="${index}" type="button">删除</button>` : ""}
          </div>
          <label><span>链接</span><input class="post-url" data-index="${index}" type="url" placeholder="粘贴发布链接..." value="${esc(post.url)}"></label>
          <div class="post-tools">
            <button class="capture-caption" data-index="${index}" type="button">抓取 caption</button>
            <span class="file-status">${esc(post.source || "未抓取")}</span>
          </div>
          <label><span>Caption</span><textarea class="post-caption" data-index="${index}" placeholder="抓取失败时可手动粘贴 caption...">${esc(post.caption)}</textarea></label>
        </article>
      `).join("")}
    </div>
  `;
}

function renderAll() {
  renderSelectors();
  renderOverview();
  renderBrief();
  renderScript();
  renderDraft();
  renderPost();
  setView(activeView);
  setSection(activeSection);
  saveState();
}

async function readTextFile(file) {
  return file.text();
}

function latestScriptText() {
  return [...creator().scriptRounds].reverse().find(round => normalize(round.scriptText))?.scriptText || "";
}

function buildScriptRows() {
  const c = creator();
  const rows = [];
  const first = c.scriptRounds[0];
  if (project().brief || first?.scriptText) {
    const match = directionMatch(project().brief, first?.scriptText || "");
    rows.push({
      source: "Script 1",
      requirement: "第一版脚本方向与 Brief 一致",
      level: match.level,
      comment: match.level === "done"
        ? `脚本初稿与 Brief 大方向一致，已提到相关方向：${match.found.join("、") || "核心方向"}。`
        : match.level === "maybe"
          ? "脚本初稿有部分方向贴合 Brief，建议人工复核是否足够。"
          : "脚本初稿未体现 Brief 的主要方向，建议返修。"
    });
  }
  for (let i = 0; i < c.scriptRounds.length - 1; i += 1) {
    const feedback = c.scriptRounds[i].feedbackText;
    const nextScript = c.scriptRounds[i + 1].scriptText;
    splitItems(feedback).forEach(item => {
      const match = looseMatch(item, nextScript);
      rows.push({
        source: `Script ${i + 2}`,
        requirement: item,
        level: match.level,
        comment: match.level === "done"
          ? `新版脚本已提到相关修改点：${match.found.join("、") || "有对应表达"}。`
          : "新版脚本未找到明显对应表达，建议补充或人工确认。"
      });
    });
  }
  return rows;
}

function buildDraftRows() {
  const c = creator();
  const rows = [];
  const latestScript = latestScriptText();
  const firstDraft = c.draftRounds[0];
  if (firstDraft?.videoFile) {
    rows.push({
      source: "Draft 1",
      requirement: "第一版 Draft 与最新确认脚本一致",
      level: latestScript ? "maybe" : "missing",
      comment: latestScript
        ? `已上传 ${firstDraft.videoFile}。需人工观看视频，确认是否按最新脚本拍摄。`
        : "尚未录入可对照的最新脚本。"
    });
  }
  for (let i = 0; i < c.draftRounds.length - 1; i += 1) {
    const feedbackItems = splitItems(c.draftRounds[i].feedbackText || "");
    const nextDraft = c.draftRounds[i + 1];
    feedbackItems.forEach(item => {
      rows.push({
        source: `Draft ${i + 2}`,
        requirement: item,
        level: nextDraft?.videoFile ? "maybe" : "missing",
        comment: nextDraft?.videoFile
          ? `已上传 ${nextDraft.videoFile}。需人工观看视频确认该反馈是否已修改。`
          : "尚未上传下一版 Draft，无法确认是否修改。"
      });
    });
  }
  return rows;
}

function requiredPostKeywords() {
  const brief = project().brief;
  const hashTags = brief.match(/#[\w\u4e00-\u9fa5_-]+/g) || [];
  const explicit = splitItems(brief)
    .filter(item => /caption|hashtag|话题|标签|包含|需包含|必须包含|关键词/i.test(item))
    .flatMap(item => terms(item));
  return [...new Set([...hashTags, ...explicit])].slice(0, 20);
}

function buildPostRows() {
  const caption = creator().posts.map(post => post.caption).join("\n");
  const captionText = normalize(caption);
  return requiredPostKeywords().map(keyword => {
    const ok = captionText.includes(normalize(keyword));
    return {
      source: "Post",
      requirement: `Caption 包含：${keyword}`,
      level: ok ? "done" : "missing",
      comment: ok ? "发布 caption 已包含该关键词。" : "发布 caption 未找到该关键词。"
    };
  });
}

function buildRiskRows() {
  const text = [
    latestScriptText(),
    creator().posts.map(post => post.caption).join("\n")
  ].join("\n");
  return riskWords
    .filter(word => normalize(text).includes(normalize(word)))
    .map(word => ({
      source: "Risk",
      requirement: `避免高风险表达：${word}`,
      level: "maybe",
      comment: "发现可能夸张或合规风险表达，建议人工确认是否需要替换。"
    }));
}

function buildAudit() {
  const rows = [...buildScriptRows(), ...buildDraftRows(), ...buildPostRows(), ...buildRiskRows()];
  const done = rows.filter(row => row.level === "done").length;
  const maybe = rows.filter(row => row.level === "maybe").length;
  const missing = rows.filter(row => row.level === "missing").length;
  const score = rows.length ? Math.round(((done + maybe * 0.4) / rows.length) * 100) : 0;
  return { rows, done, maybe, missing, score };
}

function renderAudit(audit) {
  lastAudit = audit;
  const verdict = audit.rows.length === 0 ? "暂无可审" : audit.missing === 0 ? "基本通过" : audit.score >= 60 ? "需要复核" : "建议返修";
  el("verdict").textContent = verdict;
  el("scoreRing").textContent = audit.rows.length ? `${audit.score}%` : "--";
  el("scoreRing").style.background = `conic-gradient(var(--accent) ${audit.score * 3.6}deg, #eef1f3 0deg)`;
  el("doneCount").textContent = audit.done;
  el("maybeCount").textContent = audit.maybe;
  el("missingCount").textContent = audit.missing;
  el("summary").textContent = `${project().name} / ${creator().name}`;
  const rows = audit.rows.filter(row => activeFilter === "all" || row.level === activeFilter);
  el("auditTable").innerHTML = `
    <div class="table-head">
      <span>客户要求</span>
      <span>博主是否完成</span>
      <span>评价</span>
    </div>
    ${rows.length ? rows.map((row, index) => `
      <div class="table-row ${row.level}">
        <div class="requirement"><strong>${index + 1}. ${esc(row.requirement)}</strong><small>${row.source}</small></div>
        <div><span class="status ${row.level}">✓ ${statusText(row.level)}</span></div>
        <div class="comment">${esc(row.comment)}</div>
      </div>
    `).join("") : `<div class="empty">当前筛选下没有结果。</div>`}
  `;
}

function auditText() {
  if (!lastAudit) return "";
  return lastAudit.rows.map((row, index) => `${index + 1}. ${row.requirement}\t${statusText(row.level)}\t${row.comment}`).join("\n");
}

async function fetchCaption(url) {
  if (!url) throw new Error("missing url");
  const clean = url.trim();
  const candidates = [
    clean,
    `https://r.jina.ai/http://${clean.replace(/^https?:\/\//, "")}`,
    `https://r.jina.ai/https://${clean.replace(/^https?:\/\//, "")}`
  ];
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate);
      const text = await res.text();
      const found = extractCaption(text);
      if (found) return { caption: found, source: "已抓取 caption" };
    } catch {}
  }
  throw new Error("caption fetch failed");
}

function extractCaption(html) {
  const meta = html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|twitter:description|description)["'][^>]+content=["']([^"']+)["']/i);
  if (meta?.[1]) return decode(meta[1]);
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (title?.[1]) return decode(title[1]);
  return "";
}

function decode(text) {
  const area = document.createElement("textarea");
  area.innerHTML = text;
  return area.value;
}

function addProject() {
  const name = prompt("请输入项目名称");
  if (!name) return;
  const next = defaultProject(name.trim());
  state.projects.push(next);
  activeProjectId = next.id;
  activeCreatorId = next.creators[0].id;
  activeView = "project";
  renderAll();
}

function deleteProject(id) {
  if (state.projects.length === 1) return alert("至少保留一个项目。");
  if (!confirm("确定删除这个项目吗？项目下所有博主资料都会删除。")) return;
  state.projects = state.projects.filter(item => item.id !== id);
  activeProjectId = state.projects[0].id;
  activeCreatorId = state.projects[0].creators[0].id;
  renderAll();
}

function addCreator() {
  const name = prompt("请输入博主名称");
  if (!name) return;
  const next = defaultCreator(name.trim());
  project().creators.push(next);
  activeCreatorId = next.id;
  renderAll();
}

function deleteCreator(id) {
  const p = project();
  if (p.creators.length === 1) return alert("至少保留一位博主。");
  if (!confirm("确定删除这位博主吗？")) return;
  p.creators = p.creators.filter(item => item.id !== id);
  activeCreatorId = p.creators[0].id;
  renderAll();
}

document.addEventListener("click", async event => {
  let target = event.target;
  if (!(target instanceof HTMLElement)) return;
  target = target.closest("button") || target;
  if (target.classList.contains("side-tab")) return setView(target.dataset.view);
  if (target.classList.contains("section-tab")) return setSection(target.dataset.section);
  if (target.classList.contains("project-card")) {
    activeProjectId = target.dataset.projectId;
    activeCreatorId = project().creators[0].id;
    activeView = "project";
    return renderAll();
  }
  if (target.id === "overviewAddProject" || target.id === "addProjectBtn") return addProject();
  if (target.id === "renameProjectBtn") {
    const p = project();
    const name = prompt("修改项目名称", p.name);
    if (name) p.name = name.trim();
    return renderAll();
  }
  if (target.id === "deleteProjectBtn") return deleteProject(activeProjectId);
  if (target.id === "addCreatorBtn") return addCreator();
  if (target.id === "renameCreatorBtn") {
    const c = creator();
    const name = prompt("修改博主名称", c.name);
    if (name) c.name = name.trim();
    return renderAll();
  }
  if (target.id === "deleteCreatorBtn") return deleteCreator(activeCreatorId);
  if (target.id === "addScriptRound") {
    creator().scriptRounds.push({ scriptName: `脚本${creator().scriptRounds.length + 1}稿`, scriptText: "", scriptFile: "", feedbackText: "" });
    return renderAll();
  }
  if (target.id === "addDraftRound") {
    creator().draftRounds.push({ title: `视频${creator().draftRounds.length + 1}稿`, videoFile: "", feedbackText: "" });
    return renderAll();
  }
  if (target.classList.contains("remove-script-round")) {
    creator().scriptRounds.splice(Number(target.dataset.index), 1);
    return renderAll();
  }
  if (target.classList.contains("remove-draft-round")) {
    creator().draftRounds.splice(Number(target.dataset.index), 1);
    return renderAll();
  }
  if (target.id === "addPost") {
    creator().posts.push({ url: "", caption: "", source: "" });
    return renderAll();
  }
  if (target.classList.contains("remove-post")) {
    creator().posts.splice(Number(target.dataset.index), 1);
    if (!creator().posts.length) creator().posts.push({ url: "", caption: "", source: "" });
    return renderAll();
  }
  if (target.classList.contains("capture-caption")) {
    const post = creator().posts[Number(target.dataset.index)];
    post.source = "抓取中...";
    renderAll();
    try {
      const result = await fetchCaption(post.url);
      post.caption = result.caption;
      post.source = result.source;
    } catch {
      post.source = "抓取失败，请手动粘贴 caption";
    }
    return renderAll();
  }
  if (target.classList.contains("filter-btn")) {
    activeFilter = target.dataset.filter;
    document.querySelectorAll(".filter-btn").forEach(btn => btn.classList.toggle("active", btn === target));
    if (lastAudit) renderAudit(lastAudit);
  }
  if (target.id === "auditBtn") return renderAudit(buildAudit());
  if (target.id === "exportBtn") {
    await navigator.clipboard.writeText(auditText());
    target.textContent = "已复制";
    setTimeout(() => target.textContent = "复制审核表", 1200);
  }
  if (target.id === "clearCreatorBtn") {
    if (!confirm("清空当前博主资料？")) return;
    const c = creator();
    Object.assign(c, defaultCreator(c.name), { id: c.id, name: c.name });
    renderAll();
  }
  if (target.id === "sampleBtn") {
    const p = project();
    p.name = "Luma Roast 广告";
    p.brief = "方向：展示 Flova 用 Agent、Project Documents、Skills 生成 Luma Roast 广告。Caption 需包含 #LumaRoast #CoffeeAgent。禁止使用全网最低、永久。";
    const c = creator();
    c.name = "博主 A";
    c.scriptRounds = [
      { scriptName: "脚本初稿", scriptText: "介绍 Luma Roast 咖啡广告，展示 Agent 和 Skills 如何参与广告制作。", scriptFile: "", feedbackText: "Skill 前置。明确 Agent 使用 Brief + Skill 生成 Storyboard。Case 具体化到 coffee beans、morning kitchen、logo reveal。局部修改要具体，说明 camera、reflection、logo visibility。" },
      { scriptName: "脚本二稿", scriptText: "一开始说明 Flova 不是 AI 视频工具，而是围绕 Agent、Project Documents、Skills 建立工作流。Agent 使用 Brief + Skill 生成 Storyboard，并逐镜头说明 Skill 的影响。案例品牌是 Luma Roast，包含 coffee beans、morning kitchen、logo reveal，并说明 camera、reflection、logo visibility 的修改。", scriptFile: "", feedbackText: "" }
    ];
    c.draftRounds = [
      { title: "视频初稿", videoFile: "draft-v1.mp4", feedbackText: "最终成片需要加入 CTA。" },
      { title: "视频修改稿", videoFile: "draft-v2.mp4", feedbackText: "" }
    ];
    c.posts = [{ url: "", caption: "Now I will play the completed Luma Roast commercial in full. #LumaRoast #CoffeeAgent", source: "示例" }];
    activeView = "project";
    renderAll();
  }
});

document.addEventListener("change", async event => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  if (target.id === "projectSelect") {
    activeProjectId = target.value;
    activeCreatorId = project().creators[0].id;
    return renderAll();
  }
  if (target.id === "creatorSelect") {
    activeCreatorId = target.value;
    return renderAll();
  }
  const file = target.files?.[0];
  if (!file) return;
  if (target.id === "briefFile") {
    project().brief = await readTextFile(file);
    project().briefFile = file.name;
  }
  if (target.classList.contains("script-file")) {
    const round = creator().scriptRounds[Number(target.dataset.index)];
    round.scriptText = await readTextFile(file);
    round.scriptFile = file.name;
  }
  if (target.classList.contains("draft-video")) {
    creator().draftRounds[Number(target.dataset.index)].videoFile = file.name;
  }
  renderAll();
});

document.addEventListener("input", event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.id === "briefText") project().brief = target.value;
  if (target.classList.contains("script-text")) creator().scriptRounds[Number(target.dataset.index)].scriptText = target.value;
  if (target.classList.contains("script-feedback")) creator().scriptRounds[Number(target.dataset.index)].feedbackText = target.value;
  if (target.classList.contains("draft-feedback")) creator().draftRounds[Number(target.dataset.index)].feedbackText = target.value;
  if (target.classList.contains("post-url")) creator().posts[Number(target.dataset.index)].url = target.value;
  if (target.classList.contains("post-caption")) creator().posts[Number(target.dataset.index)].caption = target.value;
  saveState();
});

renderAll();
