/**
 * 音频导出：把生成结果打包成"可直接交付"的形式
 *
 * - 智能文件名（用文本前几个字 + 音色 + 日期）
 * - 附带同名 .txt 元数据（参数、文本、模型、耗时），方便回溯
 * - 多文件打包时生成索引清单
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { GenerationRecord } from '../shared/types'

/** 从文本里提取适合做文件名的片段 */
export function slugFromText(text: string, maxLen = 18): string {
  const clean = text
    .replace(/[（(][^）)]*[）)]/g, '') // 去括号内容（标签等）
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\\/:*?"<>|]/g, '') // Windows 非法字符
    .replace(/[，。！？；：、,\.!\?;:]/g, '')
    .trim()
  return clean.slice(0, maxLen) || '未命名'
}

/** 生成人类可读的时间戳 */
function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** 构造智能文件名：文本片段_音色_日期.wav */
export function smartFileName(rec: {
  text: string
  voiceName?: string
  createdAt?: number
}): string {
  const slug = slugFromText(rec.text)
  const voice = (rec.voiceName || 'voice').replace(/[\\/:*?"<>|]/g, '')
  const d = rec.createdAt ? new Date(rec.createdAt) : new Date()
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `${slug}_${voice}_${ds}`
}

/** 写一份同名元数据 txt，方便交付时说明参数 */
export async function writeSidecar(
  audioPath: string,
  rec: GenerationRecord,
): Promise<string> {
  const base = audioPath.replace(/\.(wav|mp3)$/i, '')
  const metaPath = `${base}.txt`
  const lines = [
    '声绘 VoiceCanvas 生成说明',
    '─'.repeat(28),
    `生成时间：${new Date(rec.createdAt).toLocaleString('zh-CN')}`,
    `模式：${rec.mode === 'preset' ? '预置音色' : rec.mode === 'design' ? '音色设计' : '音色克隆'}`,
    `音色：${rec.voiceName || '—'}`,
    rec.instruction ? `风格指令：${rec.instruction}` : '',
    `输出格式：${rec.format.toUpperCase()}`,
    `文件大小：${(rec.bytes / 1024).toFixed(1)} KB`,
    rec.usage
      ? `Token 用量：${rec.usage.totalTokens}（输入 ${rec.usage.promptTokens} / 输出 ${rec.usage.completionTokens}）`
      : '',
    '',
    '合成文本：',
    rec.text,
    '',
    '─'.repeat(28),
    '由 声绘 VoiceCanvas 生成 · 语音服务由小米 MiMo 开放平台提供',
  ].filter((l) => l !== undefined)

  await fs.writeFile(metaPath, lines.join('\n'), 'utf8')
  return metaPath
}

/** 把一批记录导出到一个目录，附带索引 */
export async function exportBatch(
  records: GenerationRecord[],
  targetDir: string,
): Promise<{ copied: number; index: string; errors: string[] }> {
  await fs.mkdir(targetDir, { recursive: true })
  const errors: string[] = []
  let copied = 0
  const indexLines: string[] = [
    '# 声绘 VoiceCanvas 导出清单',
    '',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    `条目数：${records.length}`,
    '',
    '| # | 文件名 | 模式 | 音色 | 文本 |',
    '|---|---|---|---|---|',
  ]

  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    try {
      const name = `${String(i + 1).padStart(2, '0')}_${smartFileName(r)}${path.extname(r.filePath)}`
      const dest = path.join(targetDir, name)
      await fs.copyFile(r.filePath, dest)
      await writeSidecar(dest, r)
      copied++
      const text = r.text.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 40)
      indexLines.push(`| ${i + 1} | ${name} | ${r.mode} | ${r.voiceName || '-'} | ${text} |`)
    } catch (e: any) {
      errors.push(`${r.filePath}: ${e?.message || e}`)
    }
  }

  const indexPath = path.join(targetDir, '_导出清单.md')
  await fs.writeFile(indexPath, indexLines.join('\n'), 'utf8')
  return { copied, index: indexPath, errors }
}

export { stamp }
