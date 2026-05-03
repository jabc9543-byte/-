import { useEffect, useState } from "react";
import { api } from "../api";
import { RecordingBar } from "./RecordingBar";
import { logMobileDebug } from "../utils/mobileDebug";

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

const AUDIO_EXTS = ["webm", "ogg", "mp3", "m4a", "wav", "aac", "mp4", "amr"];

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "";
  return path.slice(dot + 1).toLowerCase();
}

function mimeFor(ext: string, kind: "image" | "audio"): string {
  if (kind === "audio") {
    if (ext === "webm") return "audio/webm";
    if (ext === "ogg") return "audio/ogg";
    if (ext === "mp3") return "audio/mpeg";
    if (ext === "m4a") return "audio/mp4";
    if (ext === "wav") return "audio/wav";
    if (ext === "aac") return "audio/aac";
    if (ext === "mp4") return "audio/mp4";
    return "audio/webm";
  }
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "bmp") return "image/bmp";
  if (ext === "heic") return "image/heic";
  return "application/octet-stream";
}

async function fetchObjectUrl(
  relPath: string,
  kind: "image" | "audio",
): Promise<string> {
  const cached = cache.get(relPath);
  if (cached) return cached;
  const pending = inflight.get(relPath);
  if (pending) return pending;
  const p = (async () => {
    if (kind === "audio") {
      logMobileDebug("asset.audio", "fetch start", { relPath });
    }
    try {
      const bytes = await api.readAssetBytes(relPath);
      if (kind === "audio") {
        logMobileDebug("asset.audio", "bytes received", {
          relPath,
          byteCount: bytes.length,
        });
      }
      const blob = new Blob([new Uint8Array(bytes)], {
        type: mimeFor(extOf(relPath), kind),
      });
      const url = URL.createObjectURL(blob);
      cache.set(relPath, url);
      inflight.delete(relPath);
      if (kind === "audio") {
        logMobileDebug("asset.audio", "blob url ready", {
          relPath,
          mime: mimeFor(extOf(relPath), kind),
          urlPrefix: url.slice(0, 24),
        });
      }
      return url;
    } catch (err) {
      inflight.delete(relPath);
      if (kind === "audio") {
        logMobileDebug("asset.audio", "fetch error", {
          relPath,
          error: String(err),
        });
      }
      throw err;
    }
  })();
  inflight.set(relPath, p);
  return p;
}

function isAsset(path: string) {
  return /^assets\//.test(path);
}

function focusNearestEditor(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return;
  const stack = target.closest(".block-editor-stack");
  const textarea = stack?.querySelector("textarea.block-editor") as
    | HTMLTextAreaElement
    | null;
  textarea?.focus();
}

export function AssetMedia({
  src,
  alt,
}: {
  src: string;
  alt?: string;
}) {
  // Live recording placeholder: rendered as a recording bar with a
  // stop button so the user can finish the recording from inside the
  // block (independent of the floating mobile toolbar).
  if (src.startsWith("recording://")) {
    return <RecordingBar id={src.slice("recording://".length)} />;
  }
  const ext = extOf(src);
  const kind: "image" | "audio" = AUDIO_EXTS.includes(ext) ? "audio" : "image";
  const [resolved, setResolved] = useState<string | null>(() =>
    isAsset(src) ? cache.get(src) ?? null : src,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAsset(src)) {
      setResolved(src);
      return;
    }
    let alive = true;
    setError(null);
    fetchObjectUrl(src, kind)
      .then((u) => {
        if (alive) setResolved(u);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [src, kind]);

  if (error) {
    return (
      <span className="asset-error" title={error}>
        ⚠ {alt || src}
      </span>
    );
  }
  if (!resolved) {
    return <span className="asset-loading">…</span>;
  }
  if (kind === "audio") {
    return (
      <span
        className="asset-audio-wrap"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          focusNearestEditor(e.currentTarget);
        }}
      >
        <audio
          className="asset-audio"
          controls
          preload="metadata"
          src={resolved}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            logMobileDebug("asset.audio", "loaded metadata", {
              src,
              duration: el.duration,
              readyState: el.readyState,
            });
          }}
          onError={(e) => {
            const el = e.currentTarget;
            logMobileDebug("asset.audio", "element error", {
              src,
              code: el.error?.code,
              message: el.error?.message,
              networkState: el.networkState,
              readyState: el.readyState,
            });
          }}
        />
      </span>
    );
  }
  return (
    <img
      className="asset-image"
      src={resolved}
      alt={alt || ""}
      loading="lazy"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        focusNearestEditor(e.currentTarget);
      }}
    />
  );
}
