const modes = {
  scriptBrief: {
    sourceA: "brief",
    sourceB: "target",
    label: "脚本覆盖 brief",
    summary: "检查博主脚本是否覆盖 brief 中的必提要点、限制项和内容结构。"
  },
  scriptFeedback: {
    sourceA: "feedback",
    sourceB: "target",
    label: "脚本按意见修改",
    summary: "检查脚本是否落实客户意见中的新增、删除、调整要求。"
  },
  draftScript: {
    sourceA: "script",
    sourceB: "target",
    label: "初稿还原确认脚本",
    summary: "检查视频初稿转写是否与确认脚本一致，是否缺少关键镜头或话术。"
  },
  revisionFeedback: {
    sourceA: "feedback",
    sourceB: "target",
    label: "修改稿按意见修改",
    summary: "检查修改稿是否解决上一轮客户 comments。"
  },
  captionBrief: {
    sourceA: "brief",
    sourceB: "target",
    label: "Caption 符合要求",
    summary: "检查发布文案是否包含品牌、卖点、活动、话题标签和禁用表达风险。"
  }
};

const stopWords = new Set([
  "需要", "要求", "必须", "可以", "一个", "这个", "那个", "进行", "不能", "不要", "客户", "博主",
  "视频", "脚本", "修改", "内容", "拍摄", "发布", "文案", "caption", "brief", "the", "and", "with"
]);

const riskWords = ["最", "第一", "唯一", "保证", "治愈", "永久", "绝对", "100%", "无敌", "全网最低", "立刻见效"];

function getEl(id) {
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

function buildAudit() {
  const mode = modes[getEl("auditMode").value];
  const values = {
    brief: getEl("briefText").value,
    script: getEl("scriptText").value,
    feedback: getEl("feedbackText").value,
    target: getEl("targetText").value
  };
  const source = values[mode.sourceA];
  const target = values[mode.sourceB];
  const requirements = splitRequirements(source);
  const checks = requirements.map(req => {
    const result = requirementScore(req, target);
    return { requirement: req, ...result, status: statusFor(result.score) };
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

  getEl("verdict").textContent = verdict;
  const ring = getEl("scoreRing");
  ring.textContent = `${audit.score}%`;
  ring.style.background = `conic-gradient(var(--accent) ${audit.score * 3.6}deg, #e6ecef 0deg)`;

  getEl("summary").textContent =
    `${audit.mode.summary} 当前识别到 ${audit.requirements.length} 条要求，已覆盖 ${audit.covered} 条，部分覆盖 ${audit.partial} 条，疑似缺失 ${audit.missing} 条。` +
    (audit.risks.length ? ` 另发现 ${audit.risks.length} 个夸张或合规风险表达，建议人工确认。` : "");

  const checks = getEl("checks");
  checks.innerHTML = "";
  if (!audit.checks.length) {
    checks.innerHTML = `<div class="check-item"><p>没有识别到可检查的要求。请把 brief 或客户意见拆成更明确的条目。</p></div>`;
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

  getEl("feedbackOutput").value = buildFeedback(audit, verdict);
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
    missing.slice(0, 12).forEach((item, index) => {
      lines.push(`${index + 1}. ${item.requirement}`);
    });
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
  getEl("briefText").value = [
    "必须露出品牌名 GlowLab 和新品水光精华。",
    "需要说明三大卖点：轻薄不粘、妆前可用、适合熬夜后急救。",
    "开头 3 秒需要出现产品近景。",
    "Caption 需包含 #GlowLab #水光精华，并提示 8/1-8/15 活动。禁止使用治愈、永久、全网最低。"
  ].join("\n");
  getEl("scriptText").value = [
    "开头拿起 GlowLab 水光精华做近景。",
    "讲熬夜后皮肤暗沉，使用后肤感轻薄不粘，早上妆前也可以用。",
    "结尾提醒 8/1-8/15 有活动。"
  ].join("\n");
  getEl("feedbackText").value = [
    "客户要求补充产品近景要在前 3 秒。",
    "删除“立刻见效”。",
    "Caption 加上活动时间和两个指定 hashtag。"
  ].join("\n");
  getEl("targetText").value = [
    "今天分享 GlowLab 水光精华，质地轻薄不粘，熬夜后急救很适合，妆前也能用。",
    "8/1-8/15 有活动，#GlowLab #水光精华。"
  ].join("\n");
}

getEl("auditBtn").addEventListener("click", () => renderAudit(buildAudit()));
getEl("sampleBtn").addEventListener("click", loadSample);
getEl("clearBtn").addEventListener("click", () => {
  ["briefText", "scriptText", "feedbackText", "targetText"].forEach(id => getEl(id).value = "");
  getEl("checks").innerHTML = "";
  getEl("feedbackOutput").value = "";
  getEl("summary").textContent = "录入资料后点击“开始审核”，这里会显示覆盖率、缺失要点、疑似未修改项和建议反馈话术。";
  getEl("verdict").textContent = "待审核";
  getEl("scoreRing").textContent = "--";
  getEl("scoreRing").style.background = "conic-gradient(var(--accent) 0deg, #e6ecef 0deg)";
});
getEl("copyBtn").addEventListener("click", async () => {
  const text = getEl("feedbackOutput").value;
  if (!text) return;
  await navigator.clipboard.writeText(text);
  getEl("copyBtn").textContent = "已复制";
  setTimeout(() => getEl("copyBtn").textContent = "复制审核结论", 1200);
});
