// Source for the bundled "Git Sync" native plugin.
// 沙箱内不能执行 shell，但我们可以：
//   1) 教用户如何把当前图谱目录初始化为 Git 仓库 + 配 GitHub PAT
//   2) 一键复制「自动 commit + push」命令片段供粘贴到 PowerShell / bash
//   3) 通过 httpFetch 调 GitHub API 列出最近的提交记录，给出"恢复版本"的链接
// 用法对齐图片：
//   - 自动 commit / push（这里给出可粘贴的脚本，Windows 计划任务 / cron 即可）
//   - 改乱了 -> GitHub Web 查看历史 -> 一键恢复
//   - 多设备同步：家里 push / 公司 pull

export const GIT_MAIN_JS = String.raw`
const CONFIG_PAGE = "00-Git-Config";

async function readConfig() {
  const pages = await logseq.api.listPages();
  const page = (pages || []).find((p) => p.name === CONFIG_PAGE);
  if (!page) return null;
  const blocks = await logseq.api.pageBlocks(page.id);
  const head = (blocks || [])[0];
  if (!head) return null;
  const cfg = { repo: "", branch: "main", token: "" };
  for (const line of String(head.content || "").split(/\n/)) {
    const m = line.match(/^\s*(REPO|BRANCH|TOKEN)\s*=\s*(.+)$/i);
    if (!m) continue;
    if (m[1].toUpperCase() === "REPO") cfg.repo = m[2].trim();
    if (m[1].toUpperCase() === "BRANCH") cfg.branch = m[2].trim();
    if (m[1].toUpperCase() === "TOKEN") cfg.token = m[2].trim();
  }
  return cfg.repo ? cfg : null;
}

logseq.commands.register("git-setup", "Git：配置仓库与 Token", async () => {
  const repo = await logseq.api.prompt("GitHub 仓库 owner/repo（如 jabc9543-byte/notes）：", "");
  if (repo === null || !String(repo).trim()) return;
  const branch = await logseq.api.prompt("分支（默认 main）：", "main");
  if (branch === null) return;
  const token = await logseq.api.prompt("Personal Access Token（仅查询提交时需要，可留空）：", "");
  if (token === null) return;
  const pages = await logseq.api.listPages();
  let page = (pages || []).find((p) => p.name === CONFIG_PAGE);
  const cfgText = "REPO=" + String(repo).trim() +
    "\nBRANCH=" + (String(branch).trim() || "main") +
    "\nTOKEN=" + String(token).trim();
  if (!page) {
    await logseq.api.alert("请先新建名为「" + CONFIG_PAGE + "」的页面再次运行此命令。");
    return;
  }
  const blocks = await logseq.api.pageBlocks(page.id);
  if (blocks && blocks[0]) await logseq.api.updateBlock(blocks[0].id, cfgText);
  else await logseq.api.insertBlock(page.id, null, null, cfgText);
  logseq.api.notify("Git 配置已保存");
});

logseq.commands.register("git-script", "Git：复制自动 commit&push 脚本", async () => {
  const cfg = await readConfig();
  const repo = cfg && cfg.repo ? cfg.repo : "<owner/repo>";
  const branch = cfg && cfg.branch ? cfg.branch : "main";
  const ps1 = [
    "# Windows PowerShell 自动 commit + push（保存为 sync-vault.ps1，计划任务每 X 分钟跑一次）",
    "cd <你的图谱目录>",
    "git add -A",
    "$msg = 'auto sync ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "git commit -m $msg 2>$null",
    "git push origin " + branch,
  ].join("\n");
  const bash = [
    "# macOS / Linux 自动 commit + push（保存为 sync-vault.sh，cron 每 X 分钟跑一次）",
    "cd <你的图谱目录>",
    "git add -A",
    "git commit -m \"auto sync $(date '+%Y-%m-%d %H:%M:%S')\" || true",
    "git push origin " + branch,
  ].join("\n");
  const init = [
    "# 第一次初始化（只跑一次）：",
    "cd <你的图谱目录>",
    "git init",
    "git remote add origin https://github.com/" + repo + ".git",
    "git add -A",
    "git commit -m 'init'",
    "git branch -M " + branch,
    "git push -u origin " + branch,
  ].join("\n");
  await logseq.api.alert(
    "【一次性初始化】\n" + init + "\n\n" +
    "【Windows 自动同步】\n" + ps1 + "\n\n" +
    "【macOS / Linux 自动同步】\n" + bash
  );
});

logseq.commands.register("git-commits", "Git：查看最近 commit（GitHub API）", async () => {
  const cfg = await readConfig();
  if (!cfg) { logseq.api.notify("尚未配置，请先运行「Git：配置仓库与 Token」"); return; }
  try {
    const url = "https://api.github.com/repos/" + cfg.repo + "/commits?per_page=10&sha=" + cfg.branch;
    const headers = { "user-agent": "quanshiwei-git-plugin", "accept": "application/vnd.github+json" };
    if (cfg.token) headers["authorization"] = "Bearer " + cfg.token;
    const resp = await logseq.api.httpFetch(url, { method: "GET", headers });
    const list = typeof resp.body === "string" ? JSON.parse(resp.body) : resp.body;
    if (!Array.isArray(list)) { logseq.api.notify("响应异常：HTTP " + resp.status); return; }
    const lines = list.map((c) => {
      const sha = (c.sha || "").slice(0, 7);
      const when = c.commit && c.commit.author ? c.commit.author.date : "";
      const msg = (c.commit && c.commit.message) ? String(c.commit.message).split(/\n/)[0] : "";
      return sha + "  " + when + "  " + msg;
    });
    const linkHint = "\n\n查看历史 / 一键恢复：\nhttps://github.com/" + cfg.repo + "/commits/" + cfg.branch;
    await logseq.api.alert("最近 commit（" + cfg.repo + "@" + cfg.branch + "）：\n\n" + lines.join("\n") + linkHint);
  } catch (e) {
    logseq.api.notify("查询失败：" + (e && e.message ? e.message : e));
  }
});

logseq.commands.register("git-help", "Git：完整使用步骤", async () => {
  const text = [
    "【Git 同步插件 · 完整步骤】",
    "",
    "一、为什么用 Git",
    "  · 知识库 = 最重要资产；电脑崩 / 文件删 / 改错都能找回。",
    "  · 多设备同步：家里 push、公司 pull，免费、可控。",
    "",
    "二、本地准备",
    "  1) 装 Git（git-scm.com）。",
    "  2) 在 GitHub 新建一个**私有**仓库（如 notes）。",
    "  3) 在 GitHub Settings → Developer settings → Personal access tokens 生成 PAT，权限勾 repo。",
    "",
    "三、本应用里",
    "  1) 新建页面「00-Git-Config」。",
    "  2) 运行命令「Git：配置仓库与 Token」，依次填 owner/repo、分支、PAT。",
    "  3) 运行命令「Git：复制自动 commit&push 脚本」，把脚本粘贴到本地终端跑一次初始化。",
    "",
    "四、自动同步",
    "  · Windows：把 sync-vault.ps1 加到「任务计划程序」每 N 分钟。",
    "  · macOS / Linux：crontab -e 加 */5 * * * * /path/to/sync-vault.sh",
    "",
    "五、查看历史 / 恢复版本",
    "  · 运行命令「Git：查看最近 commit」，沙箱弹窗会列出最近 10 条。",
    "  · 点击底部链接到 GitHub，在 commit 页右上角点 Revert / Browse files 即可恢复。",
  ].join("\n");
  await logseq.api.alert(text);
});

logseq.slash.register("/git-status", "Git：在此块插入最近 commit", async ({ blockId }) => {
  const cfg = await readConfig();
  if (!cfg) { logseq.api.notify("尚未配置 Git"); return; }
  try {
    const url = "https://api.github.com/repos/" + cfg.repo + "/commits?per_page=5&sha=" + cfg.branch;
    const headers = { "user-agent": "quanshiwei-git-plugin", "accept": "application/vnd.github+json" };
    if (cfg.token) headers["authorization"] = "Bearer " + cfg.token;
    const resp = await logseq.api.httpFetch(url, { method: "GET", headers });
    const list = typeof resp.body === "string" ? JSON.parse(resp.body) : resp.body;
    if (!Array.isArray(list)) { logseq.api.notify("响应异常"); return; }
    const md = list.map((c) => {
      const sha = (c.sha || "").slice(0, 7);
      const when = c.commit && c.commit.author ? c.commit.author.date : "";
      const msg = (c.commit && c.commit.message) ? String(c.commit.message).split(/\n/)[0] : "";
      return "- " + sha + " · " + when + " · " + msg;
    }).join("\n");
    await logseq.api.updateBlock(blockId, "**📦 最近 commit（" + cfg.repo + "@" + cfg.branch + "）**\n" + md);
  } catch (e) {
    logseq.api.notify("查询失败：" + (e && e.message ? e.message : e));
  }
});
`;
