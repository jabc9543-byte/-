import { useEffect, useState } from "react";
import {
  endRecording,
  getActiveRecording,
  subscribeRecording,
} from "../utils/recorder";

// Global, always-visible-when-recording overlay. Shows elapsed time
// and a stop ■ button. Anchored above the soft keyboard via
// visualViewport so the user can finish recording even when the
// keyboard / mobile edit toolbar is hidden.

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function RecordingOverlay() {
  const [active, setActive] = useState(getActiveRecording());
  const [now, setNow] = useState(Date.now());
  const [bottom, setBottom] = useState(0);

  useEffect(() => subscribeRecording(() => setActive(getActiveRecording())), []);

  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [active]);

  // Sit above the keyboard if it's open; otherwise above the bottom
  // safe area so it never gets clipped.
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    const apply = () => {
      if (!vv) {
        setBottom(72);
        return;
      }
      const hidden = Math.max(
        0,
        Math.round(window.innerHeight - vv.height - vv.offsetTop),
      );
      setBottom(hidden + 72);
    };
    apply();
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    return () => {
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
    };
  }, [active]);

  if (!active) return null;
  const elapsed = now - active.startedAt;
  return (
    <div
      className="recording-overlay"
      role="dialog"
      aria-label="正在录音"
      style={{ bottom: `${bottom}px` }}
    >
      <span className="recording-dot is-live" aria-hidden />
      <span className="recording-label">正在录音 {fmt(elapsed)}</span>
      <button
        type="button"
        className="recording-stop"
        onPointerDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          endRecording(active.id);
        }}
        aria-label="结束录音"
        title="结束录音"
      >
        ■
      </button>
    </div>
  );
}
