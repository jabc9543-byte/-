// Source for the bundled "Claudian" native plugin.
// 在「全视维」里直接调用 Anthropic Claude，AI 输出直接写入笔记。
// 用法对齐图片：
//   1) 选中一段论文摘要 -> 让 Claude 总结成自己的语言 -> 直接插入笔记
//   2) 写下一个模糊概念 -> 让 Claude 解释 -> 补充到概念词典里
//   3) 面试复盘 -> 让 AI 分析回答的不足之处
//   注意：需要先配置 Claude API Key。本地存放在「00-Claudian-Config」页面的第一个块。

export const CLAUDIAN_MAIN_JS = String.raw`
const CONFIG_PAGE = "00-Claudian-Config";
const DEFAULT_MODEL = "claude-3-5-sonnet-latest";
const DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";

async function readConfig() {
  const pages = await logseq.api.listPages();
  const page = (pages || []).find((p) => p.name === CONFIG_PAGE);
  if (!page) return null;
  const blocks = await logseq.api.pageBlocks(page.id);
  const head = (blocks || [])[0];
  if (!head) return null;
  // 第 1 个块的内容形式：
  //   API_KEY=sk-ant-xxxxxxxxxxxx
  //   MODEL=claude-3-5-sonnet-latest
  //   ENDPOINT=https://api.anthropic.com/v1/messages
  const cfg = { apiKey: "", model: DEFAULT_MODEL, endpoint: DEFAULT_ENDPOINT };
  for (const line of String(head.content || "").split(/\n/)) {
    const m = line.match(/^\s*(API_KEY|MODEL|ENDPOINT)\s*=\s*(.+)$/i);
    if (!m) continue;
    if (m[1].toUpperCase() === "API_KEY") cfg.apiKey = m[2].trim();
    if (m[1].toUpperCase() === "MODEL") cfg.model = m[2].trim();
    if (m[1].toUpperCase() === "ENDPOINT") cfg.endpoint = m[2].trim();
  }
  return cfg.apiKey ? cfg : null;
}

async function setupConfig() {
  const key = await logseq.api.prompt("粘贴你的 Anthropic Claude API Key（sk-ant-...）：", "");
  if (key === null || !String(key).trim()) return null;
  const model = await logseq.api.prompt("模型名（回车用默认 " + DEFAULT_MODEL + "）：", DEFAULT_MODEL);
  if (model === null) return null;
  const endpoint = await logseq.api.prompt("API 端点（回车用默认）：", DEFAULT_ENDPOINT);
  if (endpoint === null) return null;
  // 写入配置页
  const pages = await logseq.api.listPages();
  let page = (pages || []).find((p) => p.name === CONFIG_PAGE);
  const cfgText = "API_KEY=" + String(key).trim() +
    "\nMODEL=" + String(model).trim() +
    "\nENDPOINT=" + String(endpoint).trim();
  if (page) {
    const blocks = await logseq.api.pageBlocks(page.id);
    if (blocks && blocks[0]) {
      await logseq.api.updateBlock(blocks[0].id, cfgText);
    } else {
      await logseq.api.insertBlock(page.id, null, null, cfgText);
    }
  } else {
    // 没有该页面，提示用户创建
    await logseq.api.alert(
      "请先新建一个名为「" + CONFIG_PAGE + "」的空白页面，再次运行本命令即可保存配置。\n" +
      "我们暂不能在沙箱里凭空创建页面。"
    );
    return null;
  }
  logseq.api.notify("配置已保存到「" + CONFIG_PAGE + "」（请勿对外分享该页面）");
  return { apiKey: String(key).trim(), model: String(model).trim(), endpoint: String(endpoint).trim() };
}

async function callClaude(systemPrompt, userPrompt) {
  let cfg = await readConfig();
  if (!cfg) {
    await logseq.api.alert("尚未配置 Claude API Key。即将弹出配置向导。");
    cfg = await setupConfig();
    if (!cfg) return null;
  }
  const body = {
    model: cfg.model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };
  try {
    const resp = await logseq.api.httpFetch(cfg.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    let json;
    try { json = typeof resp.body === "string" ? JSON.parse(resp.body) : resp.body; }
    catch { json = null; }
    if (!json) {
      logseq.api.notify("Claude 返回不是 JSON：HTTP " + (resp && resp.status));
      return null;
    }
    if (json.error) {
      logseq.api.notify("Claude 错误：" + (json.error.message || JSON.stringify(json.error)));
      return null;
    }
    const text = (json.content && json.content[0] && json.content[0].text) ||
      (Array.isArray(json.content) ? json.content.map((c) => c.text || "").join("\n") : "") ||
      json.completion || "";
    return String(text).trim();
  } catch (e) {
    logseq.api.notify("Claude 调用失败：" + (e && e.message ? e.message : e));
    return null;
  }
}

logseq.commands.register("claudian-setup", "Claudian：配置 API Key", async () => {
  await setupConfig();
});

logseq.slash.register("/ai-summary", "Claudian：让 Claude 总结你输入的内容", async ({ blockId }) => {
  const passage = await logseq.api.prompt("粘贴要总结的内容（论文摘要 / 一段笔记等）：", "");
  if (passage === null || !String(passage).trim()) return;
  logseq.api.notify("Claude 正在总结，请稍候…");
  const out = await callClaude(
    "你是一位科研助手。把用户给出的段落用 3-5 句简体中文写出要点，并用 Markdown 项目符号呈现。最后加一行作者立场/局限。",
    String(passage).trim()
  );
  if (!out) return;
  await logseq.api.updateBlock(blockId, "**🧠 Claude 总结**\n\n" + out);
  logseq.api.notify("已写入当前块");
});

logseq.slash.register("/ai-explain", "Claudian：让 Claude 解释一个模糊概念", async ({ blockId }) => {
  const concept = await logseq.api.prompt("想搞懂的概念（一个词或一句话）：", "");
  if (concept === null || !String(concept).trim()) return;
  logseq.api.notify("Claude 正在解释…");
  const out = await callClaude(
    "你是一位耐心的导师。请用简体中文向初学者解释概念，包含：核心定义 / 类比 / 一个最小示例 / 容易踩的坑 / 与相邻概念的差异。控制在 250 字以内，Markdown 列表呈现。",
    String(concept).trim()
  );
  if (!out) return;
  await logseq.api.updateBlock(blockId, "**💡 " + String(concept).trim() + "**\n\n" + out);
  logseq.api.notify("已写入当前块");
});

logseq.slash.register("/ai-review", "Claudian：面试复盘 / 文本批改", async ({ blockId }) => {
  const ans = await logseq.api.prompt("粘贴你的回答 / 文段（让 Claude 找不足）：", "");
  if (ans === null || !String(ans).trim()) return;
  logseq.api.notify("Claude 正在复盘…");
  const out = await callClaude(
    "你是一位严厉但建设性的面试官。请针对用户给的回答：1) 提炼回答骨架；2) 标出 3-5 个不足；3) 给出更优表述示例；4) 推荐进一步阅读。Markdown 输出。",
    String(ans).trim()
  );
  if (!out) return;
  await logseq.api.updateBlock(blockId, "**🪞 复盘**\n\n" + out);
  logseq.api.notify("已写入当前块");
});

logseq.commands.register("claudian-help", "Claudian：使用步骤", async () => {
  const lines = [
    "【Claudian 使用步骤】",
    "",
    "1. 先新建一个名为「00-Claudian-Config」的页面（用 / 新建即可）。",
    "2. 运行命令「Claudian：配置 API Key」，粘贴 Claude API Key、模型名、端点。",
    "3. 在任意块输入斜杠：",
    "   /ai-summary  -> 让 Claude 总结一段文字",
    "   /ai-explain  -> 让 Claude 解释一个概念",
    "   /ai-review   -> 让 Claude 复盘你的回答",
    "",
    "默认模型 = " + DEFAULT_MODEL,
    "默认端点 = " + DEFAULT_ENDPOINT,
    "API Key 仅保存在你的图谱内，不会被上传。",
  ].join("\n");
  await logseq.api.alert(lines);
});
`;
