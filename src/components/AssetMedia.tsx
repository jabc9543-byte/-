import { useEffect, useRef, useState } from "react";
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
  const ext = extOf(src);
  const kind: "image" | "audio" = AUDIO_EXTS.includes(ext) ? "audio" : "image";
  const [resolved, setResolved] = useState<string | null>(() =>
    isAsset(src) ? cache.get(src) ?? null : src,
  );
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tapTimerRef = useRef<number | null>(null);

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

  useEffect(() => {
    if (kind !== "audio") return;
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [kind, resolved]);

  useEffect(() => {
    return () => {
      if (tapTimerRef.current !== null) {
        window.clearTimeout(tapTimerRef.current);
      }
    };
  }, []);

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
    const togglePlayback = () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.paused) {
        void audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    };

    return (
      <span
        className="asset-audio-wrap"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={`asset-audio-btn${playing ? " is-playing" : ""}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (tapTimerRef.current !== null) {
              window.clearTimeout(tapTimerRef.current);
              tapTimerRef.current = null;
              focusNearestEditor(e.currentTarget);
              return;
            }
            tapTimerRef.current = window.setTimeout(() => {
              tapTimerRef.current = null;
              togglePlayback();
            }, 220);
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (tapTimerRef.current !== null) {
              window.clearTimeout(tapTimerRef.current);
              tapTimerRef.current = null;
            }
            focusNearestEditor(e.currentTarget);
          }}
          title="单击播放，双击编辑"
          aria-label={playing ? "暂停录音" : "播放录音"}
        >
          <span className="asset-audio-icon" aria-hidden>
            {playing ? "⏸" : "▶"}
          </span>
          <span className="asset-audio-label">{alt || "audio"}</span>
        </button>
        <audio
          ref={audioRef}
          className="asset-audio"
          preload="metadata"
          src={resolved}
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
      onClick={(e) => e.stopPropagation()}
    />
  );
}
