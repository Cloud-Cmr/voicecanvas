/**
 * 生成 Android 各密度启动图标（复用画法，指定尺寸）
 * 输出到 android/app/src/main/res/mipmap-{density}/ic_launcher.png
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'

function crc32(buf) {
  let c
  const t =
    crc32.t ||
    (crc32.t = (() => {
      const a = new Int32Array(256)
      for (let n = 0; n < 256; n++) {
        c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        a[n] = c
      }
      return a
    })())
  c = 0 ^ -1
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ t[(c ^ buf[i]) & 0xff]
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const tb = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([tb, data])))
  return Buffer.concat([len, tb, data, crc])
}

function drawIcon(size) {
  const px = new Uint8Array(size * size * 4)
  const S = size / 256
  const radius = 52 * S
  const inR = (x, y) => {
    const rx = Math.min(x, size - 1 - x)
    const ry = Math.min(y, size - 1 - y)
    if (rx >= radius || ry >= radius) return true
    const dx = radius - rx
    const dy = radius - ry
    return dx * dx + dy * dy <= radius * radius
  }
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    px[i] = r
    px[i + 1] = g
    px[i + 2] = b
    px[i + 3] = 255
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inR(x, y)) continue
      const t = y / size
      put(x, y, Math.round(26 + (19 - 26) * t), Math.round(28 + (20 - 28) * t), Math.round(33 + (23 - 33) * t))
    }
  }

  const barW = 14 * S
  const gap = 12 * S
  const n = 7
  const totalW = n * barW + (n - 1) * gap
  const startX = (size - totalW) / 2
  const centerY = size / 2
  const maxH = 108 * S
  const minH = 34 * S
  const env = [0.42, 0.72, 0.95, 1.0, 0.88, 0.6, 0.38]

  for (let i = 0; i < n; i++) {
    const h = Math.max(minH, maxH * env[i])
    const x0 = startX + i * (barW + gap)
    const y0 = centerY - h / 2
    const y1 = centerY + h / 2
    const mix = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2)
    const cr = Math.round(242 + (185 - 242) * mix)
    const cg = Math.round(189 + (134 - 189) * mix)
    const cb = Math.round(109 + (52 - 109) * mix)
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + barW); x++) {
        const cx = x0 + barW / 2
        const dx = Math.abs(x + 0.5 - cx)
        if (y + 0.5 < y0 + barW / 2) {
          const dy = y0 + barW / 2 - (y + 0.5)
          if (dx * dx + dy * dy > (barW / 2) ** 2) continue
        }
        if (y + 0.5 > y1 - barW / 2) {
          const dy = y + 0.5 - (y1 - barW / 2)
          if (dx * dx + dy * dy > (barW / 2) ** 2) continue
        }
        put(x, y, cr, cg, cb)
      }
    }
  }

  // PNG
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

const densities = [
  { dir: 'mipmap-mdpi', size: 48 },
  { dir: 'mipmap-hdpi', size: 72 },
  { dir: 'mipmap-xhdpi', size: 96 },
  { dir: 'mipmap-xxhdpi', size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
]

const resRoot = 'android/app/src/main/res'
for (const d of densities) {
  const dir = path.join(resRoot, d.dir)
  mkdirSync(dir, { recursive: true })
  const png = drawIcon(d.size)
  writeFileSync(path.join(dir, 'ic_launcher.png'), png)
  writeFileSync(path.join(dir, 'ic_launcher_round.png'), png)
  writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), png)
  console.log(`${d.dir}: ${d.size}x${d.size}`)
}
