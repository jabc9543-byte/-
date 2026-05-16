// 生成简单的占位图标（蓝底白色 📎 字符）。
// 不依赖任何 npm 包，输出最小化 PNG。
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function crc32(buf) {
  let c, crcTable = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// 生成 size x size 的纯色 PNG（带圆角风格的简化处理：边角少量像素透明）
function makePng(size, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihd = Buffer.alloc(13);
  ihd.writeUInt32BE(size, 0);
  ihd.writeUInt32BE(size, 4);
  ihd[8] = 8;   // bit depth
  ihd[9] = 6;   // RGBA
  ihd[10] = 0;
  ihd[11] = 0;
  ihd[12] = 0;
  const ihdr = chunk("IHDR", ihd);

  const row = Buffer.alloc(size * 4 + 1);
  // 朴素圆角：四角 2 像素透明
  const lines = [];
  for (let y = 0; y < size; y++) {
    const r = Buffer.alloc(size * 4 + 1);
    r[0] = 0; // filter type none
    for (let x = 0; x < size; x++) {
      const off = 1 + x * 4;
      const cornerCut = Math.max(1, Math.round(size / 8));
      const inCorner =
        (x < cornerCut && y < cornerCut) ||
        (x >= size - cornerCut && y < cornerCut) ||
        (x < cornerCut && y >= size - cornerCut) ||
        (x >= size - cornerCut && y >= size - cornerCut);
      // 边缘些许圆滑
      const dx = Math.min(x, size - 1 - x);
      const dy = Math.min(y, size - 1 - y);
      const dist = Math.sqrt((cornerCut - dx) ** 2 + (cornerCut - dy) ** 2);
      const transparent = inCorner && (dx < cornerCut - 1 && dy < cornerCut - 1) && dist > cornerCut;
      if (transparent) {
        r[off] = 0; r[off + 1] = 0; r[off + 2] = 0; r[off + 3] = 0;
      } else {
        r[off] = rgb[0];
        r[off + 1] = rgb[1];
        r[off + 2] = rgb[2];
        r[off + 3] = 255;
      }
    }
    lines.push(r);
  }
  const raw = Buffer.concat(lines);
  const idatData = zlib.deflateSync(raw, { level: 9 });
  const idat = chunk("IDAT", idatData);
  const iend = chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

const outDir = path.resolve(__dirname, "..", "web-clipper-extension", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  const png = makePng(size, [37, 99, 235]); // #2563eb
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
  console.log("wrote", path.join(outDir, `icon-${size}.png`), png.length, "bytes");
}
