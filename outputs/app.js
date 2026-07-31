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

const conceptGroups = [
  ["cta", "行动号召", "引导购买", "点击链接", "立即体验", "了解更多"],
  ["logo", "品牌标志", "品牌露出", "标识"],
  ["产品", "商品", "实物", "包装"],
  ["前置", "开头", "一开始", "前三秒", "首屏"],
  ["字幕", "caption", "屏幕文字", "文案"],
  ["口播", "旁白", "voice", "发音"],
  ["特写", "近景", "close-up", "closeup"],
  ["hashtag", "话题", "标签", "#"],
  ["链接", "link", "落地页"],
  ["场景", "画面", "镜头", "storyboard", "分镜"]
];

function matchedConcepts(requirement, target) {
  const requirementText = normalize(requirement);
  const targetText = normalize(target);
  return conceptGroups
    .filter(group => group.some(term => requirementText.includes(normalize(term))))
    .filter(group => group.some(term => targetText.includes(normalize(term))))
    .map(group => group[0]);
}

function revisionMatch(requirement, target) {
  const direct = looseMatch(requirement, target);
  const concepts = matchedConcepts(requirement, target);
  const removal = /删除|删掉|去掉|移除|不要|避免|禁用|不能出现/.test(requirement);
  if (removal) {
    const subjectTerms = terms(requirement).filter(term => !/删除|删掉|去掉|移除|不要|避免|禁用|不能出现/.test(term));
    const stillPresent = subjectTerms.filter(term => normalize(target).includes(term));
    return { level: stillPresent.length ? "missing" : "done", found: stillPresent, mode: "remove" };
  }
  if (direct.level === "done" || concepts.length) {
    return { level: "done", found: [...new Set([...direct.found, ...concepts])], mode: "add" };
  }
  return { level: direct.level, found: direct.found, mode: "add" };
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
  return level === "done" ? "已落实" : level === "maybe" ? "待人工确认" : "未落实";
}

function statusIcon(level) {
  return level === "done" ? "已落实" : level === "maybe" ? "待确认" : "未落实";
}

function stageStatus(creatorItem, stage) {
  if (stage === "script") {
    const rounds = creatorItem.scriptRounds || [];
    let hasFeedback = false;
    let hasPending = false;
    for (let i = 0; i < rounds.length - 1; i += 1) {
      const feedbackItems = splitItems(rounds[i].feedbackText || "");
      if (!feedbackItems.length) continue;
      hasFeedback = true;
      if (!normalize(rounds[i + 1].scriptText)) return "missing";
      const matches = feedbackItems.map(item => revisionMatch(item, rounds[i + 1].scriptText));
      if (matches.some(match => match.level === "missing")) return "missing";
      if (matches.some(match => match.level === "maybe")) hasPending = true;
    }
    if (hasFeedback) return hasPending ? "maybe" : "done";
    return rounds.some(round => normalize(round.scriptText)) ? "done" : "missing";
  }
  if (stage === "draft") {
    const rounds = creatorItem.draftRounds || [];
    if (rounds.some(round => normalize(round.feedbackText))) return "maybe";
    return rounds.some(round => round.videoFile) ? "done" : "missing";
  }
  if (stage === "post") {
    return (creatorItem.posts || []).some(post => normalize(post.caption) || normalize(post.url)) ? "done" : "missing";
  }
  return "missing";
}

function setSection(section) {
  activeSection = section;
  document.querySelectorAll(".section-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.section === section));
  sections.forEach(item => el(`${item}Section`).classList.toggle("hidden", item !== section));
  el("auditBtn").classList.toggle("hidden", section === "brief");
}

function setView(view) {
  activeView = view;
  document.querySelectorAll(".side-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  el("overviewView").classList.toggle("hidden", view !== "overview");
  el("projectView").classList.toggle("hidden", view !== "project");
}

function renderCampaignTree() {
  el("campaignTree").innerHTML = state.projects.map(p => `
    <div class="tree-project-item ${activeView === "project" && p.id === activeProjectId ? "active" : ""}">
      <button class="tree-project-btn" data-project-id="${p.id}" type="button">
        <span class="project-avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span>
        <span class="project-nav-copy"><strong>${esc(p.name)}</strong><small>${p.creators.length} creators</small></span>
      </button>
      <div class="tree-actions">
        <button class="rename-project" data-project-id="${p.id}" type="button" title="Edit project">Edit</button>
        <button class="delete-project" data-project-id="${p.id}" type="button" title="Delete project">Delete</button>
      </div>
    </div>
  `).join("");
}

function latestRoundNumber(rounds, hasContent) {
  let latest = 0;
  (rounds || []).forEach((round, index) => {
    if (hasContent(round)) latest = index + 1;
  });
  return latest;
}

function creatorProgress(creatorItem) {
  const scriptRound = latestRoundNumber(creatorItem.scriptRounds, round => normalize(round.scriptText) || round.scriptFile);
  const draftRound = latestRoundNumber(creatorItem.draftRounds, round => round.videoFile);
  const hasPost = (creatorItem.posts || []).some(post => normalize(post.caption) || normalize(post.url));
  return [
    { stage: "Script", round: scriptRound, status: stageStatus(creatorItem, "script") },
    { stage: "Draft", round: draftRound, status: stageStatus(creatorItem, "draft") },
    { stage: "Post", round: hasPost ? 1 : 0, status: stageStatus(creatorItem, "post") }
  ];
}

function progressLabel(item) {
  if (!item.round) return `${item.stage} · Not submitted`;
  if (item.status === "done") return item.stage === "Post" ? "Post · Reviewed" : `${item.stage} v${item.round} · Reviewed`;
  if (item.status === "maybe") return `${item.stage} v${item.round} · In review`;
  return `${item.stage} v${item.round} · Needs revision`;
}

function renderOverview() {
  const totals = state.projects.reduce((acc, p) => {
    p.creators.forEach(c => {
      ["script", "draft", "post"].forEach(stage => {
        const status = stageStatus(c, stage);
        if (status === "done") acc.approved += 1;
        if (status === "maybe") acc.pending += 1;
        if (status === "missing") acc.missing += 1;
      });
    });
    return acc;
  }, { approved: 0, pending: 0, missing: 0 });
  el("overviewView").innerHTML = `
    <div class="overview-head">
      <div><p class="page-eyebrow">WORKSPACE</p><h2>Project Overview</h2><p class="page-subtitle">Track every creator and review round across active campaigns.</p></div>
      <button id="overviewAddProject" class="primary" type="button">New Project</button>
    </div>
    <div class="dashboard-grid">
      <div><span>In Review</span><strong>${totals.pending}</strong><small>stage reviews</small></div>
      <div><span>Reviewed</span><strong>${totals.approved}</strong><small>completed stages</small></div>
      <div><span>Needs Revision</span><strong>${totals.missing}</strong><small>open stages</small></div>
      <div><span>Active Projects</span><strong>${state.projects.length}</strong><small>campaign workspaces</small></div>
    </div>
    <div class="project-grid">
      ${state.projects.map(p => `
        <article class="project-card">
          <div class="project-card-head">
            <button class="project-card-open" data-project-id="${p.id}" type="button">
              <span class="project-avatar large">${esc(p.name.slice(0, 1).toUpperCase())}</span>
              <span><strong>${esc(p.name)}</strong><small>${p.creators.length} creators · ${p.brief ? "Brief ready" : "Brief missing"}</small></span>
            </button>
            <div class="card-actions">
              <button class="rename-project" data-project-id="${p.id}" type="button">Edit</button>
              <button class="delete-project" data-project-id="${p.id}" type="button">Delete</button>
            </div>
          </div>
          <div class="creator-progress-list">
            ${p.creators.map(c => `
              <button class="overview-creator-row" data-project-id="${p.id}" data-creator-id="${c.id}" type="button">
                <strong>${esc(c.name)}</strong>
                <span class="progress-tags">${creatorProgress(c).map(item => `<i class="${item.status}">${progressLabel(item)}</i>`).join("")}</span>
              </button>
            `).join("")}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderProgressPanel() {
  const p = project();
  const rows = p.creators.map(c => `
    <div class="progress-row ${c.id === activeCreatorId ? "active" : ""}">
      <button class="creator-switch" data-project-id="${p.id}" data-creator-id="${c.id}" type="button"><strong>${esc(c.name)}</strong><small>Open review workspace</small></button>
      <span class="progress-tags">${creatorProgress(c).map(item => `<i class="${item.status}">${progressLabel(item)}</i>`).join("")}</span>
      <div class="creator-actions">
        <button class="rename-creator" data-project-id="${p.id}" data-creator-id="${c.id}" type="button">Edit</button>
        <button class="delete-creator" data-project-id="${p.id}" data-creator-id="${c.id}" type="button">Delete</button>
      </div>
    </div>
  `).join("");
  el("progressPanel").innerHTML = `
    <div class="progress-title">
      <div>
        <p class="page-eyebrow">PROJECT WORKSPACE</p>
        <h2>${esc(p.name)}</h2>
        <p>${p.creators.length} creators · ${p.brief ? "Brief ready" : "Brief not uploaded"}</p>
      </div>
      <div class="project-actions">
        <button class="rename-project" data-project-id="${p.id}" type="button">Edit Project</button>
        <button class="delete-project" data-project-id="${p.id}" type="button">Delete Project</button>
        <button class="tree-add-creator primary" data-project-id="${p.id}" type="button">Add Creator</button>
      </div>
    </div>
    <div class="creator-list-label"><span>Creators</span><span>Review progress</span><span>Actions</span></div>
    <div class="progress-list">${rows}</div>
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
    <label><span>Review Rules / Prompt</span><textarea id="reviewRules" placeholder="可放品牌规范、平台规则、国家市场注意事项。当前版本作为备忘，不参与自动审核。">${esc(p.reviewRules || "")}</textarea></label>
  `;
}

function renderScript() {
  const c = creator();
  el("scriptSection").innerHTML = `
    <div class="section-head">
      <div><h2>Script</h2><p class="section-purpose">初稿核对 Brief 大方向；后续每一稿重点核对上一版客户反馈是否落实。</p></div>
      <button id="addScriptRound" type="button">添加一轮</button>
    </div>
    <div class="rounds">
      ${c.scriptRounds.map((round, index) => `
        <article class="round-card">
          <div class="round-title">
            <strong>第 ${index + 1} 轮：${esc(round.scriptName || `脚本${index + 1}稿`)}</strong>
            ${c.scriptRounds.length > 1 ? `<button class="ghost remove-script-round" data-index="${index}" type="button">删除</button>` : ""}
          </div>
          <div class="comparison-strip">${index === 0 ? "核对基准：项目 Brief（仅判断整体方向）" : `核对基准：第 ${index} 轮客户反馈 → 本轮脚本`}</div>
          <div class="script-layout">
            <div class="script-main">
              <label><span>脚本内容</span><textarea class="script-text" data-index="${index}" placeholder="粘贴脚本内容...">${esc(round.scriptText)}</textarea></label>
            </div>
            <aside class="upload-panel">
              <strong>脚本文件</strong>
              <p class="upload-copy">可直接上传文本脚本，文件内容会自动填入左侧。</p>
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
      <div><h2>Draft</h2><p class="section-purpose">视频初稿对照最新脚本；修改稿逐条对照上一版视频反馈。</p></div>
      <button id="addDraftRound" type="button">添加一轮</button>
    </div>
    <div class="rounds">
      ${c.draftRounds.map((round, index) => `
        <article class="round-card">
          <div class="round-title">
            <strong>第 ${index + 1} 轮：${esc(round.title || `视频${index + 1}稿`)}</strong>
            ${c.draftRounds.length > 1 ? `<button class="ghost remove-draft-round" data-index="${index}" type="button">删除</button>` : ""}
          </div>
          <div class="comparison-strip">${index === 0 ? "核对基准：最新确认脚本 → 视频初稿" : `核对基准：第 ${index} 轮视频反馈 → 本轮视频`}</div>
          <div class="draft-upload">
            <label class="file-button wide">上传视频<input class="draft-video" data-index="${index}" type="file" accept="video/*"></label>
            <span class="file-status">${round.videoFile ? `已上传：${esc(round.videoFile)}` : "未上传视频"}</span>
          </div>
          <div class="metadata-grid">
            <div><span>Resolution</span><strong>${round.videoFile ? "待解析" : "-"}</strong></div>
            <div><span>Duration</span><strong>${round.videoFile ? "待解析" : "-"}</strong></div>
            <div><span>FPS</span><strong>${round.videoFile ? "待解析" : "-"}</strong></div>
            <div><span>Subtitle</span><strong>${round.videoFile ? "待确认" : "-"}</strong></div>
          </div>
          <div class="review-sections">
            <span>Visual Review</span>
            <span>Audio Review</span>
            <span>Subtitle Review</span>
            <span>Brand Review</span>
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
  renderCampaignTree();
  renderOverview();
  renderProgressPanel();
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
        severity: match.level === "missing" ? "Critical" : match.level === "maybe" ? "Major" : "Pass",
        category: "Mandatory",
        evidence: match.found.length ? `Matched: ${match.found.join(" / ")}` : "No brief direction detected in script v1",
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
      const match = revisionMatch(item, nextScript);
      rows.push({
        source: `Script ${i + 2}`,
        requirement: item,
        level: match.level,
        severity: match.level === "missing" ? "Major" : "Pass",
        category: "Mandatory",
        evidence: match.found.length
          ? `${match.mode === "remove" ? "仍检测到" : "检测到对应表达"}：${match.found.join(" / ")}`
          : `已对照第 ${i + 1} 轮反馈与第 ${i + 2} 轮脚本`,
        comment: match.level === "done"
          ? match.mode === "remove"
            ? "新版脚本中未再检测到要求删除或避免的内容，可视为已落实。"
            : `新版脚本已体现该修改点：${match.found.join("、") || "有对应表达"}。`
          : match.level === "maybe"
            ? "新版脚本可能有相关表达，但证据不足，建议人工确认。"
            : "新版脚本中未找到该修改意见的对应变化，建议继续修改。"
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
      severity: latestScript ? "Major" : "Critical",
      category: "Brand",
      evidence: firstDraft.videoFile ? `Video file: ${firstDraft.videoFile}` : "No video file",
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
        severity: nextDraft?.videoFile ? "Major" : "Critical",
        category: "Brand",
        evidence: nextDraft?.videoFile ? `Video file: ${nextDraft.videoFile}` : "No next draft uploaded",
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
      severity: ok ? "Pass" : "Critical",
      category: "Mandatory",
      evidence: ok ? `Detected keyword: ${keyword}` : "Caption keyword not found",
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
      severity: "Major",
      category: "Risk",
      evidence: `Detected risk word: ${word}`,
      comment: "发现可能夸张或合规风险表达，建议人工确认是否需要替换。"
    }));
}

function buildAudit() {
  const stageRows = activeSection === "script" ? buildScriptRows()
    : activeSection === "draft" ? buildDraftRows()
      : activeSection === "post" ? buildPostRows() : [];
  const rows = [...stageRows, ...(activeSection === "script" || activeSection === "post" ? buildRiskRows() : [])];
  const diffs = buildDiffRows();
  const done = rows.filter(row => row.level === "done").length;
  const maybe = rows.filter(row => row.level === "maybe").length;
  const missing = rows.filter(row => row.level === "missing").length;
  const score = rows.length ? Math.round(((done + maybe * 0.4) / rows.length) * 100) : 0;
  return { rows, diffs, done, maybe, missing, score };
}

function buildDiffRows() {
  const c = creator();
  const diffs = [];
  for (let i = 0; i < c.scriptRounds.length - 1; i += 1) {
    const feedbackItems = splitItems(c.scriptRounds[i].feedbackText || "");
    const nextScript = c.scriptRounds[i + 1].scriptText || "";
    const fixed = [];
    const stillMissing = [];
    feedbackItems.forEach(item => {
      const match = revisionMatch(item, nextScript);
      if (match.level === "done") fixed.push(item);
      else stillMissing.push(item);
    });
    if (fixed.length || stillMissing.length) {
      diffs.push({ from: `Script v${i + 1}`, to: `Script v${i + 2}`, fixed, stillMissing, newIssues: [] });
    }
  }
  return diffs;
}

function renderAudit(audit) {
  lastAudit = audit;
  const verdict = audit.rows.length === 0 ? "暂无可审" : audit.missing === 0 && audit.maybe === 0 ? "修改已落实" : audit.missing === 0 ? "需要人工确认" : "仍需修改";
  el("verdict").textContent = verdict;
  el("scoreRing").textContent = audit.rows.length ? `${audit.score}%` : "--";
  el("scoreRing").style.background = `conic-gradient(var(--accent) ${audit.score * 3.6}deg, #eef1f3 0deg)`;
  el("doneCount").textContent = audit.done;
  el("maybeCount").textContent = audit.maybe;
  el("missingCount").textContent = audit.missing;
  el("summary").textContent = `${project().name} / ${creator().name}`;
  renderChecklist(audit);
  const rows = audit.rows.filter(row => activeFilter === "all" || row.level === activeFilter);
  el("auditTable").innerHTML = `
    <div class="table-head">
      <span>上一版客户意见</span>
      <span>落实状态</span>
      <span>核对说明</span>
    </div>
    ${rows.length ? rows.map((row, index) => `
      <div class="table-row ${row.level}">
        <div class="requirement"><strong>${index + 1}. ${esc(row.requirement)}</strong><small>${row.source}</small></div>
        <div><span class="status ${row.level}">${statusText(row.level)}</span></div>
        <div class="comment">${esc(row.comment)}<small>核对依据：${esc(row.evidence || "暂无")}</small></div>
      </div>
    `).join("") : `<div class="empty">当前筛选下没有结果。</div>`}
  `;
}

function renderChecklist(audit) {
  const countBy = category => {
    const items = audit.rows.filter(row => row.category === category);
    return `${items.filter(row => row.level === "done").length}/${items.length || 0}`;
  };
  const riskRows = audit.rows.filter(row => row.category === "Risk");
  const firstDiff = audit.diffs[0];
  const overallStatus = audit.missing ? "仍需修改" : audit.maybe ? "待人工确认" : "已落实";
  el("reviewChecklist").innerHTML = `
    <div class="checklist-section">
      <h3>Overall</h3>
      <div class="overall-line"><strong>${audit.score}</strong><span>${overallStatus}</span></div>
    </div>
    <div class="checklist-section">
      <h3>Mandatory</h3>
      <p>${countBy("Mandatory")}</p>
    </div>
    <div class="checklist-section">
      <h3>Brand</h3>
      <p>${countBy("Brand")}</p>
    </div>
    <div class="checklist-section">
      <h3>Risk</h3>
      <p>${riskRows.length ? `${riskRows.length} item(s)` : "No Risk"}</p>
    </div>
    ${firstDiff ? `<div class="checklist-section diff-box">
      <h3>Diff: ${esc(firstDiff.from)} → ${esc(firstDiff.to)}</h3>
      <p>Fixed: ${esc(firstDiff.fixed.slice(0, 3).join(" / ") || "-")}</p>
      <p>Still Missing: ${esc(firstDiff.stillMissing.slice(0, 3).join(" / ") || "-")}</p>
    </div>` : ""}
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
  if (target.classList.contains("tree-project-btn") || target.classList.contains("tree-brief")) {
    activeProjectId = target.dataset.projectId;
    activeCreatorId = project().creators[0].id;
    activeView = "project";
    activeSection = "brief";
    return renderAll();
  }
  if (target.classList.contains("creator-switch")) {
    activeProjectId = target.dataset.projectId;
    activeCreatorId = target.dataset.creatorId;
    lastAudit = null;
    return renderAll();
  }
  if (target.classList.contains("tree-creator-btn") || target.classList.contains("tree-stage")) {
    activeProjectId = target.dataset.projectId;
    activeCreatorId = target.dataset.creatorId;
    activeView = "project";
    if (target.dataset.section) activeSection = target.dataset.section;
    return renderAll();
  }
  if (target.classList.contains("tree-add-creator")) {
    activeProjectId = target.dataset.projectId;
    return addCreator();
  }
  if (target.classList.contains("rename-project")) {
    const treeProject = state.projects.find(item => item.id === target.dataset.projectId);
    const name = prompt("修改项目名称", treeProject.name);
    if (name) treeProject.name = name.trim();
    return renderAll();
  }
  if (target.classList.contains("delete-project")) return deleteProject(target.dataset.projectId);
  if (target.classList.contains("rename-creator")) {
    activeProjectId = target.dataset.projectId;
    const treeCreator = project().creators.find(item => item.id === target.dataset.creatorId);
    const name = prompt("修改博主名称", treeCreator.name);
    if (name) treeCreator.name = name.trim();
    return renderAll();
  }
  if (target.classList.contains("delete-creator")) {
    activeProjectId = target.dataset.projectId;
    return deleteCreator(target.dataset.creatorId);
  }
  if (target.classList.contains("project-card-open")) {
    activeProjectId = target.dataset.projectId;
    activeCreatorId = project().creators[0].id;
    activeView = "project";
    return renderAll();
  }
  if (target.classList.contains("overview-creator-row")) {
    activeProjectId = target.dataset.projectId;
    activeCreatorId = target.dataset.creatorId;
    activeView = "project";
    activeSection = "script";
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
  if (target.id === "reviewRules") project().reviewRules = target.value;
  if (target.classList.contains("script-text")) creator().scriptRounds[Number(target.dataset.index)].scriptText = target.value;
  if (target.classList.contains("script-feedback")) creator().scriptRounds[Number(target.dataset.index)].feedbackText = target.value;
  if (target.classList.contains("draft-feedback")) creator().draftRounds[Number(target.dataset.index)].feedbackText = target.value;
  if (target.classList.contains("post-url")) creator().posts[Number(target.dataset.index)].url = target.value;
  if (target.classList.contains("post-caption")) creator().posts[Number(target.dataset.index)].caption = target.value;
  saveState();
});

renderAll();
