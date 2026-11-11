/**
 * MiMo TTS Provider
 *
 * 兼容 OpenAI /v1/chat/completions 协议，但有几个 must-know 的坑：
 * 1. 要合成的正文必须放 assistant 消息，user 消息是风格指令
 * 2. voicedesign 模式 user 消息 = 音色描述本身，必填，且不能传 audio.voice
 * 3. voiceclone 的 voice 必须是 data:<mime>;base64,<b64> 形式，10MB 上限
 * 4. 流式只有 preset 是真流式，design/clone 是"跑完一次性吐"的兼容模式
 * 5. 流式返回 pcm16 裸流，需要自己拼 WAV 头
 */

import type {
  AudioFormat,
  ModelMap,
  SynthRequest,
  TokenUsage,
} from '../../shared/types'
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODELS,
  PRESET_VOICES,
  CLONE_SAMPLE_MAX_BYTES,
} from '../../shared/constants'

export { DEFAULT_BASE_URL, DEFAULT_MODELS, PRESET_VOICES, CLONE_SAMPLE_MAX_BYTES }

/** 空闲超时：流式接口不主动关连接，必须自己兜底 */
const IDLE_TIMEOUT_MS = 60_000
const TOTAL_TIMEOUT_MS = 300_000

export class TtsError extends Error {
  code: string
  detail?: string
  constructor(code: string, message: string, detail?: string) {
    super(message)
    this.code = code
    this.detail = detail
  }
}

export interface MimoRawResult {
  audio: Buffer
  format: AudioFormat
  finalTextPreview?: string
  usage?: TokenUsage
  firstByteMs?: number
  elapsedMs: number
}

function buildMessages(req: SynthRequest): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = []

  if (req.mode === 'design') {
    // design 模式：user 内容就是音色描述，必填
    const desc = (req.designPrompt || '').trim()
    if (!desc) {
      throw new TtsError('E_DESIGN_PROMPT_REQUIRED', '音色设计模式必须填写音色描述')
    }
    messages.push({ role: 'user', content: desc })
  } else {
    const instruction = (req.instruction || '').trim()
    if (instruction) messages.push({ role: 'user', content: instruction })
  }

  const text = (req.text || '').trim()
  // design + optimizeTextPreview 时允许省略正文
  if (text) {
    messages.push({ role: 'assistant', content: text })
  } else if (!(req.mode === 'design' && req.optimizeTextPreview)) {
    throw new TtsError('E_TEXT_REQUIRED', '合成文本不能为空')
  }

  return messages
}

function encodeCloneSample(sample: Buffer, filePath: string): string {
  const lower = filePath.toLowerCase()
  let mime: string
  if (lower.endsWith('.mp3')) mime = 'audio/mpeg'
  else if (lower.endsWith('.wav')) mime = 'audio/wav'
  else {
    throw new TtsError('E_SAMPLE_FORMAT', '音色样本仅支持 mp3 / wav 格式')
  }
  const b64 = sample.toString('base64')
  if (b64.length > 10 * 1024 * 1024) {
    throw new TtsError('E_SAMPLE_TOO_LARGE', '音色样本编码后超过 10MB 上限，请裁剪或压缩')
  }
  return `data:${mime};base64,${b64}`
}

function buildPayload(
  req: SynthRequest,
  models: ModelMap,
  cloneSample?: { buffer: Buffer; path: string },
): Record<string, unknown> {
  const stream = !!req.stream && req.mode === 'preset'

  let model: string
  if (req.mode === 'design') model = models.design
  else if (req.mode === 'clone') model = models.clone
  else model = models.preset

  const audio: Record<string, unknown> = {
    // 流式必须 pcm16 以便拼接
    format: stream ? 'pcm16' : req.format === 'pcm16' ? 'wav' : req.format,
  }

  if (req.mode === 'preset') {
    audio.voice = req.voiceId || 'mimo_default'
  } else if (req.mode === 'clone') {
    if (!cloneSample) {
      throw new TtsError('E_SAMPLE_REQUIRED', '音色克隆模式必须提供音色样本')
    }
    audio.voice = encodeCloneSample(cloneSample.buffer, cloneSample.path)
  } else if (req.mode === 'design') {
    // design 不支持 audio.voice，明确不传
    if (req.optimizeTextPreview) audio.optimize_text_preview = true
  }

  return {
    model,
    messages: buildMessages(req),
    audio,
    ...(stream ? { stream: true } : {}),
  }
}

/** 把 pcm16 mono 24kHz 裸流包成 WAV */
export function pcm16ToWav(pcm: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const byteRate = sampleRate * channels * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

function mapHttpError(status: number, body: string): TtsError {
  let msg = body.slice(0, 500)
  try {
    const j = JSON.parse(body)
    if (j?.error?.message) msg = j.error.message
  } catch {
    /* 保留原文 */
  }
  if (status === 401 || status === 403) {
    return new TtsError('E_AUTH', `鉴权失败（${status}）：请检查 API Key 是否正确`, msg)
  }
  if (status === 429) {
    return new TtsError('E_RATE_LIMIT', '请求过于频繁，请稍后重试', msg)
  }
  if (status === 400) {
    return new TtsError('E_BAD_REQUEST', `请求参数有误：${msg}`, msg)
  }
  return new TtsError('E_HTTP', `接口返回 ${status}：${msg}`, msg)
}

export interface MimoClientOptions {
  apiKey: string
  baseUrl?: string
  models?: ModelMap
  /** 流式进度回调 */
  onProgress?: (receivedBytes: number, elapsedMs: number) => void
  signal?: AbortSignal
}

export async function synthesize(
  req: SynthRequest,
  opts: MimoClientOptions,
  cloneSample?: { buffer: Buffer; path: string },
): Promise<MimoRawResult> {
  const baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const models = opts.models || DEFAULT_MODELS
  const payload = buildPayload(req, models, cloneSample)
  const stream = !!req.stream && req.mode === 'preset'
  const started = Date.now()

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onAbort, { once: true })

  // 总超时兜底
  const totalTimer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS)

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'api-key': opts.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text()
      throw mapHttpError(res.status, body)
    }

    if (!stream) {
      const json = (await res.json()) as any
      const b64 = json?.choices?.[0]?.message?.audio?.data
      if (!b64) {
        throw new TtsError(
          'E_NO_AUDIO',
          '服务端未返回音频数据',
          JSON.stringify(json).slice(0, 800),
        )
      }
      return {
        audio: Buffer.from(b64, 'base64'),
        format: (req.format === 'pcm16' ? 'wav' : req.format) as AudioFormat,
        finalTextPreview: json?.choices?.[0]?.message?.final_text_preview,
        usage: json?.usage
          ? {
              promptTokens: json.usage.prompt_tokens ?? 0,
              completionTokens: json.usage.completion_tokens ?? 0,
              totalTokens: json.usage.total_tokens ?? 0,
            }
          : undefined,
        elapsedMs: Date.now() - started,
      }
    }

    // ===== 流式分支 =====
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const chunks: Buffer[] = []
    let buf = ''
    let received = 0
    let firstByteMs: number | undefined
    let finalTextPreview: string | undefined
    let usage: TokenUsage | undefined

    let idleTimer: NodeJS.Timeout | undefined
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS)
    }
    resetIdle()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        resetIdle()
        buf += decoder.decode(value, { stream: true })

        let idx: number
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim()
          buf = buf.slice(idx + 1)
          if (!line.startsWith('data:')) continue
          const payloadStr = line.slice(5).trim()
          if (!payloadStr || payloadStr === '[DONE]') continue
          try {
            const chunk = JSON.parse(payloadStr)
            const audioData = chunk?.choices?.[0]?.delta?.audio?.data
            if (audioData) {
              const b = Buffer.from(audioData, 'base64')
              if (!firstByteMs) firstByteMs = Date.now() - started
              chunks.push(b)
              received += b.length
              opts.onProgress?.(received, Date.now() - started)
            }
            const fpt = chunk?.choices?.[0]?.delta?.final_text_preview
            if (fpt) finalTextPreview = fpt
            if (chunk?.usage) {
              usage = {
                promptTokens: chunk.usage.prompt_tokens ?? 0,
                completionTokens: chunk.usage.completion_tokens ?? 0,
                totalTokens: chunk.usage.total_tokens ?? 0,
              }
            }
          } catch {
            /* 跳过不合法行 */
          }
        }
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
      try {
        await reader.cancel()
      } catch {
        /* ignore */
      }
    }

    if (!chunks.length) {
      throw new TtsError('E_NO_AUDIO', '流式响应未收到任何音频数据')
    }

    return {
      audio: pcm16ToWav(Buffer.concat(chunks)),
      format: 'wav',
      finalTextPreview,
      usage,
      firstByteMs,
      elapsedMs: Date.now() - started,
    }
  } catch (err: any) {
    if (err instanceof TtsError) throw err
    if (err?.name === 'AbortError') {
      throw new TtsError('E_TIMEOUT', '请求超时或被取消，请检查网络后重试')
    }
    throw new TtsError('E_NETWORK', `网络请求失败：${err?.message || err}`)
  } finally {
    clearTimeout(totalTimer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

/** 探测 Key 是否有效 */
export async function verifyKey(
  apiKey: string,
  baseUrl = DEFAULT_BASE_URL,
): Promise<{ ok: boolean; models?: string[]; message?: string }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { 'api-key': apiKey },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      return { ok: false, message: `鉴权失败（HTTP ${res.status}）` }
    }
    const json = (await res.json()) as any
    const models = Array.isArray(json?.data) ? json.data.map((m: any) => m.id) : []
    return { ok: true, models }
  } catch (err: any) {
    return { ok: false, message: `连接失败：${err?.message || err}` }
  }
}
