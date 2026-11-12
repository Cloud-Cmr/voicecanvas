/**
 * MiMo 文本模型 provider（mimo-v2.6-flash）
 *
 * 用于两个辅助能力：
 * 1. 把用户的粗糙想法润色成专业的音色描述
 * 2. 根据音色描述生成适配的合成文本（官方 Studio 有此能力，API 用户此前没有）
 *
 * 与 TTS 同一 base URL / 同一 Key，OpenAI 兼容 /chat/completions。
 */

import { DEFAULT_BASE_URL } from '../../shared/constants'
import { TtsError } from './mimo'

export const DEFAULT_LLM_MODEL = 'mimo-v2.6-flash'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatOptions {
  apiKey: string
  baseUrl?: string
  model?: string
  temperature?: number
  signal?: AbortSignal
}

async function chat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'api-key': opts.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model || DEFAULT_LLM_MODEL,
      messages,
      temperature: opts.temperature ?? 0.8,
      stream: false,
    }),
    signal: opts.signal ?? AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let msg = body.slice(0, 300)
    try {
      msg = JSON.parse(body)?.error?.message ?? msg
    } catch {
      /* keep */
    }
    throw new TtsError('E_LLM', `文本模型调用失败（${res.status}）：${msg}`)
  }
  const json = (await res.json()) as any
  const content = json?.choices?.[0]?.message?.content
  if (!content) throw new TtsError('E_LLM_EMPTY', '文本模型没有返回内容')
  return String(content).trim()
}

/** 把用户的粗糙想法扩写成专业音色描述（1-4 句，多维度覆盖） */
export async function polishVoiceDescription(
  idea: string,
  opts: ChatOptions,
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是顶级的配音导演。用户会给你一个粗糙的声音想法，你要把它扩写成一段专业的音色描述（Voice Design prompt），供 TTS 音色设计模型使用。\n' +
        '硬性规则：\n' +
        '- 输出只有描述本身，不要任何解释、引号或前缀\n' +
        '- 长度 1-4 句，中文为主（除非用户明确要英文音色）\n' +
        '- 尽量覆盖：性别与年龄、音色质感、情绪语气、语速节奏\n' +
        '- 可以加入角色人设或场景描写让声音更立体\n' +
        '- 禁止出现混响、回声、EQ、压缩等后期处理词\n' +
        '- 禁止互相矛盾的特征（如"稚嫩童声+CEO气场"）',
    },
    { role: 'user', content: `我的声音想法：${idea}` },
  ]
  return chat(messages, { ...opts, temperature: 0.85 })
}

/** 根据音色描述生成适配的合成文本（30-80 字，贴合人设场景） */
export async function generateSampleText(
  description: string,
  opts: ChatOptions,
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是配音导演。给定一段音色描述，写一段「让这个声音念出来最好听」的中文合成文本。\n' +
        '硬性规则：\n' +
        '- 输出只有文本本身，不要解释、引号或旁白说明\n' +
        '- 30-80 字，一到三句\n' +
        '- 内容场景必须贴合音色的人设与情绪（如温柔治愈女声配晚安独白，而不是体育解说）\n' +
        '- 能自然展现描述中的语速与情绪特征',
    },
    { role: 'user', content: `音色描述：${description}` },
  ]
  return chat(messages, { ...opts, temperature: 0.9 })
}
