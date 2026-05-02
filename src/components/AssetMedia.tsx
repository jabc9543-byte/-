import { useEffect, useState } from "react";
import { api } from "../api";

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
    const bytes = await api.readAssetBytes(relPath);
    const blob = new Blob([new Uint8Array(bytes)], {
      type: mimeFor(extOf(relPath), kind),
    });
    const url = URL.createObjectURL(blob);
    cache.set(relPath, url);
    inflight.delete(relPath);
    return url;
  })();
  inflight.set(relPath, p);
  return p;
}

function isAsset(path: string) {
  return /^assets\//.test(path);
}

export function AssetMedia({
  src,
  alt,
}: {
  src: string;
  alt?: string;
}) {
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
      <audio
        className="asset-audio"
        controls
        preload="metadata"
        src={resolved}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <img
      className="asset-image"
      src={resolved}
      alt={alt || ""}
      loading="lazy"
      onClick={(e) => e.stopPropagation()}
    />
  );
}
