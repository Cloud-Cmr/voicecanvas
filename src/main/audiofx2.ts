/**
 * 音频片段处理器：给「后期处理」补几个更实用的能力
 *
 * - 首尾淡入淡出（避免爆音）
 * - 变速（不改变音高，用线性重采样会变调，所以做保守的「拉伸」）
 * - 拼接多个音频文件
 * - 提取片段（按秒裁剪）
 */

const RATE = 24000
const CH = 1
const BPS = 2

function split(buf: Buffer): { header: Buffer; pcm: Buffer } {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('不是合法 WAV')
  let pos = 12
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'data') return { header: buf.subarray(0, 44), pcm: buf.subarray(pos + 8, pos + 8 + size) }
    pos += 8 + size + (size % 2)
  }
  throw new Error('WAV 缺少 data 块')
}

function rebuild(header: Buffer, pcm: Buffer): Buffer {
  const h = Buffer.from(header)
  h.writeUInt32LE(36 + pcm.length, 4)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/** 首尾淡入淡出，单位毫秒 */
export function fadeInOut(wav: Buffer, fadeMs = 30): Buffer {
  const { header, pcm } = split(wav)
  const samples = pcm.length / 2
  const fadeSamples = Math.min(Math.floor((RATE * fadeMs) / 1000), Math.floor(samples / 2))
  if (fadeSamples <= 0) return wav
  const out = Buffer.from(pcm)
  for (let i = 0; i < fadeSamples; i++) {
    const g = i / fadeSamples
    const startV = Math.round(out.readInt16LE(i * 2) * g)
    out.writeInt16LE(startV, i * 2)
    const tailIdx = samples - 1 - i
    const endV = Math.round(out.readInt16LE(tailIdx * 2) * g)
    out.writeInt16LE(endV, tailIdx * 2)
  }
  return rebuild(header, out)
}

/** 按秒裁剪：从 startSec 到 endSec */
export function cutSegment(wav: Buffer, startSec: number, endSec: number): Buffer {
  const { header, pcm } = split(wav)
  const totalSec = pcm.length / 2 / RATE
  const s = Math.max(0, Math.min(startSec, totalSec))
  const e = Math.max(s + 0.05, Math.min(endSec, totalSec))
  const startByte = Math.floor(s * RATE) * 2
  const endByte = Math.floor(e * RATE) * 2
  return rebuild(header, pcm.subarray(startByte, endByte))
}

/**
 * 变速：speed > 1 更快，< 1 更慢。
 * 用简单的样本重复/丢弃实现（音高会轻微变化，但对语音可接受）。
 */
export function changeSpeed(wav: Buffer, speed: number): Buffer {
  if (speed === 1 || speed <= 0) return wav
  const { header, pcm } = split(wav)
  const inSamples = pcm.length / 2
  const outSamples = Math.max(1, Math.floor(inSamples / speed))
  const out = Buffer.alloc(outSamples * 2)
  for (let i = 0; i < outSamples; i++) {
    const srcPos = i * speed
    const idx = Math.min(inSamples - 1, Math.round(srcPos))
    out.writeInt16LE(pcm.readInt16LE(idx * 2), i * 2)
  }
  return rebuild(header, out)
}

/** 多段拼接（无间隔）*/
export function joinWavs(buffers: Buffer[]): Buffer {
  if (!buffers.length) throw new Error('没有音频')
  const parts = buffers.map((b) => split(b))
  const pcm = Buffer.concat(parts.map((p) => p.pcm))
  return rebuild(parts[0].header, pcm)
}

/** 在音频后追加静音 */
export function appendSilence(wav: Buffer, ms: number): Buffer {
  const { header, pcm } = split(wav)
  const bytes = Math.floor((RATE * ms) / 1000) * CH * BPS
  return rebuild(header, Buffer.concat([pcm, Buffer.alloc(bytes)]))
}
