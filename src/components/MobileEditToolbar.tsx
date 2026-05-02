import { useEffect, useRef, useState } from "react";
import { usePageStore } from "../stores/page";
import { useSettingsStore } from "../stores/settings";
import { useIsTouch } from "../hooks/useMediaQuery";
import {
  getActiveMobileEditor,
  subscribeMobileEditor,
} from "../utils/mobileEditor";
import { pickGalleryImages } from "../utils/mobilePermissions";
import { confirmPermission } from "../utils/permissionConfirm";
import { api } from "../api";
import { logMobileDebug } from "../utils/mobileDebug";

// On-screen toolbar that mirrors desktop keyboard shortcuts so that
// every editing capability available on Windows (Ctrl+B/I/K/`,
// Tab/Shift+Tab, Alt+↑/↓, Ctrl+Enter) is reachable on Android where no
// physical keyboard exists.
//
// Buttons use onPointerDown with preventDefault to keep the textarea
// focused (and the soft keyboard up). The actual action runs on
// onClick.

async function readFileBytes(file: File): Promise<number[]> {
  const buf = await file.arrayBuffer();
  return Array.from(new Uint8Array(buf));
}

export function MobileEditToolbar() {
  const isTouch = useIsTouch();
  const [editor, setEditor] = useState(getActiveMobileEditor());
  const [recording, setRecording] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderMimeRef = useRef("");
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const theme = useSettingsStore((s) => s.theme);
  const cycleTheme = useSettingsStore((s) => s.cycleTheme);

  useEffect(() => {
    return subscribeMobileEditor(() => setEditor(getActiveMobileEditor()));
  }, []);

  // Float above the on-screen keyboard. When the soft keyboard rises,
  // window.visualViewport.height shrinks and offsetTop grows; the
  // amount of layout viewport hidden behind the keyboard equals
  // (window.innerHeight - vv.height - vv.offsetTop). Anchor the
  // toolbar's `bottom` to that gap so it sits on top of the keyboard.
  useEffect(() => {
    if (!isTouch) return;
    const vv = window.visualViewport;
    const apply = () => {
      const node = containerRef.current;
      if (!node) return;
      if (!vv) {
        node.style.bottom = "";
        return;
      }
      const hiddenBelow = Math.max(
        0,
        Math.round(window.innerHeight - vv.height - vv.offsetTop),
      );
      node.style.bottom = `${hiddenBelow}px`;
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
  }, [isTouch, editor]);

  if (!isTouch || !editor) return null;

  const blockId = editor.blockId;

  const keepFocus = (e: React.PointerEvent | React.MouseEvent) => {
    e.preventDefault();
  };

  const guard = async (label: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
    } catch (err) {
      logMobileDebug("mobile-toolbar.error", label, { error: String(err) });
    }
  };

  const flushBeforeAction = async () => {
    try {
      await editor.flush();
    } catch {
      /* ignore — store handles errors */
    }
  };

  const wrap = (prefix: string, suffix?: string) => editor.wrap(prefix, suffix);

  const insertText = (text: string) => editor.wrap(text, "");

  const cleanupRecorder = () => {
    recorderRef.current = null;
    recorderMimeRef.current = "";
    recorderChunksRef.current = [];
    recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
    recorderStreamRef.current = null;
    setRecording(false);
  };

  useEffect(() => {
    return () => {
      cleanupRecorder();
    };
  }, []);

  const onPickImage = () =>
    guard("pickImage", async () => {
      const files = await pickGalleryImages();
      if (!files.length) return;
      for (const f of files) {
        const bytes = await readFileBytes(f);
        const ref = await api.importImageBytes(f.name || "image.png", bytes);
        const alt = f.name?.replace(/\.[^.]+$/, "") || "image";
        insertText(`\n![${alt}](${ref.rel_path})\n`);
      }
      await flushBeforeAction();
    });

  // Pick the best mime type supported by this WebView. Order matters:
  // we prefer formats native <audio> can play back without transcoding.
  const pickRecorderMime = (): string => {
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
  };

  const extForMime = (mime: string): string => {
    if (mime.includes("mp4")) return "m4a";
    if (mime.includes("webm")) return "webm";
    if (mime.includes("ogg")) return "ogg";
    return "webm";
  };

  const saveRecordedBlob = async (blob: Blob, mime: string) => {
    const ext = extForMime(mime);
    const ts = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const fileName = `recording-${ts}.${ext}`;
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const ref = await api.importAudioBytes(fileName, bytes);
    insertText(`\n![audio](${ref.rel_path})\n`);
    await flushBeforeAction();
  };

  const startRecording = async (): Promise<boolean> => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia not available");
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
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) recorderChunksRef.current.push(e.data);
    });
    recorderChunksRef.current = [];
    recorderRef.current = recorder;
    recorderMimeRef.current = mime;
    recorderStreamRef.current = stream;
    recorder.start();
    setRecording(true);
    return true;
  };

  const stopRecording = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const finalMime = recorder.mimeType || recorderMimeRef.current || "audio/webm";
    const stopped = new Promise<Blob | null>((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          const chunks = recorderChunksRef.current;
          resolve(chunks.length ? new Blob(chunks, { type: finalMime }) : null);
        },
        { once: true },
      );
    });
    try {
      recorder.stop();
    } catch {
      cleanupRecorder();
      return;
    }
    const blob = await stopped;
    cleanupRecorder();
    if (!blob) return;
    await saveRecordedBlob(blob, finalMime);
  };

  // Fallback: hand off to the system voice recorder via <input capture>.
  const recordViaSystem = async (): Promise<File | null> => {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "audio/*";
      input.setAttribute("capture", "microphone");
      input.style.position = "fixed";
      input.style.left = "-9999px";
      document.body.appendChild(input);
      const cleanup = () => {
        if (input.parentNode) input.remove();
      };
      input.addEventListener(
        "change",
        () => {
          const f = input.files?.[0] ?? null;
          cleanup();
          resolve(f);
        },
        { once: true },
      );
      window.addEventListener(
        "focus",
        () => {
          window.setTimeout(() => {
            if (document.body.contains(input)) {
              cleanup();
              resolve(null);
            }
          }, 1500);
        },
        { once: true },
      );
      input.click();
    });
  };

  const onRecord = () =>
    guard("record", async () => {
      if (recording) {
        await stopRecording();
        return;
      }

      const ok = await confirmPermission({
        title: "申请录音权限",
        description: "应用将使用麦克风录制语音，并把录音直接保存到当前块。",
        details: "首次使用时，系统会再次询问是否允许访问麦克风。",
        rememberKey: "microphone",
      });
      if (!ok) return;

      try {
        if (await startRecording()) {
          logMobileDebug("mobile-toolbar.record.started", "recording");
        }
        return;
      } catch (err) {
        logMobileDebug("mobile-toolbar.record.in-app-failed", String(err));
      }

      // Fallback: system recorder via file picker.
      const file = await recordViaSystem();
      if (!file) return;
      const bytes = await readFileBytes(file);
      const ref = await api.importAudioBytes(
        file.name || "recording.m4a",
        bytes,
      );
      insertText(`\n![audio](${ref.rel_path})\n`);
      await flushBeforeAction();
    });

  const themeIcon = theme === "dark" ? "☀" : theme === "light" ? "🖥" : "🌙";
  const themeLabel =
    theme === "dark"
      ? "切换到浅色"
      : theme === "light"
        ? "跟随系统"
        : "切换到深色";

  return (
    <div
      ref={containerRef}
      className="mobile-edit-toolbar"
      role="toolbar"
      aria-label="编辑工具栏"
    >
      <button
        type="button"
        className="mobile-edit-btn"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={() => wrap("**")}
        aria-label="加粗"
        title="加粗 (Ctrl+B)"
      >
        <b>B</b>
      </button>
      <button
        type="button"
        className="mobile-edit-btn"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={() => wrap("*")}
        aria-label="斜体"
        title="斜体 (Ctrl+I)"
      >
        <i>I</i>
      </button>
      <button
        type="button"
        className="mobile-edit-btn"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={() => wrap("[[", "]]")}
        aria-label="链接"
        title="页面链接 (Ctrl+K)"
      >
        [[ ]]
      </button>
      <button
        type="button"
        className="mobile-edit-btn"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={() => wrap("`")}
        aria-label="代码"
        title="行内代码 (Ctrl+`)"
      >
        {"</>"}
      </button>
      <span className="mobile-edit-sep" aria-hidden />
      <button
        type="button"
        className="mobile-edit-btn"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={onPickImage}
        aria-label="插入图片"
        title="从图库选择图片"
      >
        🖼
      </button>
      <button
        type="button"
        className={`mobile-edit-btn${recording ? " mobile-edit-btn-recording" : ""}`}
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={onRecord}
        aria-label={recording ? "停止录音" : "开始录音"}
        title={recording ? "停止录音" : "开始录音"}
      >
        {recording ? "■" : "🎤"}
      </button>
      <button
        type="button"
        className="mobile-edit-btn"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={() => cycleTheme()}
        aria-label={themeLabel}
        title={themeLabel}
      >
        {themeIcon}
      </button>
      <span className="mobile-edit-sep" aria-hidden />
      <button
        type="button"
        className="mobile-edit-btn"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={() =>
          guard("outdent", async () => {
            await flushBeforeAction();
            await usePageStore.getState().outdent(blockId);
          })
        }
        aria-label="减少缩进"
        title="减少缩进 (Shift+Tab)"
      >
        ⇤
      </button>
      <button
        type="button"
        className="mobile-edit-btn"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={() =>
          guard("indent", async () => {
            await flushBeforeAction();
            await usePageStore.getState().indent(blockId);
          })
        }
        aria-label="增加缩进"
        title="增加缩进 (Tab)"
      >
        ⇥
      </button>
      <button
        type="button"
        className="mobile-edit-btn"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={() =>
          guard("moveUp", async () => {
            await flushBeforeAction();
            await usePageStore.getState().moveBlockUp(blockId);
          })
        }
        aria-label="上移"
        title="上移 (Alt+↑)"
      >
        ↑
      </button>
      <button
        type="button"
        className="mobile-edit-btn"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={() =>
          guard("moveDown", async () => {
            await flushBeforeAction();
            await usePageStore.getState().moveBlockDown(blockId);
          })
        }
        aria-label="下移"
        title="下移 (Alt+↓)"
      >
        ↓
      </button>
      <span className="mobile-edit-sep" aria-hidden />
      <button
        type="button"
        className="mobile-edit-btn"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={() =>
          guard("cycleTask", async () => {
            await flushBeforeAction();
            await usePageStore.getState().cycleTask(blockId);
          })
        }
        aria-label="切换任务状态"
        title="切换任务状态 (Ctrl+Enter)"
      >
        ✓
      </button>
      <button
        type="button"
        className="mobile-edit-btn mobile-edit-btn-primary"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={() =>
          guard("insertSibling", async () => {
            await flushBeforeAction();
            await usePageStore.getState().insertSibling(blockId, "");
          })
        }
        aria-label="新增同级块"
        title="新增同级块 (Enter)"
      >
        ↵
      </button>
    </div>
  );
}
