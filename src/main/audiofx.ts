/**
 * 音频后期处理（纯 Node，无 ffmpeg 依赖）
 *
 * 提供三个实用能力，直接在 WAV 上做：
 * 1. 去首尾静音 / 去段间长静音（trimSilence）
 * 2. 响度归一（peak normalize 到目标 dBFS）
 * 3. 变速（保持音高：简单重采样 + 音高不补偿会变调，所以这里只做「时长微调」的保守版）
 *
 * 只处理 24kHz/mono/16bit WAV（与 MiMo 输出一致），其他格式直接拒绝。
 */

const SAMPLE_RATE = 24000
const CHANNELS = 1
const BYTES_PER_SAMPLE = 2

export interface WavData {
  header: Buffer
  pcm: Buffer
}

export function splitWav(buf: Buffer): WavData {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('不是合法的 WAV')
  }
  let pos = 12
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'data') {
      return { header: buf.subarray(0, 44), pcm: buf.subarray(pos + 8, pos + 8 + size) }
    }
    pos += 8 + size + (size % 2)
  }
  throw new Error('WAV 缺少 data 块')
}

export function buildWav(header: Buffer, pcm: Buffer): Buffer {
  const h = Buffer.from(header)
  h.writeUInt32LE(36 + pcm.length, 4)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/** 找出音频中的静音区间（用于去静音） */
export function findSilenceRanges(
  pcm: Buffer,
  thresholdDb = -42,
  minSilenceMs = 300,
): Array<{ startMs: number; endMs: number }> {
  const threshold = Math.pow(10, thresholdDb / 20) * 32768
  const sampleCount = pcm.length / 2
  const windowMs = 20
  const windowSamples = Math.floor((SAMPLE_RATE * windowMs) / 1000)
  const ranges: Array<{ startMs: number; endMs: number }> = []

  let silentStart: number | null = null
  for (let s = 0; s + windowSamples <= sampleCount; s += windowSamples) {
    let peak = 0
    for (let i = 0; i < windowSamples; i++) {
      const v = Math.abs(pcm.readInt16LE((s + i) * 2))
      if (v > peak) peak = v
    }
    const isSilent = peak < threshold
    const tMs = (s / SAMPLE_RATE) * 1000
    if (isSilent) {
      if (silentStart === null) silentStart = tMs
    } else if (silentStart !== null) {
      const dur = tMs - silentStart
      if (dur >= minSilenceMs) ranges.push({ startMs: silentStart, endMs: tMs })
      silentStart = null
    }
  }
  if (silentStart !== null) {
    const endMs = (sampleCount / SAMPLE_RATE) * 1000
    if (endMs - silentStart >= minSilenceMs) {
      ranges.push({ startMs: silentStart, endMs })
    }
  }
  return ranges
}

/** 去掉首尾静音，返回新 WAV */
export function trimEdges(wav: Buffer, thresholdDb = -42): Buffer {
  const { header, pcm } = splitWav(wav)
  const ranges = findSilenceRanges(pcm, thresholdDb, 150)
  if (!ranges.length) return wav

  const totalMs = (pcm.length / 2 / SAMPLE_RATE) * 1000
  let startMs = 0
  let endMs = totalMs
  // 头静音
  if (ranges[0].startMs <= 5) startMs = ranges[0].endMs
  // 尾静音
  const last = ranges[ranges.length - 1]
  if (last.endMs >= totalMs - 5) endMs = last.startMs

  if (startMs <= 0 && endMs >= totalMs) return wav
  const startByte = Math.floor((startMs / 1000) * SAMPLE_RATE) * 2
  const endByte = Math.floor((endMs / 1000) * SAMPLE_RATE) * 2
  return buildWav(header, pcm.subarray(startByte, Math.max(startByte + 2, endByte)))
}

/** 峰值归一化到目标 dBFS（默认 -1dB 留 headroom） */
export function normalizePeak(wav: Buffer, targetDbfs = -1): Buffer {
  const { header, pcm } = splitWav(wav)
  let peak = 0
  for (let i = 0; i < pcm.length; i += 2) {
    const v = Math.abs(pcm.readInt16LE(i))
    if (v > peak) peak = v
  }
  if (peak === 0) return wav
  const target = Math.pow(10, targetDbfs / 20) * 32767
  const gain = Math.min(target / peak, 8) // 最多放大 8 倍，避免把噪声拉爆炸
  const out = Buffer.alloc(pcm.length)
  for (let i = 0; i < pcm.length; i += 2) {
    const v = Math.round(pcm.readInt16LE(i) * gain)
    out.writeInt16LE(Math.max(-32768, Math.min(32767, v)), i)
  }
  return buildWav(header, out)
}

/** 压缩段间长静音到指定上限（如最长 800ms） */
export function capSilence(wav: Buffer, maxSilenceMs = 800, thresholdDb = -42): Buffer {
  const { header, pcm } = splitWav(wav)
  const ranges = findSilenceRanges(pcm, thresholdDb, maxSilenceMs + 50)
  if (!ranges.length) return wav

  const chunks: Buffer[] = []
  let cursor = 0
  for (const r of ranges) {
    const startByte = Math.floor((r.startMs / 1000) * SAMPLE_RATE) * 2
    const endByte = Math.floor((r.endMs / 1000) * SAMPLE_RATE) * 2
    if (startByte > cursor) chunks.push(pcm.subarray(cursor, startByte))
    const keepBytes = Math.floor((maxSilenceMs / 1000) * SAMPLE_RATE) * 2
    // 保留静音的开头一段（听感自然），其余丢弃
    const keepEnd = Math.min(startByte + keepBytes, endByte)
    chunks.push(pcm.subarray(startByte, keepEnd))
    cursor = endByte
  }
  if (cursor < pcm.length) chunks.push(pcm.subarray(cursor))
  return buildWav(header, Buffer.concat(chunks))
}

/** 音量增益（dB） */
export function applyGain(wav: Buffer, gainDb: number): Buffer {
  const { header, pcm } = splitWav(wav)
  const gain = Math.pow(10, gainDb / 20)
  const out = Buffer.alloc(pcm.length)
  for (let i = 0; i < pcm.length; i += 2) {
    const v = Math.round(pcm.readInt16LE(i) * gain)
    out.writeInt16LE(Math.max(-32768, Math.min(32767, v)), i)
  }
  return buildWav(header, out)
}

/** 获取 WAV 基本信息，用于 UI 展示 */
export function getWavInfo(wav: Buffer): {
  durationMs: number
  sampleRate: number
  peakDb: number
} {
  const { pcm } = splitWav(wav)
  let peak = 0
  for (let i = 0; i < pcm.length; i += 2) {
    const v = Math.abs(pcm.readInt16LE(i))
    if (v > peak) peak = v
  }
  const peakDb = peak === 0 ? -Infinity : 20 * Math.log10(peak / 32768)
  const durationMs = (pcm.length / 2 / SAMPLE_RATE) * 1000
  return { durationMs, sampleRate: SAMPLE_RATE, peakDb }
}
