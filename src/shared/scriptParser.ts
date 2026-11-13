/**
 * 智能剧本解析器
 *
 * 支持用户直接粘贴带时间和角色的文案，自动识别：
 *
 * 时间格式：
 * - `11分12秒` / `11分` / `12秒`
 * - `11:12` / `1:02:03` / `00:11:12`
 * - `11.22` / `11.22.33`（点分）
 * - `[11:12]` / `【11分12秒】` / `(11:12)` 包裹
 * - `00:11:12,500`（SRT 风格）
 *
 * 角色格式：
 * - `【张三】` / `[张三]` / `（张三）` 前缀
 * - `张三：` / `张三:` 前缀
 * - `(张三)` 前缀（当内容像人名时）
 *
 * 输出：{ cues: [{ startMs, endMs?, role?, text }], roles: string[] }
 */

export interface ParsedCue {
  /** 起始毫秒 */
  startMs: number
  /** 结束毫秒（若有，来自时间区间） */
  endMs?: number
  /** 角色名（若识别到） */
  role?: string
  /** 台词正文（已剥离时间与角色标记） */
  text: string
  /** 原始行号，便于定位 */
  line: number
}

export interface ParseResult {
  cues: ParsedCue[]
  /** 出现过的角色（按首次出现顺序） */
  roles: string[]
  /** 没识别出时间的行数（这些行会紧随前一条） */
  untimedCount: number
  /** 警告信息 */
  warnings: string[]
}

// ============ 时间解析 ============

interface TimeMatch {
  ms: number
  /** 匹配到的原文 */
  raw: string
  /** 在行内的起止位置 */
  start: number
  end: number
}

/** 核心：把各种时间写法转成毫秒 */
function parseTimeToken(token: string): number | null {
  const t = token.trim()
  if (!t) return null

  // 1. 纯中文：11分12秒 / 11分 / 12秒 / 1小时2分3秒
  const cn = t.match(/^(?:(\d+)\s*[小时时])?\s*(?:(\d+)\s*分(?:钟)?)?\s*(?:(\d+(?:\.\d+)?)\s*秒)?$/)
  if (cn && (cn[1] || cn[2] || cn[3])) {
    const h = Number(cn[1] || 0)
    const m = Number(cn[2] || 0)
    const s = Number(cn[3] || 0)
    return ((h * 60 + m) * 60 + s) * 1000
  }

  // 2. 冒号分隔：11:12 / 1:02:03 / 00:11:12,500 / 00:11:12.500
  if (t.includes(':')) {
    const parts = t.replace(',', '.').split(':')
    if (parts.length >= 2 && parts.length <= 3) {
      const nums = parts.map((p) => parseFloat(p))
      if (nums.some((n) => Number.isNaN(n))) return null
      if (nums.length === 3) {
        // h:m:s —— 小时位生效（00:11:12 = 11分12秒 = 672000ms）
        const [h, m, s] = nums
        return Math.round(((h * 60 + m) * 60 + s) * 1000)
      }
      // m:s
      const [m, s] = nums
      return Math.round((m * 60 + s) * 1000)
    }
    return null
  }

  // 3. 点分：11.22 / 11.22.33 / 12.5（单个小数 = 秒的小数）
  if (/^\d+(\.\d+){1,2}$/.test(t)) {
    const parts = t.split('.').map(Number)
    if (parts.length === 2) {
      const [a, b] = parts
      // 12.5 这种 a 后面只有 1 位小数 → 视为「a 秒 + 小数秒」
      // 11.22 这种两位整数 → 视为「11 分 22 秒」
      const decimalStr = t.split('.')[1]
      if (decimalStr.length === 1) {
        // 12.5 → 12.5 秒
        return Number(t) * 1000
      }
      // 11.22 → 11分22秒
      return (a * 60 + b) * 1000
    }
    if (parts.length === 3) {
      // 1.02.03 → 1小时2分3秒
      const [h, m, s] = parts
      return ((h * 60 + m) * 60 + s) * 1000
    }
  }

  // 4. 纯数字：>= 5 视为秒数（允许 30 → 30 秒）
  if (/^\d+$/.test(t)) {
    const n = Number(t)
    if (n >= 5) return n * 1000
  }

  // 5. 中文混合单位已在 1 处理；再兜底「分+秒」无分隔
  const cnMix = t.match(/^(\d+)\s*分\s*(\d+(?:\.\d+)?)\s*秒$/)
  if (cnMix) {
    return (Number(cnMix[1]) * 60 + Number(cnMix[2])) * 1000
  }

  return null
}

/** 在一行里找出所有可能的时间表达 */
function findTimeMatches(line: string): TimeMatch[] {
  const matches: TimeMatch[] = []

  const push = (raw: string, start: number, end: number) => {
    const ms = parseTimeToken(raw)
    if (ms === null) return
    if (matches.some((x) => start < x.end && end > x.start)) return
    matches.push({ ms, raw, start, end })
  }

  // 1. 括号包裹的整体时间：[00:11:12] / 【11分12秒】 / (12.5)
  const wrapRe = /[[【（(]\s*([^\]】）)]{1,20})\s*[\]】）)]/g
  let m: RegExpExecArray | null
  while ((m = wrapRe.exec(line)) !== null) {
    push(m[1], m.index, m.index + m[0].length)
  }

  // 2. 冒号时间（含可选小时与毫秒）—— 但跳过已被括号覆盖的区域
  const colonRe = /(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)/g
  while ((m = colonRe.exec(line)) !== null) {
    push(m[1], m.index, m.index + m[0].length)
  }

  // 3. 中文时间：11分12秒 / 1小时2分3秒
  //    允许出现在行首、括号后、角色标记之后；但排除句子中间/结尾的自然语言
  const cnRe = /(?<=^|[\s\]】）)、,，:：])((?:\d+\s*[小时时]\s*)?(?:\d+\s*分(?:钟)?\s*)?(?:\d+(?:\.\d+)?\s*秒))(?=[\s,]|$)/g
  while ((m = cnRe.exec(line)) !== null) {
    push(m[1], m.index, m.index + m[0].length)
  }
  // 单独「N分」或「N小时」（不带秒）
  const cnMinRe = /(?<=^|[\s\]】）)、,，:：])(\d+\s*[小时时](?:\s*\d+\s*分(?:钟)?)?)(?=[\s,]|$)/g
  while ((m = cnMinRe.exec(line)) !== null) {
    push(m[1], m.index, m.index + m[0].length)
  }

  // 4. 点分时间：11.22 / 1.02.03 / 12.5（行首或空白后）
  if (!matches.length) {
    const dotRe = /(?:^|\s)(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)(?=\s|$)/g
    let m2: RegExpExecArray | null
    while ((m2 = dotRe.exec(line)) !== null) {
      const raw = m2[1]
      const start = m2.index + (m2[0].length - raw.length)
      push(raw, start, start + raw.length)
    }
  }

  // 5. 行首或角色标记之后的纯数字秒（后面必须跟空白和正文）
  if (!matches.length) {
    const numRe = /(?:^|[[【（(][^\]】）)]{1,12}[\]】）)]\s*)\s*(\d{1,4})(?=\s+\S)/
    const nm = line.match(numRe)
    if (nm) {
      const raw = nm[1]
      const start = nm[0].lastIndexOf(raw)
      push(raw, start, start + raw.length)
    }
  }

  return matches.sort((a, b) => a.start - b.start)
}

// ============ 角色解析 ============

interface RoleMatch {
  role: string
  start: number
  end: number
}

/** 常见非人名词，避免把 "旁白：xxx" 之外的误判 */
const ROLE_BLACKLIST = new Set([
  '注意',
  '备注',
  '说明',
  '提示',
  '场景',
  '镜头',
  '注',
])

function findRole(line: string): RoleMatch | null {
  // 1. 括号包裹：【张三】/[张三]/（张三）/(张三)
  const bracket = line.match(/^\s*[\[【（(]\s*([^\]】）)]{1,12})\s*[\]】）)]\s*/)
  if (bracket) {
    const name = bracket[1].trim()
    // 括号里是时间（[00:11:12]、[12.5]）→ 这不是角色，且不要再往下判断冒号
    if (/^[\d:.,\s]+$/.test(name)) return null
    if (name && !ROLE_BLACKLIST.has(name)) {
      return { role: name, start: 0, end: bracket[0].length }
    }
  }

  // 2. 冒号前缀：张三：/张三:
  const colon = line.match(/^\s*([^\s:：]{1,10})\s*[:：]\s*/)
  if (colon) {
    const name = colon[1].trim()
    // 名字里带括号/冒号残片的一律不算角色
    if (/^[[\]【】（()）\d:.,\s]+$/.test(name)) return null
    if (name && !ROLE_BLACKLIST.has(name)) {
      return { role: name, start: 0, end: colon[0].length }
    }
  }

  return null
}

/** 在原始行里检测「人名 + 时间」：李四 0:45 台词 */
function findInlineRole(line: string): RoleMatch | null {
  // 行首是中文/英文人名，紧跟空白，然后是时间
  const m = line.match(/^\s*([\u4e00-\u9fa5A-Za-z]{1,10})\s+(?=\d{1,2}[:.]\d)/)
  if (m) {
    const name = m[1].trim()
    if (name && !ROLE_BLACKLIST.has(name)) {
      return { role: name, start: 0, end: m[0].length }
    }
  }
  return null
}

// ============ 主解析函数 ============

export function parseScript(raw: string): ParseResult {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const cues: ParsedCue[] = []
  const roles: string[] = []
  const warnings: string[] = []
  let untimedCount = 0
  let lastMs = 0
  let lineNo = 0

  for (const rawLine of lines) {
    lineNo++
    let line = rawLine.trim()
    if (!line) continue
    // 跳过纯注释行（以 # 或 // 开头）
    if (line.startsWith('#') || line.startsWith('//')) continue

    // 1) 先在原始行检测角色（括号/冒号前缀，以及「人名 时间」内联形式）
    let inlineRole: RoleMatch | null = findRole(line)
    if (!inlineRole) inlineRole = findInlineRole(line)

    // 2) 再找时间（在原始行上找，避免角色剥离影响位置）
    const times = findTimeMatches(line)
    let startMs: number | undefined
    let endMs: number | undefined

    if (times.length >= 1) {
      startMs = times[0].ms
      if (times.length >= 2 && times[1].ms > times[0].ms) {
        endMs = times[1].ms
      }
    }

    // 3) 剥离时间与角色
    let stripped = line
    if (times.length) {
      for (let i = times.length - 1; i >= 0; i--) {
        stripped = stripped.slice(0, times[i].start) + stripped.slice(times[i].end)
      }
    }
    if (inlineRole) {
      // 角色标记可能包含 "李四 " 这样的前缀（含空格），剥离时从行首按长度切
      const roleLen = inlineRole.end
      stripped = stripped.slice(Math.min(roleLen, stripped.length))
    }
    // 清理残留分隔符与括号残片
    stripped = stripped
      .replace(/^[-–—>→:：\s、,，\]】）)]+/, '')
      .replace(/[\[【（(]+$/, '')
      .replace(/^[\[【（(]+/, '')
      .replace(/[-–—>→\s、,，]+$/, '')
      .trim()

    // 4) 行首可能还残留角色标记（时间与角色顺序不同时）
    const postRole = findRole(stripped)
    if (postRole && (!inlineRole || postRole.role !== inlineRole.role)) {
      inlineRole = postRole
      stripped = stripped
        .slice(postRole.end)
        .replace(/^[-–—>→:：\s、,，\]】）)]+/, '')
        .replace(/^[\[【（(]+/, '')
        .trim()
    }

    let role: string | undefined
    if (inlineRole) {
      role = inlineRole.role
      if (role && !roles.includes(role)) roles.push(role)
    }

    // 5) 剩余就是正文
    const text = stripped.trim()
    if (!text) continue
    // 跳过纯数字行（SRT 序号）
    if (/^\d+$/.test(text)) continue

    if (startMs === undefined) {
      untimedCount++
      startMs = lastMs
    }
    lastMs = startMs

    cues.push({ startMs, endMs, role, text, line: lineNo })
  }

  if (!cues.length) {
    warnings.push('没有解析到任何可朗读的台词')
  }
  if (untimedCount > 0) {
    warnings.push(`${untimedCount} 行没检测到时间，已按顺序紧随上一条`)
  }

  return { cues, roles, untimedCount, warnings }
}

/** 把毫秒格式化成 mm:ss.cc */
export function formatMs(ms: number): string {
  const total = Math.max(0, ms)
  const m = Math.floor(total / 60000)
  const s = Math.floor((total % 60000) / 1000)
  const cs = Math.floor((total % 1000) / 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/** 生成 LRC 字幕 */
export function toLrc(cues: ParsedCue[], placedMs?: number[]): string {
  const lines = ['[ti:声绘 VoiceCanvas]']
  cues.forEach((c, i) => {
    const ms = placedMs?.[i] ?? c.startMs
    const m = Math.floor(ms / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    const cs = Math.floor((ms % 1000) / 10)
    const stamp = `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}]`
    const prefix = c.role ? `${c.role}：` : ''
    lines.push(`${stamp}${prefix}${c.text}`)
  })
  return lines.join('\n')
}
