// Module-level controller for the in-app voice recorder. The mobile
// edit toolbar starts recording and inserts a `recording://<id>`
// placeholder into the active block; an inline RecordingBar component
// renders that placeholder, displays elapsed time, and provides the
// only "stop" button — so the recording can finish even after the
// soft keyboard / toolbar have been dismissed.

export interface ActiveRecording {
  id: string;
  startedAt: number;
}

export type SaveHandler = (blob: Blob, mime: string) => Promise<void> | void;

interface InternalState extends ActiveRecording {
  recorder: MediaRecorder;
  mime: string;
  chunks: Blob[];
  stream: MediaStream;
  onSaved: SaveHandler;
}

let state: InternalState | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function getActiveRecording(): ActiveRecording | null {
  if (!state) return null;
  return { id: state.id, startedAt: state.startedAt };
}

export function subscribeRecording(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function pickRecorderMime(): string {
  const candidates = [
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export function extForMime(mime: string): string {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

export async function beginRecording(
  id: string,
  onSaved: SaveHandler,
): Promise<{ id: string; mime: string }> {
  if (state) {
    throw new Error("已经在录音中");
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("getUserMedia 不可用");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickRecorderMime();
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  });
  recorder.addEventListener("stop", async () => {
    const cur = state;
    state = null;
    notify();
    stream.getTracks().forEach((t) => t.stop());
    if (!cur) return;
    const finalMime = recorder.mimeType || cur.mime || "audio/webm";
    if (!chunks.length) return;
    const blob = new Blob(chunks, { type: finalMime });
    try {
      await cur.onSaved(blob, finalMime);
    } catch (err) {
      console.error("recording save failed", err);
    }
  });
  recorder.start();
  state = {
    id,
    startedAt: Date.now(),
    recorder,
    mime,
    chunks,
    stream,
    onSaved,
  };
  notify();
  return { id, mime };
}

export function endRecording(id?: string) {
  if (!state) return;
  if (id && state.id !== id) return;
  try {
    state.recorder.stop();
  } catch {
    state = null;
    notify();
  }
}

export function cancelRecording() {
  if (!state) return;
  try {
    state.recorder.stop();
  } catch {
    /* ignore */
  }
  state.stream.getTracks().forEach((t) => t.stop());
  state = null;
  notify();
}
