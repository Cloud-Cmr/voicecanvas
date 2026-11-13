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

/** AI 解析出来的剧本结构 */
export interface AiParsedScript {
  cues: Array<{
    /** 毫秒 */
    startMs: number
    /** 结束毫秒（可选） */
    endMs?: number
    role?: string
    text: string
  }>
  /** 出现过的角色（按首次出现顺序） */
  roles: string[]
  /** 模型给的整体说明（可选） */
  note?: string
}

/**
 * 用大模型解析自由格式的剧本：自动识别任意写法的“时间 + 角色 + 台词”。
 *
 * 比正则强的地方：能理解「十一点十二分」「1分12.5秒」「【小明】」
 * 「00:11:12 --> 00:11:15」等任意组合，且不会把正文里的数字误当时间。
 */
export async function parseScriptWithAI(
  raw: string,
  opts: ChatOptions,
): Promise<AiParsedScript> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是剧本解析器。把用户给的任意格式剧本，解析成结构化 JSON。\n' +
        '\n' +
        '输入可能是任意写法，例如：\n' +
        '- `【旁白】0分0秒 夜色渐深。`\n' +
        '- `张三：00:12 你好啊。`\n' +
        '- `[00:11:12] 这是十一分十二秒。`\n' +
        '- `李四 11.22 这句在十一分二十二秒。`\n' +
        '- SRT 块：`1\\n00:00:01,000 --> 00:00:03,000\\n台词`\n' +
        '- 纯文本（无时间）\n' +
        '\n' +
        '规则：\n' +
        '1. 时间统一换算成毫秒。支持 时/分/秒 中文单位、冒号格式（含毫秒）、点分格式（11.22=11分22秒）。\n' +
        '2. 角色名从【】[]（）()括号或「角色：」冒号前缀提取；没有就省略 role 字段。\n' +
        '3. text 只保留真正要朗读的台词，绝不能包含时间或角色标记。\n' +
        '4. 没有写时间的行，startMs 沿用上一条的 startMs（表示紧跟上一句）。\n' +
        '5. 时间必须单调不减（后一条 >= 前一条），除非原文明确乱序。\n' +
        '6. roles 数组按角色首次出现顺序列出全部角色名。\n' +
        '7. 忽略纯序号行（SRT 的 1、2、3）。\n' +
        '\n' +
        '只输出 JSON，不要 markdown 代码块，不要解释。格式：\n' +
        '{"cues":[{"startMs":0,"endMs":3000,"role":"旁白","text":"..."}],"roles":["旁白"],"note":"可选说明"}',
    },
    { role: 'user', content: raw.slice(0, 12000) },
  ]

  const raw2 = await chat(messages, { ...opts, temperature: 0.1 })

  // 容错：模型可能包了 ```json ``` 或前后带说明
  let jsonText = raw2.trim()
  const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) jsonText = fence[1].trim()
  const firstBrace = jsonText.indexOf('{')
  const lastBrace = jsonText.lastIndexOf('}')
  if (firstBrace > 0 || lastBrace < jsonText.length - 1) {
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonText = jsonText.slice(firstBrace, lastBrace + 1)
    }
  }

  let parsed: any
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new TtsError('E_AI_PARSE', 'AI 返回的不是有效 JSON，请重试或改用本地解析', raw2.slice(0, 500))
  }

  const cues = Array.isArray(parsed?.cues) ? parsed.cues : []
  const cleaned = cues
    .filter((c: any) => c && typeof c.text === 'string' && c.text.trim())
    .map((c: any) => ({
      startMs: Math.max(0, Math.round(Number(c.startMs) || 0)),
      endMs: c.endMs != null ? Math.max(0, Math.round(Number(c.endMs))) : undefined,
      role: typeof c.role === 'string' && c.role.trim() ? c.role.trim() : undefined,
      text: String(c.text).trim(),
    }))
    // 保底排序 + 单调化
    .sort((a: any, b: any) => a.startMs - b.startMs)

  let lastMs = 0
  for (const c of cleaned) {
    if (c.startMs < lastMs) c.startMs = lastMs
    lastMs = c.startMs
  }

  const roles: string[] = []
  for (const c of cleaned) {
    if (c.role && !roles.includes(c.role)) roles.push(c.role)
  }

  if (!cleaned.length) {
    throw new TtsError('E_AI_EMPTY', 'AI 没有解析出任何台词，请检查内容')
  }

  return {
    cues: cleaned,
    roles: (Array.isArray(parsed?.roles) ? parsed.roles : roles).filter(
      (r: any) => typeof r === 'string' && r.trim(),
    ),
    note: typeof parsed?.note === 'string' ? parsed.note : undefined,
  }
}
