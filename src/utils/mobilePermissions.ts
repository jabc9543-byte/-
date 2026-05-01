import { confirmPermission } from "./permissionConfirm";

function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);

    const cleanup = () => {
      input.remove();
    };

    input.addEventListener(
      "change",
      () => {
        const files = Array.from(input.files ?? []);
        cleanup();
        resolve(files);
      },
      { once: true },
    );
    // Some Android WebViews never fire `change` if the user cancels —
    // clean up on focus return as a safety net.
    window.addEventListener(
      "focus",
      () => {
        window.setTimeout(() => {
          if (document.body.contains(input)) {
            cleanup();
            resolve([]);
          }
        }, 800);
      },
      { once: true },
    );

    input.click();
  });
}

export class PermissionDeniedError extends Error {
  constructor(scope: string) {
    super(`用户拒绝了 ${scope} 权限请求`);
    this.name = "PermissionDeniedError";
  }
}

export async function requestCameraAccess() {
  const ok = await confirmPermission({
    title: "申请摄像头权限",
    description: "应用需要访问摄像头，用于拍照与扫描笔记。",
    details: "授权后，系统可能再次显示原生权限对话框。",
    rememberKey: "camera",
  });
  if (!ok) throw new PermissionDeniedError("摄像头");
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前环境不支持摄像头权限请求");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  for (const track of stream.getTracks()) track.stop();
}

export async function requestGalleryAccess() {
  const ok = await confirmPermission({
    title: "申请图库访问",
    description: "应用需要访问相册，用于在笔记中插入图片。",
    details: "仅在你选择文件后才会读取，不会扫描整个相册。",
    rememberKey: "gallery",
  });
  if (!ok) throw new PermissionDeniedError("图库");
  const files = await pickFiles("image/*", true);
  return files.length;
}

export async function requestFileAccess() {
  const ok = await confirmPermission({
    title: "申请文件访问",
    description: "应用需要访问设备上的文件，用于导入 Markdown / 数据库等内容。",
    details: "仅会读取你主动选择的文件。",
    rememberKey: "files",
  });
  if (!ok) throw new PermissionDeniedError("文件");
  const files = await pickFiles(
    ".md,.markdown,.zip,.json,.opml,.sqlite,.db,*/*",
    true,
  );
  return files.length;
}

export async function pickMarkdownFiles() {
  const ok = await confirmPermission({
    title: "导入 Markdown",
    description: "应用需要访问你设备上的 .md 文件，将其复制进默认工作区。",
    details: "仅会读取你主动选择的文件。",
    rememberKey: "files",
  });
  if (!ok) throw new PermissionDeniedError("文件");
  return pickFiles(".md,.markdown,text/markdown", true);
}
