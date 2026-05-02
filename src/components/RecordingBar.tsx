import { useEffect, useState } from "react";
import {
  endRecording,
  getActiveRecording,
  subscribeRecording,
} from "../utils/recorder";

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function RecordingBar({ id }: { id: string }) {
  const [active, setActive] = useState(getActiveRecording());
  const [now, setNow] = useState(Date.now());

  useEffect(() => subscribeRecording(() => setActive(getActiveRecording())), []);

  useEffect(() => {
    if (!active || active.id !== id) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [active, id]);

  const isThis = active && active.id === id;
  const elapsed = isThis ? now - active.startedAt : 0;

  return (
    <span
      className="recording-bar"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <span className={`recording-dot${isThis ? " is-live" : ""}`} aria-hidden />
      <span className="recording-label">
        {isThis ? "正在录音" : "保存中"} {fmt(elapsed)}
      </span>
      {isThis && (
        <button
          type="button"
          className="recording-stop"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            endRecording(id);
          }}
          aria-label="结束录音"
          title="结束录音"
        >
          ■
        </button>
      )}
    </span>
  );
}
