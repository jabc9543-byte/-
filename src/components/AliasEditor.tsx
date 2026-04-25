import { useMemo, useState } from "react";
import type { Page } from "../types";
import { usePageStore } from "../stores/page";

interface Props {
  page: Page;
}

function readAliases(page: Page): string[] {
  const raw = (page.properties as Record<string, unknown>).aliases;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

// Inline editor for a page's aliases. Alias strings let users reference the
// same page under alternative names (e.g. nickname, translation) inside
// `[[...]]` links and backlinks.
export function AliasEditor({ page }: Props) {
  const setAliases = usePageStore((s) => s.setAliases);
  const aliases = useMemo(() => readAliases(page), [page]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const val = draft.trim();
    if (!val) return;
    if (aliases.some((a) => a.toLowerCase() === val.toLowerCase())) {
      setDraft("");
      return;
    }
    setBusy(true);
    try {
      await setAliases(page.id, [...aliases, val]);
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: string) => {
    setBusy(true);
    try {
      await setAliases(
        page.id,
        aliases.filter((x) => x !== a),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="alias-editor">
      <span className="alias-label">别名</span>
      {aliases.map((a) => (
        <span key={a} className="alias-chip">
          {a}
          <button
            type="button"
            className="alias-remove"
            onClick={() => remove(a)}
            disabled={busy}
            aria-label={`移除别名 ${a}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="alias-input"
        type="text"
        placeholder="添加别名…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        disabled={busy}
      />
    </div>
  );
}
