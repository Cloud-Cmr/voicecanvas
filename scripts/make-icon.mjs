/**
 * 生成应用图标 icon.ico（纯 Node，零依赖）
 *
 * 设计：深色圆角底 + 琥珀铜声波条（呼应 UI 主题）
 * ico 格式：PNG-in-ICO，写入 256/128/64/48/32/16 六档。
 * PNG 用 zlib 原始 deflate（stored blocks）+ CRC32 手写，全程零依赖。
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

// ---------- 采样绘制 ----------
function drawIcon(size) {
  // RGBA 像素缓冲
  const px = new Uint8Array(size * size * 4)
  const S = size / 256 // 缩放系数：以下坐标全部按 256 设计稿写

  const put = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a
  }

  // 背景：深色 #1a1c21 → #131417 垂直渐变，圆角矩形 mask
  const radius = 52 * S
  const inRounded = (x, y) => {
    const rx = Math.min(x, size - 1 - x)
    const ry = Math.min(y, size - 1 - y)
    if (rx >= radius || ry >= radius) return true
    const dx = radius - rx
    const dy = radius - ry
    return dx * dx + dy * dy <= radius * radius
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRounded(x, y)) continue
      const t = y / size
      // 竖直渐变 1a1c21(26,28,33) → 131417(19,20,23)
      const r = Math.round(26 + (19 - 26) * t)
      const g = Math.round(28 + (20 - 28) * t)
      const b = Math.round(33 + (23 - 33) * t)
      put(x, y, r, g, b)
    }
  }

  // 声波条：7 根圆头竖条，中间最高，模拟电平表
  // 设计稿：条宽 14，间距 10，区域居中，高度按正弦包络
  const barW = 14 * S
  const gap = 12 * S
  const n = 7
  const totalW = n * barW + (n - 1) * gap
  const startX = (size - totalW) / 2
  const centerY = size / 2
  const maxH = 108 * S
  const minH = 34 * S
  // 电平包络：中间高两边低 + 一点随机感（固定数组，视觉自然）
  const env = [0.42, 0.72, 0.95, 1.0, 0.88, 0.6, 0.38]

  for (let i = 0; i < n; i++) {
    const h = Math.max(minH, maxH * env[i])
    const x0 = startX + i * (barW + gap)
    const y0 = centerY - h / 2
    const y1 = centerY + h / 2
    // 颜色：中间最亮琥珀 #f2bd6d，向两端渐深 #b98634
    const mix = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2) // 0 中心 → 1 两端
    const cr = Math.round(242 + (185 - 242) * mix)
    const cg = Math.round(189 + (134 - 189) * mix)
    const cb = Math.round(109 + (52 - 109) * mix)

    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + barW); x++) {
        // 圆头：条端半圆 mask
        const cx = x0 + barW / 2
        const dx = Math.abs(x + 0.5 - cx)
        // 顶部半圆
        if (y + 0.5 < y0 + barW / 2) {
          const dy = y0 + barW / 2 - (y + 0.5)
          if (dx * dx + dy * dy > (barW / 2) ** 2) continue
        }
        // 底部半圆
        if (y + 0.5 > y1 - barW / 2) {
          const dy = y + 0.5 - (y1 - barW / 2)
          if (dx * dx + dy * dy > (barW / 2) ** 2) continue
        }
        put(x, y, cr, cg, cb)
      }
    }
  }

  return px
}

// ---------- PNG 编码（零依赖）----------
function crc32(buf) {
  let c
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c
    }
    return t
  })())
  c = 0 ^ -1
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff]
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(px, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // RGBA
  // raw: 每行前加 filter 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// ---------- ICO 包装（PNG-in-ICO）----------
function encodeIco(pngs) {
  // header: 6 bytes + 每图 16 bytes 目录
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type icon
  header.writeUInt16LE(pngs.length, 4)
  const dirSize = 16 * pngs.length
  let offset = 6 + dirSize
  const dirs = []
  const blobs = []
  for (const { size, png } of pngs) {
    const d = Buffer.alloc(16)
    d[0] = size >= 256 ? 0 : size
    d[1] = size >= 256 ? 0 : size
    d[2] = 0
    d[3] = 0
    d.writeUInt16LE(1, 4)
    d.writeUInt16LE(32, 6)
    d.writeUInt32LE(png.length, 8)
    d.writeUInt32LE(offset, 12)
    offset += png.length
    dirs.push(d)
    blobs.push(png)
  }
  return Buffer.concat([header, ...dirs, ...blobs])
}

// ---------- 生成 ----------
const outDir = process.argv[2] || 'build'
mkdirSync(outDir, { recursive: true })

const sizes = [256, 128, 64, 48, 32, 16]
const pngs = sizes.map((size) => ({
  size,
  png: encodePng(drawIcon(size), size),
}))

writeFileSync(path.join(outDir, 'icon.ico'), encodeIco(pngs))
// 顺手输出一张 256 png 给 README/打包用
writeFileSync(path.join(outDir, 'icon.png'), pngs[0].png)
console.log(`icon.ico (${sizes.join('/')}px) + icon.png → ${outDir}`)
