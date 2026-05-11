import { invoke } from "@tauri-apps/api/core";
import { onOpenUrl, getCurrent } from "@tauri-apps/plugin-deep-link";
import { usePluginStore } from "../stores/plugins";

/**
 * Web Clipper deep-link receiver.
 *
 * Listens for `quanshiwei://clip?...` (and the legacy `lsrs://clip?...`) URLs
 * dispatched to the app by the OS, parses the query payload, and forwards it
 * to the Rust `receive_clip` command.
 *
 * Expected query parameters (all optional, all URL-encoded):
 *   - title   The article headline. Falls back to "Clipped".
 *   - url     The source URL.
 *   - body    The clipped markdown body.
 *   - tags    Comma-separated tag list (e.g. `tags=ml,papers`).
 *   - mode    `"page"` (default when `title` is non-empty) or `"journal"`.
 *
 * If both `body` and `b` (compatibility) parameters are missing, the request
 * is ignored.
 */

interface ClipPayload {
  title: string;
  url: string;
  body: string;
  tags: string[];
  mode?: "page" | "journal";
}

function parseClipUrl(raw: string): ClipPayload | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  if (scheme !== "quanshiwei" && scheme !== "lsrs") return null;
  // Tauri may give either `quanshiwei://clip?...` or `quanshiwei:clip?...`.
  // Treat the host or first path segment as the action name.
  const action = (parsed.host || parsed.pathname.replace(/^\/+/, "").split("/")[0] || "")
    .toLowerCase();
  if (action !== "clip") return null;

  const q = parsed.searchParams;
  const title = q.get("title") ?? q.get("name") ?? "";
  const url = q.get("url") ?? q.get("source") ?? "";
  const body = q.get("body") ?? q.get("content") ?? q.get("b") ?? "";
  const tagsRaw = q.get("tags") ?? q.get("tag") ?? "";
  const tags = tagsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const modeRaw = (q.get("mode") ?? "").toLowerCase();
  const mode = modeRaw === "page" || modeRaw === "journal" ? modeRaw : undefined;

  if (!body && !title) return null;
  return { title, url, body, tags, mode };
}

async function handleUrls(urls: string[] | null | undefined) {
  if (!urls) return;
  for (const raw of urls) {
    const payload = parseClipUrl(raw);
    if (!payload) continue;
    try {
      const result = await invoke<{ page_name: string; mode: string }>("receive_clip", {
        payload,
      });
      usePluginStore.setState((s) => ({
        notifications: [
          ...s.notifications.slice(-5),
          {
            id: Date.now() + Math.random(),
            pluginId: "clipper",
            message: `已${result.mode === "journal" ? "追加到今日 journal" : `创建页面《${result.page_name}》`}`,
          },
        ],
      }));
      // Refresh the page list so the new clipping shows up immediately.
      try {
        const { usePageStore } = await import("../stores/page");
        await usePageStore.getState().refreshPages();
      } catch {
        /* page store not available — fine */
      }
    } catch (e) {
      console.error("[clipper] receive_clip failed", e);
    }
  }
}

let registered = false;

export async function initClipperReceiver(): Promise<void> {
  if (registered) return;
  registered = true;
  try {
    await onOpenUrl((urls) => {
      void handleUrls(urls);
    });
  } catch (e) {
    console.warn("[clipper] onOpenUrl unavailable", e);
  }
  try {
    const current = await getCurrent();
    if (current && current.length) {
      void handleUrls(current);
    }
  } catch (e) {
    console.warn("[clipper] getCurrent unavailable", e);
  }
}
