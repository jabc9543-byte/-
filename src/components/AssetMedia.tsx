import { useEffect, useRef, useState } from "react";
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
      <CustomAudioPlayer
        src={src}
        resolvedUrl={resolved}
        onFocusEditor={(target) => focusNearestEditor(target)}
      />
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

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const total = Math.floor(s);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function CustomAudioPlayer({
  src,
  resolvedUrl,
  onFocusEditor,
}: {
  src: string;
  resolvedUrl: string;
  onFocusEditor: (target: EventTarget | null) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number>(0);
  const [position, setPosition] = useState<number>(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    logMobileDebug("asset.audio", "custom player mount", {
      src,
      urlPrefix: resolvedUrl.slice(0, 24),
    });
    return () => {
      const el = audioRef.current;
      if (el) {
        el.pause();
      }
    };
  }, [src, resolvedUrl]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play()
        .then(() => {
          logMobileDebug("asset.audio", "play started", { src });
        })
        .catch((e) => {
          logMobileDebug("asset.audio", "play rejected", {
            src,
            error: String(e),
          });
          setErr(String(e));
        });
    } else {
      el.pause();
    }
  };

  return (
    <span
      className="asset-audio-wrap"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onFocusEditor(e.currentTarget);
      }}
    >
      <button
        type="button"
        className={`asset-audio-btn${playing ? " is-playing" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }}
        title={err ? `播放失败：${err}` : playing ? "暂停" : "播放"}
      >
        <span className="asset-audio-icon" aria-hidden="true">
          {playing ? "⏸" : "▶"}
        </span>
        <span className="asset-audio-label">
          {formatTime(position)}
          {duration > 0 ? ` / ${formatTime(duration)}` : ""}
          {err ? "  ⚠" : ""}
        </span>
      </button>
      <audio
        ref={audioRef}
        src={resolvedUrl}
        preload="metadata"
        style={{ display: "none" }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          setDuration(Number.isFinite(el.duration) ? el.duration : 0);
          logMobileDebug("asset.audio", "loaded metadata", {
            src,
            duration: el.duration,
            readyState: el.readyState,
          });
        }}
        onTimeUpdate={(e) => {
          setPosition(e.currentTarget.currentTime);
        }}
        onError={(e) => {
          const el = e.currentTarget;
          const msg = el.error
            ? `code=${el.error.code} ${el.error.message ?? ""}`
            : "unknown";
          setErr(msg);
          logMobileDebug("asset.audio", "element error", {
            src,
            message: msg,
            networkState: el.networkState,
            readyState: el.readyState,
          });
        }}
      />
    </span>
  );
}
