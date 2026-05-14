// 主题包：在应用内一键切换 9 套主题。setTheme RPC 会同步写入 settings 持久化，
// 系统主题跟随 prefers-color-scheme；其它主题写 <html data-theme="…"> 并持久化到
// localStorage("quanshiwei:extra-theme")。

export const THEMES_MAIN_JS = String.raw`
function reg(id, label, name) {
  logseq.commands.register(id, label, async () => {
    try {
      await logseq.api.setTheme(name);
      logseq.api.notify("已切换主题：" + label.replace(/^主题：/, ""));
    } catch (e) {
      logseq.api.notify("切换失败：" + (e && e.message ? e.message : e));
    }
  });
}

reg("theme-system", "主题：跟随系统", "system");
reg("theme-light", "主题：浅色", "light");
reg("theme-dark", "主题：深色", "dark");
reg("theme-solarized-light", "主题：Solarized Light", "solarized-light");
reg("theme-solarized-dark", "主题：Solarized Dark", "solarized-dark");
reg("theme-nord", "主题：Nord", "nord");
reg("theme-paper", "主题：纸张 Paper", "paper");
reg("theme-forest", "主题：森林 Forest", "forest");
reg("theme-midnight", "主题：午夜 Midnight", "midnight");
reg("theme-rose", "主题：玫瑰 Rose", "rose");
`;
