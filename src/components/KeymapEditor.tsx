import { useMemo, useState } from "react";
import {
  chordFromEvent,
  formatChord,
  useKeymapStore,
} from "../stores/keymap";

/**
 * Settings UI for re-binding global shortcuts (module 16). Lists every
 * registered command alongside its current chord; clicking a row enters
 * "recording" mode that captures the next key combo pressed.
 */
export function KeymapEditor() {
  const commands = useKeymapStore((s) => s.commands);
  const overrides = useKeymapStore((s) => s.overrides);
  const setOverride = useKeymapStore((s) => s.setOverride);
  const resetOverride = useKeymapStore((s) => s.resetOverride);
  const resetAll = useKeymapStore((s) => s.resetAll);
  const chordFor = useKeymapStore((s) => s.chordFor);

  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const entries = useMemo(() => {
    const list = Array.from(commands.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) => c.label.toLowerCase().includes(q) || c.id.includes(q),
    );
  }, [commands, filter]);

  // Conflict detection: map of chord -> array of commandIds using it.
  const conflicts = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const c of commands.values()) {
      const chord = chordFor(c.id);
      if (!chord) continue;
      const arr = map.get(chord) ?? [];
      arr.push(c.id);
      map.set(chord, arr);
    }
    return map;
    // `overrides` is read through chordFor, so depend on it so conflicts
    // re-evaluate when the user edits a binding.
  }, [commands, overrides, chordFor]);

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    id: string,
  ) => {
    if (recordingId !== id) return;
    // Allow Escape to cancel, Backspace/Delete to clear.
    if (e.key === "Escape") {
      e.preventDefault();
      setRecordingId(null);
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      setOverride(id, "");
      setRecordingId(null);
      return;
    }
    const chord = chordFromEvent(e.nativeEvent);
    if (!chord) return; // pure modifier, keep listening
    e.preventDefault();
    setOverride(id, chord);
    setRecordingId(null);
  };

  return (
    <div className="keymap-editor">
      <div className="keymap-toolbar">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="搜索快捷键…"
          className="keymap-filter"
        />
        <button
          className="keymap-reset-all"
          onClick={() => {
            if (confirm("将所有快捷键恢复为默认？")) resetAll();
          }}
        >
          全部重置
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="settings-hint">尚未注册命令。</p>
      ) : (
        <table className="keymap-table">
          <thead>
            <tr>
              <th>命令</th>
              <th>快捷键</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((c) => {
              const chord = chordFor(c.id);
              const hasOverride = Object.prototype.hasOwnProperty.call(
                overrides,
                c.id,
              );
              const conflict =
                chord && (conflicts.get(chord)?.length ?? 0) > 1;
              return (
                <tr key={c.id} className={conflict ? "keymap-conflict" : ""}>
                  <td>
                    <div className="keymap-label">{c.label}</div>
                    <div className="keymap-id">{c.id}</div>
                  </td>
                  <td>
                    <button
                      className={`keymap-chord ${
                        recordingId === c.id ? "recording" : ""
                      }`}
                      onClick={() => setRecordingId(c.id)}
                      onBlur={() => setRecordingId(null)}
                      onKeyDown={(e) => handleKeyDown(e, c.id)}
                      title={
                        recordingId === c.id
                          ? "按下任意键组… Esc 取消，Backspace 清除"
                          : "点击重新绑定"
                      }
                    >
                      {recordingId === c.id
                        ? "请按键…"
                        : chord
                          ? formatChord(chord)
                          : "未绑定"}
                    </button>
                    {conflict && (
                      <span className="keymap-conflict-badge">冲突</span>
                    )}
                  </td>
                  <td className="keymap-actions">
                    {hasOverride && (
                      <button
                        className="keymap-reset"
                        onClick={() => resetOverride(c.id)}
                        title="恢复默认"
                      >
                        重置
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="settings-hint">
        点击某个快捷键即可重新绑定。按 <kbd>Esc</kbd> 取消，
        <kbd>Backspace</kbd> 解除绑定。<code>Mod</code> 在 Windows/Linux 上
        表示 <kbd>Ctrl</kbd>，在 macOS 上表示 <kbd>⌘</kbd>。
      </p>
    </div>
  );
}
