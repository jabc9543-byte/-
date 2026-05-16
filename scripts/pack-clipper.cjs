// 把 web-clipper-extension/ 压缩为 dist-extension/quanshiwei-web-clipper.zip
// 使用 Node 内置 PowerShell（Windows）或 zip（POSIX），尽量零依赖。
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "web-clipper-extension");
const outDir = path.join(root, "dist-extension");
const outZip = path.join(outDir, "quanshiwei-web-clipper.zip");

if (!fs.existsSync(src)) {
  console.error("源目录不存在：", src);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

try {
  if (process.platform === "win32") {
    // PowerShell Compress-Archive
    const cmd = `powershell -NoProfile -Command "Compress-Archive -Path '${src}\\*' -DestinationPath '${outZip}' -Force"`;
    execSync(cmd, { stdio: "inherit" });
  } else {
    execSync(`cd "${src}" && zip -r "${outZip}" .`, { stdio: "inherit", shell: "/bin/bash" });
  }
  const stat = fs.statSync(outZip);
  console.log("✅", path.relative(root, outZip), "(" + stat.size + " bytes)");
} catch (e) {
  console.error("打包失败：", e.message);
  process.exit(1);
}
