import { useWhiteboardStore } from "../stores/whiteboard";

export function WhiteboardList() {
  const list = useWhiteboardStore((s) => s.list);
  const view = useWhiteboardStore((s) => s.view);
  const open = useWhiteboardStore((s) => s.open);
  const create = useWhiteboardStore((s) => s.create);
  const remove = useWhiteboardStore((s) => s.remove);
  const showPage = useWhiteboardStore((s) => s.showPage);

  const onCreate = async () => {
    const name = prompt("新白板名称：");
    if (!name) return;
    try {
      await create(name);
    } catch (e) {
      alert(String(e));
    }
  };

  const onDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`删除白板「${id}」？`)) return;
    await remove(id);
  };

  const activeId = view.kind === "whiteboard" ? view.id : null;

  return (
    <div className="sidebar-section">
      <div className="sidebar-section-title">
        <span>白板</span>
        <button onClick={onCreate} title="新建白板">+</button>
      </div>
      <div className="page-list">
        {list.length === 0 && (
          <div style={{ padding: 14, color: "var(--fg-muted)", fontSize: 12 }}>
            暂无白板。
          </div>
        )}
        {list.map((wb) => (
          <button
            key={wb.id}
            className={wb.id === activeId ? "active" : ""}
            onClick={() => void open(wb.id)}
            onDoubleClick={(e) => onDelete(wb.id, e)}
            title="双击删除"
          >
            🎨 {wb.name}
          </button>
        ))}
        {activeId && (
          <button onClick={showPage} style={{ color: "var(--fg-muted)" }}>
            ← 返回页面
          </button>
        )}
      </div>
    </div>
  );
}
