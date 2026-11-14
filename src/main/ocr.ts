/**
 * OCR 字幕识别：用 tesseract.js 识别视频抽帧里的硬字幕
 *
 * 策略：
 * - 字幕通常在画面底部 1/3，裁剪该区域提高准确率、减少误识别
 * - 相邻帧文本相同时合并（同一句字幕持续多帧）
 * - 合并后按出现时间生成时间轴
 *
 * tesseract.js 在主进程跑 worker（纯 JS/wasm，不需要安装）
 */

import { createWorker } from 'tesseract.js'
import { promises as fsp } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/**
 * 解析本地 tessdata 目录（语言包）。
 * 开发态：项目根 tools/tessdata；生产态：resources/tessdata。
 * 全部离线，不依赖 tesseract CDN（国内网络不通会导致识别失败）。
 */
function resolveLangPath(): string {
  const candidates = [
    // 生产：electron-builder extraResources 解压到 resources/
    path.join(process.resourcesPath || '', 'tessdata'),
    // 开发：仓库根 tools/tessdata
    path.join(app.getAppPath(), 'tools', 'tessdata'),
    path.join(__dirname, '..', '..', 'tools', 'tessdata'),
    path.join(process.cwd(), 'tools', 'tessdata'),
  ]
  for (const c of candidates) {
    if (c && existsSync(path.join(c, 'chi_sim.traineddata.gz'))) return c
  }
  return ''
}

export interface OcrFrameResult {
  /** 帧文件 */
  frame: string
  /** 该帧在视频里的时间（ms） */
  timeMs: number
  text: string
}

/**
 * 归一化 OCR 文本：tesseract 习惯在汉字间插空格（"第 一 句"），
 * 会污染字幕显示与 TTS 朗读。规则：
 * - CJK 字符之间的空格全部去掉
 * - 中文与英文/数字之间的空格去掉（"小米 MiMo" 保留英文侧空格由后续判断）
 * - 其余空格压缩为单个
 */
export function normalizeCjk(s: string): string {
  const CJK = '\\u4e00-\\u9fff\\u3400-\\u4dbf\\u3000-\\u303f\\uff00-\\uffef'
  return s
    // 汉字与汉字之间（可跨空格）的空格删掉
    .replace(new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, 'g'), '$1')
    // 汉字与全角标点之间
    .replace(new RegExp(`([${CJK}])\\s+(?=[，。！？、；：「」『』（）])`, 'g'), '$1')
    .replace(new RegExp(`([，。！？、；：「」『』（）])\\s+(?=[${CJK}])`, 'g'), '$1')
    // 连续空格压成一个
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** 识别一批帧，返回每帧文本 */
export async function ocrFrames(
  frames: Array<{ path: string; timeMs: number }>,
  onProgress?: (pct: number, text?: string) => void,
  lang = 'chi_sim+eng',
): Promise<OcrFrameResult[]> {
  const langPath = resolveLangPath()
  const worker = await createWorker(lang, 1, {
    langPath,
    gzip: true,
    cachePath: langPath,
  })
  const results: OcrFrameResult[] = []

  try {
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]
      const { data } = await worker.recognize(f.path, {}, { blocks: false })
      const text = normalizeCjk(
        (data.text || '')
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 1) // 单字符多为噪声
          .join(' ')
          .trim(),
      )
      results.push({ frame: f.path, timeMs: f.timeMs, text })
      onProgress?.(Math.round(((i + 1) / frames.length) * 100), text)
    }
  } finally {
    await worker.terminate()
  }

  return results
}

/** 时间轴字幕条目 */
export interface TimelineSubtitle {
  startMs: number
  endMs: number
  text: string
}

/** 把逐帧 OCR 结果合并为连续字幕（相邻相似帧归为同一条） */
export function mergeFramesToSubtitles(
  results: OcrFrameResult[],
  frameIntervalMs: number,
): TimelineSubtitle[] {
  const out: TimelineSubtitle[] = []
  let current: TimelineSubtitle | null = null

  for (const r of results) {
    const t = r.text.replace(/\s+/g, ' ').trim()
    if (!t) {
      // 空帧：当前字幕结束
      if (current) {
        out.push(current)
        current = null
      }
      continue
    }
    if (current && similarity(current.text, t) > 0.7) {
      // 同一句字幕继续显示
      current.endMs = r.timeMs + frameIntervalMs
      // 若新帧文本更长（字幕逐行显示），取更完整的
      if (t.length > current.text.length) current.text = t
    } else {
      if (current) out.push(current)
      current = { startMs: r.timeMs, endMs: r.timeMs + frameIntervalMs, text: t }
    }
  }
  if (current) out.push(current)

  // 过滤过短的（可能是误识别闪帧）
  return out.filter((s) => s.text.length >= 2)
}

/** 简单字符串相似度（编辑距离比例） */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  const la = a.length
  const lb = b.length
  if (!la || !lb) return 0
  const dp = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0))
  for (let i = 0; i <= la; i++) dp[i][0] = i
  for (let j = 0; j <= lb; j++) dp[0][j] = j
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : Math.min(dp[i - 1][j - 1] + 1, dp[i][j - 1] + 1, dp[i - 1][j] + 1)
    }
  }
  return 1 - dp[la][lb] / Math.max(la, lb)
}

/** 字幕转 SRT */
export function subtitlesToSrt(subs: TimelineSubtitle[]): string {
  const srtTime = (ms: number) => {
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    const ms3 = ms % 1000
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms3).padStart(3, '0')}`
  }
  return subs
    .map((s, i) => `${i + 1}\n${srtTime(s.startMs)} --> ${srtTime(s.endMs)}\n${s.text}\n`)
    .join('\n')
}
