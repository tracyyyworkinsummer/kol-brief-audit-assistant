const STORAGE_KEY = "kol-brief-audit-assistant.projects.v2";

const sectionOrder = ["brief", "script", "draft", "post"];
const sectionMeta = {
  brief: { title: "Brief", desc: "客户 brief 共享给同项目所有博主，可上传文件。", source: "brief", target: "brief" },
  script: { title: "Script", desc: "脚本初稿与多轮脚本反馈。", source: "brief", target: "script" },
  draft: { title: "Draft", desc: "脚本二稿/视频初稿与多轮反馈。", source: "script", target: "draft" },
  post: { title: "Post", desc: "发布链接与 caption 抓取。", source: "brief", target: "post" }
};

const stopWords = new Set([
  "需要", "要求", "必须", "可以", "一个", "这个", "那个", "进行", "不能", "不要", "客户", "博主",
  "视频", "脚本", "修改", "内容", "拍摄", "发布", "文案", "caption", "brief", "the", "and", "with"
]);
const riskWords = ["最", "第一", "唯一", "保证", "治愈", "永久", "绝对", "100%", "无敌", "全网最低", "立刻见效"];

let state = loadState();
let activeProjectId = state.projects[0]?.id || "";
let activeSection = "brief";
let activeFilter = "all";

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultProject() {
  return {
    id: uid("project"),
    name: "项目 1",
    brief: "",
    briefFileName: "",
    scriptRounds: [{ text: "", fileName: "" }, { text: "", fileName: "" }],
    draftRounds: [{ text: "", fileName: "" }, { text: "", fileName: "" }],
    posts: [{ url: "", caption: "", captionSource: "", status: "" }]
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (parsed?.projects?.length) return parsed;
  } catch {}
  return { projects: [defaultProject()] };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function currentProject() {
  return state.projects.find(project => project.id === activeProjectId) || state.projects[0];
}

function normalize(text) {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function splitRequirements(text) {
  return (text || "")
    .split(/[\n。；;.!?？]+/)
    .map(item => item.replace(/^[-*•\d.、\s]+/, "").trim())
    .filter(item => item.length >= 4);
}

function extractTerms(text) {
  const normalized = normalize(text);
  const chinese = normalized.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  const latin = normalized.match(/[a-z0-9#@][a-z0-9#@_-]{2,}/g) || [];
  return [...chinese, ...latin]
    .map(term => term.trim())
    .filter(term => term.length >= 2 && !stopWords.has(term))
    .slice(0, 80);
}

function requirementScore(requirement, target) {
  const terms = extractTerms(requirement);
  if (!terms.length) return { score: 0, hits: [] };
  const targetText = normalize(target);
  const hits = terms.filter(term => targetText.includes(term));
  return { score: hits.length / terms.length, hits };
}

function statusFor(score) {
  if (score >= 0.7) return { text: "已修改", key: "updated" };
  if (score >= 0.35) return { text: "疑似缺失", key: "maybe" };
  return { text: "未修改", key: "missing" };
}

function el(id) {
  return document.getElementById(id);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setActiveSection(section) {
  activeSection = section;
  document.querySelectorAll(".section-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.section === section));
  sectionOrder.forEach(name => {
    el(`${name}Section`).classList.toggle("hidden", name !== section);
  });
}

function renderProjectList() {
  const list = el("projectList");
  list.innerHTML = "";
  state.projects.forEach(project => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `project-item${project.id === activeProjectId ? " active" : ""}`;
    item.innerHTML = `<strong>${escapeHtml(project.name || "未命名项目")}</strong><span>Brief 共享 / 多轮脚本 / 多条链接</span>`;
    item.addEventListener("click", () => {
      syncCurrentProjectFromDom();
      activeProjectId = project.id;
      renderAll();
    });
    list.appendChild(item);
  });
}

function renderBriefSection() {
  const project = currentProject();
  el("briefSection").innerHTML = `
    <div class="section-head">
      <div>
        <h2>Brief</h2>
        <p>${sectionMeta.brief.desc}</p>
      </div>
      <label class="file-button">
        上传文件
        <input id="briefFile" type="file" accept=".txt,.md,.csv,.json,.srt,.vtt,.doc,.docx,.pdf">
      </label>
    </div>
    <textarea id="briefText" placeholder="粘贴 brief、必提卖点、禁用词、镜头要求、caption 要求...">${escapeHtml(project.brief)}</textarea>
    <p id="fileStatus" class="file-status">${project.briefFileName ? `已读取：${escapeHtml(project.briefFileName)}` : ""}</p>
  `;
}

function renderRoundSection(section) {
  const project = currentProject();
  const rounds = project[`${section}Rounds`];
  const title = sectionMeta[section].title;
  const desc = sectionMeta[section].desc;
  const list = rounds.map((round, index) => `
    <article class="round-card" data-index="${index}">
      <div class="round-title">
        <div>
          <strong>第 ${index + 1} 轮</strong>
          <span>${title} 第 ${index + 1} 稿 / 反馈</span>
        </div>
        ${rounds.length > 1 ? `<button class="ghost remove-round" type="button" data-index="${index}" data-section="${section}">删除</button>` : ""}
      </div>
      <div class="round-grid">
        <label>
          <span>${title} 稿件</span>
          <textarea class="round-text" data-section="${section}" data-index="${index}" placeholder="粘贴${title}稿件...">${escapeHtml(round.text || "")}</textarea>
        </label>
        <label>
          <span>上传文件</span>
          <div class="inline-file">
            <label class="file-button compact">
              选择文件
              <input class="round-file" data-section="${section}" data-index="${index}" type="file" accept=".txt,.md,.csv,.json,.srt,.vtt,.doc,.docx,.pdf">
            </label>
            <span class="file-status">${round.fileName ? escapeHtml(round.fileName) : "未上传"}</span>
          </div>
        </label>
      </div>
    </article>
  `).join("");

  el(`${section}Section`).innerHTML = `
    <div class="section-head">
      <div>
        <h2>${title}</h2>
        <p>${desc}</p>
      </div>
      <button id="${section}AddRound" type="button">添加一轮</button>
    </div>
    <div class="rounds">${list}</div>
  `;
}

function renderPostSection() {
  const project = currentProject();
  const cards = project.posts.map((post, index) => `
    <article class="post-card" data-index="${index}">
      <div class="round-title">
        <div>
          <strong>链接 ${index + 1}</strong>
          <span>输入发布链接并抓取 caption</span>
        </div>
        ${project.posts.length > 1 ? `<button class="ghost remove-post" type="button" data-index="${index}">删除</button>` : ""}
      </div>
      <label>
        <span>发布链接</span>
        <input class="post-url" data-index="${index}" type="url" placeholder="粘贴发布链接..." value="${escapeHtml(post.url || "")}">
      </label>
      <div class="post-tools">
        <button class="capture-btn" data-index="${index}" type="button">抓取 caption</button>
        <span class="file-status">${post.captionSource ? escapeHtml(post.captionSource) : "等待抓取或手动粘贴"}</span>
      </div>
      <label>
        <span>Caption</span>
        <textarea class="post-caption" data-index="${index}" placeholder="抓取失败时可手动粘贴 caption...">${escapeHtml(post.caption || "")}</textarea>
      </label>
    </article>
  `).join("");

  el("postSection").innerHTML = `
    <div class="section-head">
      <div>
        <h2>Post</h2>
        <p>${sectionMeta.post.desc}</p>
      </div>
      <button id="addPostBtn" type="button">新增链接</button>
    </div>
    <div class="post-list">${cards}</div>
  `;
}

function renderAll() {
  renderProjectList();
  renderBriefSection();
  renderRoundSection("script");
  renderRoundSection("draft");
  renderPostSection();
  setActiveSection(activeSection);
  bindDynamicEvents();
  resetResults();
  saveState();
}

function syncCurrentProjectFromDom() {
  const project = currentProject();
  if (!project) return;
  const briefText = el("briefText");
  if (briefText) project.brief = briefText.value;
  const fileStatus = el("fileStatus");
  if (fileStatus && fileStatus.textContent.startsWith("已读取：")) {
    project.briefFileName = fileStatus.textContent.replace("已读取：", "");
  }
  ["script", "draft"].forEach(section => {
    document.querySelectorAll(`.${section}-sync`).forEach(() => {});
    project[`${section}Rounds`].forEach((round, index) => {
      const text = document.querySelector(`.round-text[data-section="${section}"][data-index="${index}"]`);
      if (text) round.text = text.value;
    });
  });
  project.posts.forEach((post, index) => {
    const url = document.querySelector(`.post-url[data-index="${index}"]`);
    const cap = document.querySelector(`.post-caption[data-index="${index}"]`);
    if (url) post.url = url.value;
    if (cap) post.caption = cap.value;
  });
}

function bindDynamicEvents() {
  document.querySelectorAll(".section-tab").forEach(btn => {
    btn.addEventListener("click", () => setActiveSection(btn.dataset.section));
  });

  const project = currentProject();

  const briefFile = el("briefFile");
  briefFile?.addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      project.brief = await readFileLike(file);
      project.briefFileName = file.name;
      el("briefText").value = project.brief;
      el("fileStatus").textContent = `已读取：${file.name}`;
      saveState();
    } catch {
      el("fileStatus").textContent = "文件读取失败，请复制内容后粘贴。";
    }
  });

  el("addProjectBtn").onclick = () => {
    syncCurrentProjectFromDom();
    const next = defaultProject();
    next.name = `项目 ${state.projects.length + 1}`;
    state.projects.push(next);
    activeProjectId = next.id;
    renderAll();
  };

  el("addRoundBtn")?.remove();
  el("scriptAddRound")?.addEventListener("click", () => addRound("script"));
  el("draftAddRound")?.addEventListener("click", () => addRound("draft"));
  el("addPostBtn")?.addEventListener("click", () => addPost());

  document.querySelectorAll(".remove-round").forEach(btn => {
    btn.addEventListener("click", () => {
      syncCurrentProjectFromDom();
      removeRound(btn.dataset.section, Number(btn.dataset.index));
    });
  });

  document.querySelectorAll(".round-text").forEach(textarea => {
    textarea.addEventListener("input", () => {
      const sec = textarea.dataset.section;
      const idx = Number(textarea.dataset.index);
      currentProject()[`${sec}Rounds`][idx].text = textarea.value;
      saveState();
    });
  });

  document.querySelectorAll(".round-file").forEach(input => {
    input.addEventListener("change", async event => {
      const file = event.target.files[0];
      if (!file) return;
      const sec = input.dataset.section;
      const idx = Number(input.dataset.index);
      const text = await readFileLike(file);
      const round = currentProject()[`${sec}Rounds`][idx];
      round.text = text;
      round.fileName = file.name;
      renderAll();
    });
  });

  document.querySelectorAll(".post-url").forEach(input => {
    input.addEventListener("input", () => {
      currentProject().posts[Number(input.dataset.index)].url = input.value;
      saveState();
    });
  });

  document.querySelectorAll(".post-caption").forEach(textarea => {
    textarea.addEventListener("input", () => {
      currentProject().posts[Number(textarea.dataset.index)].caption = textarea.value;
      saveState();
    });
  });

  document.querySelectorAll(".capture-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.index);
      const post = currentProject().posts[idx];
      post.captionSource = "抓取中...";
      renderAll();
      try {
        const result = await fetchCaption(post.url);
        post.caption = result.caption || post.caption;
        post.captionSource = result.source;
      } catch (error) {
        post.captionSource = "抓取失败，请手动粘贴 caption";
      }
      renderAll();
    });
  });

  document.querySelectorAll(".remove-post").forEach(btn => {
    btn.addEventListener("click", () => {
      syncCurrentProjectFromDom();
      const project = currentProject();
      project.posts.splice(Number(btn.dataset.index), 1);
      if (!project.posts.length) project.posts.push({ url: "", caption: "", captionSource: "", status: "" });
      renderAll();
    });
  });

  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter;
      document.querySelectorAll(".filter-btn").forEach(item => item.classList.toggle("active", item === btn));
      renderAudit(lastAudit);
    });
  });
}

function addRound(section) {
  syncCurrentProjectFromDom();
  currentProject()[`${section}Rounds`].push({ text: "", fileName: "" });
  renderAll();
}

function removeRound(section, index) {
  const rounds = currentProject()[`${section}Rounds`];
  rounds.splice(index, 1);
  if (!rounds.length) rounds.push({ text: "", fileName: "" });
  renderAll();
}

function addPost() {
  syncCurrentProjectFromDom();
  currentProject().posts.push({ url: "", caption: "", captionSource: "", status: "" });
  renderAll();
}

async function readFileLike(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf") || lower.endsWith(".docx") || lower.endsWith(".doc")) {
    return `【已上传文件：${file.name}】请手动粘贴文本内容。`;
  }
  return await file.text();
}

function collectLatest(section) {
  const project = currentProject();
  const rounds = project[`${section}Rounds`];
  const last = [...rounds].reverse().find(item => normalize(item.text));
  return last?.text || "";
}

function buildPostText() {
  const captions = currentProject().posts.map(post => post.caption || "").filter(Boolean);
  return captions.join("\n");
}

function buildAudit() {
  const project = currentProject();
  const checks = [];
  const sources = {
    brief: project.brief || "",
    script: project.brief || "",
    draft: collectLatest("script") || "",
    post: project.brief || ""
  };
  const targets = {
    brief: project.brief || "",
    script: collectLatest("script") || "",
    draft: collectLatest("draft") || "",
    post: buildPostText() || ""
  };

  const modeChecks = [
    { section: "brief", source: sources.brief, target: targets.brief },
    { section: "script", source: sources.script, target: targets.script },
    { section: "draft", source: sources.draft, target: targets.draft },
    { section: "post", source: sources.post, target: targets.post }
  ];

  modeChecks.forEach(({ section, source, target }) => {
    splitRequirements(source).forEach(requirement => {
      const result = requirementScore(requirement, target);
      const status = statusFor(result.score);
      checks.push({
        section,
        requirement,
        score: result.score,
        hits: result.hits,
        status
      });
    });
  });

  const targetText = normalize(targets.post + "\n" + targets.draft + "\n" + targets.script);
  riskWords.forEach(word => {
    if (targetText.includes(word.toLowerCase())) {
      checks.push({
        section: "post",
        requirement: `风险表达检查：${word}`,
        score: 0,
        hits: [word],
        status: { text: "疑似缺失", key: "maybe" },
        risk: true
      });
    }
  });

  const updated = checks.filter(item => item.status.key === "updated").length;
  const maybe = checks.filter(item => item.status.key === "maybe").length;
  const missing = checks.filter(item => item.status.key === "missing").length;
  const total = Math.max(checks.filter(item => !item.risk).length, 1);
  const score = Math.round(((updated + maybe * 0.5) / total) * 100);

  return { checks, updated, maybe, missing, score, project };
}

let lastAudit = null;
let listenersBound = false;

function renderAudit(audit) {
  lastAudit = audit;
  const verdict = audit.score >= 80 && audit.missing === 0 ? "基本通过" : audit.score >= 55 ? "需要小改" : "建议返修";
  el("verdict").textContent = verdict;
  const ring = el("scoreRing");
  ring.textContent = `${audit.score}%`;
  ring.style.background = `conic-gradient(var(--accent) ${audit.score * 3.6}deg, #e9eef0 0deg)`;

  el("summary").textContent =
    `当前项目“${audit.project.name}”共识别 ${audit.checks.filter(x => !x.risk).length} 条要求，已修改 ${audit.updated} 条，疑似缺失 ${audit.maybe} 条，未修改 ${audit.missing} 条。`;

  const checks = audit.checks.filter(item => activeFilter === "all" || item.status.key === activeFilter);
  const box = el("checks");
  box.innerHTML = checks.length
    ? checks.map(item => `
      <div class="check-item ${item.status.key}">
        <div class="check-head">
          <span>${escapeHtml(item.requirement)}</span>
          <span class="tag ${item.status.key}">${item.status.text}</span>
        </div>
        <p>${item.hits.length ? `命中关键词：${escapeHtml(item.hits.join("、"))}` : "未在目标内容中找到明显对应表达。"}</p>
      </div>
    `).join("")
    : `<div class="check-item"><p>当前筛选条件下没有结果。</p></div>`;

  el("feedbackOutput").value = buildFeedback(audit, verdict);
}

function buildFeedback(audit, verdict) {
  const lines = [
    `项目：${audit.project.name}`,
    `结论：${verdict}，覆盖率约 ${audit.score}%。`,
    ""
  ];
  const missing = audit.checks.filter(item => item.status.key === "missing");
  const maybe = audit.checks.filter(item => item.status.key === "maybe");
  if (missing.length) {
    lines.push("未修改：");
    missing.slice(0, 12).forEach((item, index) => lines.push(`${index + 1}. ${item.requirement}`));
  }
  if (maybe.length) {
    lines.push("", "疑似缺失：");
    maybe.slice(0, 12).forEach((item, index) => lines.push(`${index + 1}. ${item.requirement}`));
  }
  if (!missing.length && !maybe.length) lines.push("主要要求已覆盖。");
  lines.push("", "建议：请补齐对应镜头/口播/caption，并再次人工复核。");
  return lines.join("\n");
}

function resetResults() {
  lastAudit = null;
  el("checks").innerHTML = "";
  el("feedbackOutput").value = "";
  el("summary").textContent = "录入资料后点击“开始审核”，这里会显示覆盖率、缺失要点、疑似未修改项和建议反馈话术。";
  el("verdict").textContent = "待审核";
  el("scoreRing").textContent = "--";
  el("scoreRing").style.background = "conic-gradient(var(--accent) 0deg, #e9eef0 0deg)";
}

async function fetchCaption(url) {
  if (!url) throw new Error("missing url");
  const normalizedUrl = url.trim();
  const candidates = [
    normalizedUrl,
    `https://r.jina.ai/http://${normalizedUrl.replace(/^https?:\/\//, "")}`,
    `https://r.jina.ai/https://${normalizedUrl.replace(/^https?:\/\//, "")}`
  ];

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { mode: "cors" });
      const text = await response.text();
      const caption = extractCaptionFromHtml(text);
      if (caption) {
        return { caption, source: candidate === normalizedUrl ? "直连抓取" : "代理抓取" };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("fetch failed");
}

function extractCaptionFromHtml(html) {
  const titleMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  if (titleMatch?.[1]) return decodeEntities(titleMatch[1].trim());
  const captionMatch = html.match(/caption["':=]\s*["']([^"']{10,1000})["']/i);
  if (captionMatch?.[1]) return decodeEntities(captionMatch[1].trim());
  return "";
}

function decodeEntities(text) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}

el("sampleBtn").addEventListener("click", () => {
  syncCurrentProjectFromDom();
  const project = currentProject();
  project.name = "护肤项目 A";
  project.brief = [
    "必须露出品牌名 GlowLab 和新品水光精华。",
    "需要说明三大卖点：轻薄不粘、妆前可用、适合熬夜后急救。",
    "开头 3 秒需要出现产品近景。",
    "Caption 需包含 #GlowLab #水光精华，并提示 8/1-8/15 活动。禁止使用治愈、永久、全网最低。"
  ].join("\n");
  project.scriptRounds = [
    { text: "开头拿起 GlowLab 水光精华做近景。\n讲熬夜后皮肤暗沉，使用后肤感轻薄不粘，早上妆前也可以用。", fileName: "" },
    { text: "今天分享 GlowLab 水光精华，质地轻薄不粘，熬夜后急救很适合，妆前也能用。", fileName: "" }
  ];
  project.draftRounds = [
    { text: "第一版视频口播和脚本初稿一致，开头已露出产品近景。", fileName: "" },
    { text: "修改后视频增加了活动信息和品牌露出。", fileName: "" }
  ];
  project.posts = [
    { url: "https://example.com/post-1", caption: "GlowLab 水光精华，#GlowLab #水光精华，8/1-8/15 活动中。", captionSource: "示例", status: "" }
  ];
  renderAll();
});

el("clearBtn").addEventListener("click", () => {
  const project = currentProject();
  project.brief = "";
  project.briefFileName = "";
  project.scriptRounds = [{ text: "", fileName: "" }, { text: "", fileName: "" }];
  project.draftRounds = [{ text: "", fileName: "" }, { text: "", fileName: "" }];
  project.posts = [{ url: "", caption: "", captionSource: "", status: "" }];
  renderAll();
});

el("addProjectBtn").addEventListener("click", () => {
  syncCurrentProjectFromDom();
  const next = defaultProject();
  next.name = `项目 ${state.projects.length + 1}`;
  state.projects.push(next);
  activeProjectId = next.id;
  renderAll();
});

el("auditBtn").addEventListener("click", () => {
  syncCurrentProjectFromDom();
  renderAudit(buildAudit());
});

el("copyBtn").addEventListener("click", async () => {
  if (!lastAudit) return;
  await navigator.clipboard.writeText(el("feedbackOutput").value);
  el("copyBtn").textContent = "已复制";
  setTimeout(() => el("copyBtn").textContent = "复制审核结论", 1200);
});

document.addEventListener("click", event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.classList.contains("remove-post")) {
    syncCurrentProjectFromDom();
    const project = currentProject();
    project.posts.splice(Number(target.dataset.index), 1);
    if (!project.posts.length) project.posts.push({ url: "", caption: "", captionSource: "", status: "" });
    renderAll();
  }
});

function bindStaticTabs() {
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter;
      document.querySelectorAll(".filter-btn").forEach(item => item.classList.toggle("active", item === btn));
      if (lastAudit) renderAudit(lastAudit);
    });
  });
}

function hydrateEditableFields() {
  const briefText = el("briefText");
  briefText?.addEventListener("input", () => {
    currentProject().brief = briefText.value;
    saveState();
  });

  document.querySelectorAll(".section-tab").forEach(btn => {
    btn.addEventListener("click", () => setActiveSection(btn.dataset.section));
  });

  document.querySelectorAll(".round-text").forEach(textarea => {
    textarea.addEventListener("input", () => {
      currentProject()[`${textarea.dataset.section}Rounds`][Number(textarea.dataset.index)].text = textarea.value;
      saveState();
    });
  });

  document.querySelectorAll(".post-url").forEach(input => {
    input.addEventListener("input", () => {
      currentProject().posts[Number(input.dataset.index)].url = input.value;
      saveState();
    });
  });

  document.querySelectorAll(".post-caption").forEach(textarea => {
    textarea.addEventListener("input", () => {
      currentProject().posts[Number(textarea.dataset.index)].caption = textarea.value;
      saveState();
    });
  });
}

async function initFileInputs() {
  document.querySelectorAll(".round-file").forEach(input => {
    input.addEventListener("change", async event => {
      const file = event.target.files[0];
      if (!file) return;
      const text = await readFileLike(file);
      const sec = input.dataset.section;
      const idx = Number(input.dataset.index);
      const round = currentProject()[`${sec}Rounds`][idx];
      round.text = text;
      round.fileName = file.name;
      renderAll();
    });
  });

  const briefFile = el("briefFile");
  briefFile?.addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    const text = await readFileLike(file);
    const project = currentProject();
    project.brief = text;
    project.briefFileName = file.name;
    renderAll();
  });
}

async function readFileLike(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf") || lower.endsWith(".docx") || lower.endsWith(".doc")) {
    return `【已上传文件：${file.name}】请手动粘贴文本内容。`;
  }
  return await file.text();
}

function bindRoundActions() {
  document.querySelectorAll(".remove-round").forEach(btn => {
    btn.addEventListener("click", () => {
      syncCurrentProjectFromDom();
      removeRound(btn.dataset.section, Number(btn.dataset.index));
    });
  });
  el("scriptAddRound")?.addEventListener("click", () => addRound("script"));
  el("draftAddRound")?.addEventListener("click", () => addRound("draft"));
  el("addPostBtn")?.addEventListener("click", () => addPost());
}

function bindCaptureButtons() {
  document.querySelectorAll(".capture-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.index);
      const post = currentProject().posts[idx];
      post.captionSource = "抓取中...";
      renderAll();
      try {
        const result = await fetchCaption(post.url);
        post.caption = result.caption || post.caption;
        post.captionSource = result.source;
      } catch {
        post.captionSource = "抓取失败，请手动粘贴 caption";
      }
      renderAll();
    });
  });
}

function bindDynamicEvents() {
  if (listenersBound) return;
  listenersBound = true;

  document.addEventListener("click", async event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.classList.contains("section-tab")) {
      setActiveSection(target.dataset.section);
      return;
    }
    if (target.classList.contains("filter-btn")) {
      activeFilter = target.dataset.filter;
      document.querySelectorAll(".filter-btn").forEach(item => item.classList.toggle("active", item === target));
      if (lastAudit) renderAudit(lastAudit);
      return;
    }
    if (target.id === "scriptAddRound") return addRound("script");
    if (target.id === "draftAddRound") return addRound("draft");
    if (target.id === "addPostBtn") return addPost();
    if (target.classList.contains("remove-round")) {
      syncCurrentProjectFromDom();
      removeRound(target.dataset.section, Number(target.dataset.index));
      return;
    }
    if (target.classList.contains("capture-btn")) {
      const idx = Number(target.dataset.index);
      const post = currentProject().posts[idx];
      post.captionSource = "抓取中...";
      renderAll();
      try {
        const result = await fetchCaption(post.url);
        post.caption = result.caption || post.caption;
        post.captionSource = result.source;
      } catch {
        post.captionSource = "抓取失败，请手动粘贴 caption";
      }
      renderAll();
      return;
    }
    if (target.classList.contains("remove-post")) {
      syncCurrentProjectFromDom();
      const project = currentProject();
      project.posts.splice(Number(target.dataset.index), 1);
      if (!project.posts.length) project.posts.push({ url: "", caption: "", captionSource: "", status: "" });
      renderAll();
      return;
    }
  });

  document.addEventListener("input", event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === "briefText") {
      currentProject().brief = target.value;
      saveState();
      return;
    }
    if (target.classList.contains("round-text")) {
      currentProject()[`${target.dataset.section}Rounds`][Number(target.dataset.index)].text = target.value;
      saveState();
      return;
    }
    if (target.classList.contains("post-url")) {
      currentProject().posts[Number(target.dataset.index)].url = target.value;
      saveState();
      return;
    }
    if (target.classList.contains("post-caption")) {
      currentProject().posts[Number(target.dataset.index)].caption = target.value;
      saveState();
    }
  });

  document.addEventListener("change", async event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    if (target.id === "briefFile") {
      const file = target.files?.[0];
      if (!file) return;
      const text = await readFileLike(file);
      const project = currentProject();
      project.brief = text;
      project.briefFileName = file.name;
      renderAll();
      return;
    }
    if (target.classList.contains("round-file")) {
      const file = target.files?.[0];
      if (!file) return;
      const text = await readFileLike(file);
      const sec = target.dataset.section;
      const idx = Number(target.dataset.index);
      const round = currentProject()[`${sec}Rounds`][idx];
      round.text = text;
      round.fileName = file.name;
      renderAll();
    }
  });
}

renderAll();
bindStaticTabs();
saveState();
