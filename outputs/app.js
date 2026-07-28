const modes = {
  scriptBrief: {
    label: "脚本对 Brief",
    source: "brief",
    target: "latestScript",
    summary: "检查当前脚本是否覆盖 brief 中的必提要点、限制项和内容结构。"
  },
  scriptFeedback: {
    label: "脚本改稿",
    source: "latestFeedback",
    target: "latestScript",
    summary: "检查最新脚本是否落实上一轮脚本反馈中的新增、删除、调整要求。"
  },
  draftScript: {
    label: "视频初稿",
    source: "previousScript",
    target: "latestScript",
    summary: "检查待审核内容是否与上一版确认脚本一致，是否缺少关键镜头或话术。"
  },
  revisionFeedback: {
    label: "视频修改稿",
    source: "latestFeedback",
    target: "latestScript",
    summary: "检查修改稿是否解决上一轮客户意见。"
  },
  captionBrief: {
    label: "Caption",
    source: "brief",
    target: "latestScript",
    summary: "检查发布 caption 是否包含品牌、卖点、活动、话题标签和禁用表达风险。"
  }
};

let activeMode = "scriptBrief";
let rounds = [
  { script: "", feedback: "" },
  { script: "", feedback: "" }
];

const stopWords = new Set([
  "需要", "要求", "必须", "可以", "一个", "这个", "那个", "进行", "不能", "不要", "客户", "博主",
  "视频", "脚本", "修改", "内容", "拍摄", "发布", "文案", "caption", "brief", "the", "and", "with"
]);
const riskWords = ["最", "第一", "唯一", "保证", "治愈", "永久", "绝对", "100%", "无敌", "全网最低", "立刻见效"];

function el(id) {
  return document.getElementById(id);
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
  if (score >= 0.7) return { text: "已覆盖", cls: "ok" };
  if (score >= 0.35) return { text: "部分覆盖", cls: "warn" };
  return { text: "疑似缺失", cls: "bad" };
}

function syncRoundsFromDom() {
  document.querySelectorAll(".round-card").forEach(card => {
    const index = Number(card.dataset.index);
    rounds[index].script = card.querySelector(".script-input").value;
    rounds[index].feedback = card.querySelector(".feedback-input").value;
  });
}

function renderRounds() {
  const container = el("rounds");
  container.innerHTML = "";

  rounds.forEach((round, index) => {
    const card = document.createElement("article");
    card.className = "round-card";
    card.dataset.index = index;
    const scriptLabel = index === 0 ? "脚本初稿" : `脚本第 ${index + 1} 稿`;
    const feedbackLabel = index === 0 ? "一轮脚本反馈" : `第 ${index + 1} 轮脚本反馈`;
    const removeButton = rounds.length > 2
      ? `<button class="ghost remove-round" type="button" data-index="${index}">删除</button>`
      : "";

    card.innerHTML = `
      <div class="round-title">
        <div>
          <strong>第 ${index + 1} 轮</strong>
          <span>${scriptLabel} / ${feedbackLabel}</span>
        </div>
        ${removeButton}
      </div>
      <div class="round-grid">
        <label>
          <span>${scriptLabel}</span>
          <textarea class="script-input" placeholder="粘贴${scriptLabel}...">${escapeHtml(round.script)}</textarea>
        </label>
        <label>
          <span>${feedbackLabel}</span>
          <textarea class="feedback-input" placeholder="粘贴客户/内部反馈；没有则留空...">${escapeHtml(round.feedback)}</textarea>
        </label>
      </div>
    `;
    container.appendChild(card);
  });

  document.querySelectorAll(".remove-round").forEach(button => {
    button.addEventListener("click", event => {
      syncRoundsFromDom();
      rounds.splice(Number(event.currentTarget.dataset.index), 1);
      renderRounds();
    });
  });
}

function getAuditTexts() {
  syncRoundsFromDom();
  const brief = el("briefText").value;
  const latestRound = [...rounds].reverse().find(round => normalize(round.script)) || rounds[rounds.length - 1];
  const previousRound = [...rounds].slice(0, -1).reverse().find(round => normalize(round.script)) || rounds[0];
  const latestFeedbackRound = [...rounds].reverse().find(round => normalize(round.feedback)) || rounds[0];

  return {
    brief,
    latestScript: latestRound?.script || "",
    previousScript: previousRound?.script || "",
    latestFeedback: latestFeedbackRound?.feedback || ""
  };
}

function buildAudit() {
  const mode = modes[activeMode];
  const values = getAuditTexts();
  const source = values[mode.source];
  const target = values[mode.target];
  const requirements = splitRequirements(source);
  const checks = requirements.map(requirement => {
    const result = requirementScore(requirement, target);
    return { requirement, ...result, status: statusFor(result.score) };
  });

  const targetText = normalize(target);
  const risks = riskWords.filter(word => targetText.includes(word.toLowerCase()));
  risks.forEach(word => {
    checks.push({
      requirement: `风险表达检查：${word}`,
      score: 0,
      hits: [word],
      status: { text: "需人工确认", cls: "warn" },
      risk: true
    });
  });

  const covered = checks.filter(item => !item.risk && item.score >= 0.7).length;
  const partial = checks.filter(item => !item.risk && item.score >= 0.35 && item.score < 0.7).length;
  const missing = checks.filter(item => !item.risk && item.score < 0.35).length;
  const baseCount = Math.max(requirements.length, 1);
  const score = Math.round(((covered + partial * 0.5) / baseCount) * 100);

  return { mode, checks, risks, covered, partial, missing, score, requirements };
}

function renderAudit(audit) {
  const verdict = audit.score >= 80 && !audit.risks.length
    ? "基本通过"
    : audit.score >= 55
      ? "需要小改"
      : "建议返修";

  el("verdict").textContent = verdict;
  const ring = el("scoreRing");
  ring.textContent = `${audit.score}%`;
  ring.style.background = `conic-gradient(var(--accent) ${audit.score * 3.6}deg, #e9eef0 0deg)`;
  el("summary").textContent =
    `${audit.mode.summary} 当前识别到 ${audit.requirements.length} 条要求，已覆盖 ${audit.covered} 条，部分覆盖 ${audit.partial} 条，疑似缺失 ${audit.missing} 条。` +
    (audit.risks.length ? ` 另发现 ${audit.risks.length} 个夸张或合规风险表达，建议人工确认。` : "");

  const checks = el("checks");
  checks.innerHTML = "";
  if (!audit.checks.length) {
    checks.innerHTML = `<div class="check-item"><p>没有识别到可检查的要求。请把 brief 或反馈拆成更明确的条目。</p></div>`;
  } else {
    audit.checks.forEach(item => {
      const node = document.createElement("div");
      node.className = "check-item";
      node.innerHTML = `
        <div class="check-head">
          <span>${escapeHtml(item.requirement)}</span>
          <span class="tag ${item.status.cls}">${item.status.text}</span>
        </div>
        <p>${item.hits.length ? `命中关键词：${escapeHtml(item.hits.join("、"))}` : "未在待审核内容中找到明显对应表达。"}</p>
      `;
      checks.appendChild(node);
    });
  }

  el("feedbackOutput").value = buildFeedback(audit, verdict);
}

function buildFeedback(audit, verdict) {
  const missing = audit.checks.filter(item => !item.risk && item.score < 0.7);
  const lines = [
    `审核类型：${audit.mode.label}`,
    `结论：${verdict}，覆盖率约 ${audit.score}%。`,
    ""
  ];

  if (missing.length) {
    lines.push("需要补充/确认：");
    missing.slice(0, 12).forEach((item, index) => lines.push(`${index + 1}. ${item.requirement}`));
  } else {
    lines.push("主要 brief/客户意见已基本覆盖，可进入下一步人工复核。");
  }

  if (audit.risks.length) {
    lines.push("", `合规风险词：${audit.risks.join("、")}。建议替换为更客观、可证明的表达。`);
  }

  lines.push("", "建议反馈：请根据以上缺失项补充对应镜头/口播/caption 信息，并避免夸张或无法证明的表述。");
  return lines.join("\n");
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadSample() {
  el("briefText").value = [
    "必须露出品牌名 GlowLab 和新品水光精华。",
    "需要说明三大卖点：轻薄不粘、妆前可用、适合熬夜后急救。",
    "开头 3 秒需要出现产品近景。",
    "Caption 需包含 #GlowLab #水光精华，并提示 8/1-8/15 活动。禁止使用治愈、永久、全网最低。"
  ].join("\n");
  rounds = [
    {
      script: "开头拿起 GlowLab 水光精华做近景。\n讲熬夜后皮肤暗沉，使用后肤感轻薄不粘，早上妆前也可以用。",
      feedback: "客户要求补充产品近景要在前 3 秒。\n删除“立刻见效”。\nCaption 加上活动时间和两个指定 hashtag。"
    },
    {
      script: "今天分享 GlowLab 水光精华，质地轻薄不粘，熬夜后急救很适合，妆前也能用。\n8/1-8/15 有活动，#GlowLab #水光精华。",
      feedback: ""
    }
  ];
  renderRounds();
  el("fileStatus").textContent = "";
}

function resetResults() {
  el("checks").innerHTML = "";
  el("feedbackOutput").value = "";
  el("summary").textContent = "录入资料后点击“开始审核”，这里会显示覆盖率、缺失要点、疑似未修改项和建议反馈话术。";
  el("verdict").textContent = "待审核";
  el("scoreRing").textContent = "--";
  el("scoreRing").style.background = "conic-gradient(var(--accent) 0deg, #e9eef0 0deg)";
}

document.querySelectorAll(".mode-card").forEach(button => {
  button.addEventListener("click", event => {
    activeMode = event.currentTarget.dataset.mode;
    document.querySelectorAll(".mode-card").forEach(item => item.classList.remove("active"));
    event.currentTarget.classList.add("active");
  });
});

el("addRoundBtn").addEventListener("click", () => {
  syncRoundsFromDom();
  rounds.push({ script: "", feedback: "" });
  renderRounds();
});
el("auditBtn").addEventListener("click", () => renderAudit(buildAudit()));
el("sampleBtn").addEventListener("click", loadSample);
el("clearBtn").addEventListener("click", () => {
  el("briefText").value = "";
  el("fileStatus").textContent = "";
  rounds = [{ script: "", feedback: "" }, { script: "", feedback: "" }];
  renderRounds();
  resetResults();
});
el("copyBtn").addEventListener("click", async () => {
  const text = el("feedbackOutput").value;
  if (!text) return;
  await navigator.clipboard.writeText(text);
  el("copyBtn").textContent = "已复制";
  setTimeout(() => el("copyBtn").textContent = "复制审核结论", 1200);
});
el("briefFile").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    el("briefText").value = text;
    el("fileStatus").textContent = `已读取：${file.name}`;
  } catch {
    el("fileStatus").textContent = "文件读取失败，请复制内容后粘贴。";
  }
});

renderRounds();
