/**
 * MiMo ASR provider（mimo-v2.5-asr）
 *
 * 已实测的 API 规格（2026-11-12）：
 * - 走 /v1/chat/completions（和 TTS 同端点）
 * - user 消息 content 只能放 input_audio 块，【不能带 text 块】
 *   （带了会报 "ASR request must not include text parts; text prompt is injected by the gateway"）
 * - 音频用 base64 + format 字段，支持 wav
 * - 转写结果在 choices[0].message.content
 * - usage.prompt_tokens_details.audio_tokens 是音频 token 数；usage.seconds 是音频时长
 */

import { DEFAULT_BASE_URL } from '../../shared/constants'
import { TtsError } from './mimo'

export const DEFAULT_ASR_MODEL = 'mimo-v2.5-asr'

export interface AsrResult {
  text: string
  /** 音频时长（秒，服务端返回） */
  seconds?: number
  usage?: {
    audioTokens?: number
    totalTokens?: number
  }
  elapsedMs: number
}

const ASR_MAX_BYTES = 10 * 1024 * 1024

export async function transcribe(
  audio: Buffer,
  format: 'wav' | 'mp3',
  opts: { apiKey: string; baseUrl?: string; model?: string; signal?: AbortSignal },
): Promise<AsrResult> {
  if (audio.length > ASR_MAX_BYTES) {
    throw new TtsError('E_ASR_TOO_LARGE', '音频超过 10MB，请先裁剪')
  }

  const started = Date.now()
  const baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')

  let res: Response
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'api-key': opts.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model || DEFAULT_ASR_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: {
                  data: audio.toString('base64'),
                  format,
                },
              },
            ],
          },
        ],
        stream: false,
      }),
      signal: opts.signal ?? AbortSignal.timeout(120_000),
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new TtsError('E_TIMEOUT', '转写超时或被取消')
    }
    throw new TtsError('E_NETWORK', `网络请求失败：${err?.message || err}`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let msg = body.slice(0, 300)
    try {
      const j = JSON.parse(body)
      if (j?.error?.message) msg = j.error.message
    } catch {
      /* keep */
    }
    if (res.status === 401 || res.status === 403) {
      throw new TtsError('E_AUTH', `鉴权失败（${res.status}）：请检查 API Key`)
    }
    throw new TtsError('E_ASR_HTTP', `转写接口返回 ${res.status}：${msg}`)
  }

  const json = (await res.json()) as any
  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new TtsError('E_ASR_EMPTY', '服务端没有返回转写文本', JSON.stringify(json).slice(0, 400))
  }

  return {
    text: content.trim(),
    seconds: json?.usage?.seconds,
    usage: {
      audioTokens: json?.usage?.prompt_tokens_details?.audio_tokens,
      totalTokens: json?.usage?.total_tokens,
    },
    elapsedMs: Date.now() - started,
  }
}
