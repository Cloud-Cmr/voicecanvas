/**
 * WAV 拼接工具（主进程）
 *
 * 长文本分段合成的最后一步：把多个 24kHz/16bit/mono 的 WAV
 * 无损拼接为一个文件（去多余文件头，合并 data 块）。
 * 同时给段落之间插入 300ms 静音，听感自然。
 */

const SAMPLE_RATE = 24000
const CHANNELS = 1
const BYTES_PER_SAMPLE = 2
const GAP_MS = 300

interface WavInfo {
  dataOffset: number
  dataLength: number
}

/** 解析标准 WAV 的 RIFF/fmt/data 结构 */
function parseWav(buf: Buffer): WavInfo {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('不是合法的 WAV 文件')
  }
  let pos = 12
  let fmt: { rate: number; channels: number; bits: number } | null = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(pos + 10),
        rate: buf.readUInt32LE(pos + 12),
        bits: buf.readUInt16LE(pos + 22),
      }
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV 缺少 fmt 块')
      if (fmt.rate !== SAMPLE_RATE || fmt.channels !== CHANNELS || fmt.bits !== 16) {
        throw new Error(`不支持的 WAV 规格：${fmt.rate}Hz/${fmt.channels}ch/${fmt.bits}bit，需要 24kHz/mono/16bit`)
      }
      return { dataOffset: pos + 8, dataLength: Math.min(size, buf.length - pos - 8) }
    }
    pos += 8 + size + (size % 2)
  }
  throw new Error('WAV 缺少 data 块')
}

/** 生成 44 字节标准 WAV 头 */
function wavHeader(dataLen: number): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + dataLen, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(CHANNELS, 22)
  h.writeUInt32LE(SAMPLE_RATE, 24)
  h.writeUInt32LE(SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE, 28)
  h.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(dataLen, 40)
  return h
}

/**
 * 拼接多个 WAV Buffer。非 WAV（如 mp3）直接抛错，由调用方决定降级。
 * 返回合并后的完整 WAV Buffer。
 */
export function concatWavs(buffers: Buffer[]): Buffer {
  if (!buffers.length) throw new Error('没有可拼接的音频')
  if (buffers.length === 1) return buffers[0]

  const parts: Buffer[] = []
  let total = 0
  for (const b of buffers) {
    const info = parseWav(b)
    parts.push(b.subarray(info.dataOffset, info.dataOffset + info.dataLength))
    total += info.dataLength
  }

  // 段间静音
  const gapLen = Math.round((SAMPLE_RATE * GAP_MS) / 1000) * CHANNELS * BYTES_PER_SAMPLE
  const silence = Buffer.alloc(gapLen)

  const chunks: Buffer[] = []
  parts.forEach((p, i) => {
    if (i > 0) {
      chunks.push(silence)
      total += gapLen
    }
    chunks.push(p)
  })

  return Buffer.concat([wavHeader(total), ...chunks])
}
