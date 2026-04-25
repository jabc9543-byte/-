import { useHelpStore } from "../stores/help";

const SHORTCUTS: [string, string][] = [
  ["Ctrl / ⌘ + K", "命令面板"],
  ["Ctrl / ⌘ + P", "跳转页面"],
  ["Ctrl / ⌘ + N", "新建页面"],
  ["Ctrl / ⌘ + F", "搜索"],
  ["Ctrl / ⌘ + Enter", "切换任务状态（TODO → DOING → DONE）"],
  ["Ctrl / ⌘ + B", "粗体"],
  ["Ctrl / ⌘ + I", "斜体"],
  ["Ctrl / ⌘ + K", "页面链接 [[ ]]"],
  ["Ctrl / ⌘ + `", "行内代码"],
  ["Tab / Shift + Tab", "缩进 / 取消缩进"],
  ["Alt + ↑ / ↓", "上移 / 下移块"],
  ["Mod + Shift + A", "切换 AI 助手"],
  ["Enter", "新建同级块"],
  ["Backspace（空行）", "删除当前块"],
];

const TIPS: [string, string][] = [
  ["[[页面名]]", "创建或链接到一个页面"],
  ["#标签", "使用标签归档块"],
  ["((块ID))", "嵌入其他块"],
  ["{{query 语法}}", "嵌入查询结果"],
  ["TODO / DOING / DONE", "任务状态"],
  ["SCHEDULED: <YYYY-MM-DD>", "安排日期"],
  ["DEADLINE: <YYYY-MM-DD>", "截止日期"],
  ["[#A] [#B] [#C]", "优先级标记"],
];

export function HelpPanel() {
  const open = useHelpStore((s) => s.open);
  const hide = useHelpStore((s) => s.hide);
  if (!open) return null;
  return (
    <div className="cmdp-backdrop" onClick={hide}>
      <div
        className="help-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="帮助"
      >
        <header className="help-header">
          <h2>全视维 使用帮助</h2>
          <button onClick={hide} aria-label="关闭">×</button>
        </header>
        <div className="help-body">
          <section>
            <h3>快捷键</h3>
            <table className="help-table">
              <tbody>
                {SHORTCUTS.map(([k, v]) => (
                  <tr key={k}>
                    <td><kbd>{k}</kbd></td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section>
            <h3>语法</h3>
            <table className="help-table">
              <tbody>
                {TIPS.map(([k, v]) => (
                  <tr key={k}>
                    <td><code>{k}</code></td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section>
            <h3>关于</h3>
            <p>
              全视维 是一款本地优先的知识图谱应用，使用 Rust + Tauri + React 构建。
              所有数据以 Markdown 存放在本地图谱文件夹中，可随时用其他工具打开编辑。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
