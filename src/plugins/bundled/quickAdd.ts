// Source for the bundled "QuickAdd" native plugin.
// Three usage modes copied from the Obsidian QuickAdd plugin:
//   1) Capture  - 弹出输入框 -> 回车 -> 自动存入 Inbox
//   2) Template - 新建带模板的论文/会议笔记，自动创建页面
//   3) Append   - 一键追加到指定的笔记末尾（如面试题库）

export const QUICK_ADD_MAIN_JS = String.raw`
const INBOX_PAGE = "Inbox";
const PAPER_PAGE_PREFIX = "Papers/";
const INTERVIEW_PAGE = "面试题库";

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

async function findPage(name) {
  const pages = await logseq.api.listPages();
  return (pages || []).find((p) => p.name === name) || null;
}

async function doCapture() {
  const text = await logseq.api.prompt("速记内容（回车保存）：", "");
  if (text === null) return;
  const t = String(text).trim();
  if (!t) return;
  try {
    const page = await findPage(INBOX_PAGE);
    if (!page) {
      const j = await logseq.api.todayJournal();
      if (j) {
        await logseq.api.insertBlock(j.id, null, null, "[" + nowStamp() + "] " + t);
        logseq.api.notify("无「Inbox」页，已写入今天 journal");
        return;
      }
      logseq.api.notify("写入失败：无法定位 Inbox / today");
      return;
    }
    await logseq.api.insertBlock(page.id, null, null, "[" + nowStamp() + "] " + t);
    logseq.api.notify("已写入 Inbox · 共 1 条");
  } catch (e) {
    logseq.api.notify("写入失败：" + (e && e.message ? e.message : e));
  }
}

async function doPaper() {
  const title = await logseq.api.prompt("论文标题：", "");
  if (title === null) return;
  const t = String(title).trim();
  if (!t) return;
  const pageName = PAPER_PAGE_PREFIX + t;
  try {
    const page = await findPage(pageName);
    if (page) {
      await logseq.api.insertBlock(page.id, null, null,
        "## " + nowStamp() + " 追加" +
        "\n- 摘要：\n- 核心观点：\n- 我的思考：\n- 引用："
      );
      await logseq.api.openPage(page.id);
      logseq.api.notify("已在 " + pageName + " 写入新模板");
      return;
    }
    const j = await logseq.api.todayJournal();
    if (j) {
      await logseq.api.insertBlock(j.id, null, null,
        "## 📄 " + t + "（QuickAdd）\n- 创建时间：" + nowStamp() +
        "\n- 摘要：\n- 核心观点：\n- 我的思考：\n- 引用："
      );
      await logseq.api.openPage(j.id);
      logseq.api.notify("已在今天 journal 创建论文卡片（请先手动新建「" + pageName + "」页面以归档）");
    }
  } catch (e) {
    logseq.api.notify("失败：" + (e && e.message ? e.message : e));
  }
}

async function doInterview() {
  const q = await logseq.api.prompt("面试题（题干）：", "");
  if (q === null) return;
  const a = await logseq.api.prompt("简短答案（可留空稍后补）：", "");
  if (a === null) return;
  try {
    let page = await findPage(INTERVIEW_PAGE);
    if (!page) {
      const j = await logseq.api.todayJournal();
      if (j) {
        await logseq.api.insertBlock(j.id, null, null,
          "## ❓ " + String(q).trim() +
          "\n  - 时间：" + nowStamp() +
          "\n  - 答：" + String(a || "").trim()
        );
        logseq.api.notify("无「" + INTERVIEW_PAGE + "」页，已写入今天 journal");
        return;
      }
      return;
    }
    await logseq.api.insertBlock(page.id, null, null,
      "## " + String(q).trim() +
      "\n- 时间：" + nowStamp() +
      "\n- 答：" + String(a || "").trim()
    );
    logseq.api.notify("已追加到 " + INTERVIEW_PAGE);
  } catch (e) {
    logseq.api.notify("失败：" + (e && e.message ? e.message : e));
  }
}

logseq.commands.register("qa-capture", "QuickAdd：速记到 Inbox", doCapture);
logseq.commands.register("qa-paper", "QuickAdd：新建论文笔记", doPaper);
logseq.commands.register("qa-append-interview", "QuickAdd：追加到面试题库", doInterview);

logseq.slash.register("/qa-capture", "QuickAdd：速记到 Inbox", async ({ blockId }) => { void blockId; await doCapture(); });
logseq.slash.register("/qa-paper", "QuickAdd：新建论文笔记", async ({ blockId }) => { void blockId; await doPaper(); });
logseq.slash.register("/qa-append", "QuickAdd：追加到面试题库", async ({ blockId }) => { void blockId; await doInterview(); });
`;
