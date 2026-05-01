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

    input.click();
  });
}

export async function requestCameraAccess() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前环境不支持摄像头权限请求");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  for (const track of stream.getTracks()) track.stop();
}

export async function requestGalleryAccess() {
  const files = await pickFiles("image/*", true);
  return files.length;
}

export async function requestFileAccess() {
  const files = await pickFiles(".md,.markdown,.zip,.json,.opml,.sqlite,.db,*/*", true);
  return files.length;
}

export async function pickMarkdownFiles() {
  return pickFiles(".md,.markdown,text/markdown", true);
}