/**
 * whisper.cpp 集成：本地语音识别（离线，不用 MiMo API）
 *
 * 首次使用时自动下载：
 * - whisper-cli 主程序（约 8MB）
 * - 模型（base 145MB / small 466MB，用户可选）
 *
 * 用途：
 * 1. 听写转写页的「本地转写」模式（不用 Key，隐私好）
 * 2. 字幕配音页：把视频音频 → 提取字幕 → 按字幕时间轴配音
 */

import { app } from 'electron'
import { promises as fsp, existsSync, createWriteStream } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import https from 'node:https'
import http from 'node:http'

const WHISPER_VER = 'v1.9.2'
const BIN_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VER}/whisper-bin-x64.zip`
const MODEL_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
/** 国内模型镜像（hf-mirror） */
const MODEL_MIRROR = 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main'

export type WhisperModel = 'tiny' | 'base' | 'small' | 'medium'

const MODEL_SIZES: Record<WhisperModel, string> = {
  tiny: 'ggml-tiny.bin',
  base: 'ggml-base.bin',
  small: 'ggml-small.bin',
  medium: 'ggml-medium.bin',
}

export function whisperDir(): string {
  return path.join(app.getPath('userData'), 'whisper')
}

function binPath(): string {
  // v1.9.2 zip 解压后在 Release/ 子目录；兼容根目录
  const direct = path.join(whisperDir(), 'whisper-cli.exe')
  const inRelease = path.join(whisperDir(), 'Release', 'whisper-cli.exe')
  return existsSync(inRelease) ? inRelease : direct
}

function modelPath(model: WhisperModel): string {
  return path.join(whisperDir(), MODEL_SIZES[model])
}

export async function whisperInstalled(model: WhisperModel): Promise<{
  bin: boolean
  model: boolean
  binPath?: string
  modelPath?: string
}> {
  const bin = existsSync(binPath())
  const mod = existsSync(modelPath(model))
  return { bin, model: mod, binPath: bin ? binPath() : undefined, modelPath: mod ? modelPath(model) : undefined }
}

/** 带进度的下载（Node https，自动重定向，支持镜像 fallback） */
function downloadFile(
  url: string,
  dest: string,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string, redirects: number) => {
      if (redirects > 5) return reject(new Error('重定向次数过多'))
      const mod = u.startsWith('https') ? https : http
      const req = mod.get(u, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return follow(res.headers.location, redirects + 1)
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode}`))
        }
        const total = Number(res.headers['content-length'] || 0)
        let received = 0
        const ws = createWriteStream(dest)
        res.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (total) onProgress(received, total)
        })
        res.pipe(ws)
        ws.on('finish', () => ws.close(() => resolve()))
        ws.on('error', reject)
      })
      req.on('error', reject)
      req.setTimeout(60_000, () => req.destroy(new Error('下载超时')))
    }
    follow(url, 0)
  })
}

/** 下载 whisper 主程序 */
export async function downloadWhisperBin(
  onProgress: (pct: number) => void,
): Promise<void> {
  await fsp.mkdir(whisperDir(), { recursive: true })
  const zipPath = path.join(whisperDir(), 'whisper-bin.zip')
  await downloadFile(BIN_URL, zipPath, (r, t) => onProgress(Math.round((r / t) * 100)))
  // 解压（Electron 自带无 unzip，用 PowerShell）
  await new Promise<void>((resolve, reject) => {
    const { execFile } = require('node:child_process') as typeof import('node:child_process')
    execFile(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${whisperDir()}' -Force`],
      (err) => (err ? reject(err) : resolve()),
    )
  })
  await fsp.unlink(zipPath).catch(() => {})
  if (!existsSync(binPath())) {
    // 有些 zip 包了一层目录
    const entries = await fsp.readdir(whisperDir())
    const sub = entries.find((e) => e.startsWith('whisper'))
    if (sub) {
      const subDir = path.join(whisperDir(), sub)
      const stat = await fsp.stat(subDir)
      if (stat.isDirectory()) {
        const inner = await fsp.readdir(subDir)
        for (const f of inner) {
          await fsp.rename(path.join(subDir, f), path.join(whisperDir(), f)).catch(() => {})
        }
      }
    }
  }
  if (!existsSync(binPath())) throw new Error('解压后未找到 whisper-cli.exe')
}

/** 下载模型（自动用 hf-mirror 镜像 fallback） */
export async function downloadWhisperModel(
  model: WhisperModel,
  onProgress: (pct: number) => void,
): Promise<void> {
  await fsp.mkdir(whisperDir(), { recursive: true })
  const dest = modelPath(model)
  const file = MODEL_SIZES[model]
  try {
    await downloadFile(`${MODEL_BASE}/${file}`, dest, (r, t) => onProgress(Math.round((r / t) * 100)))
  } catch {
    onProgress(0)
    await downloadFile(`${MODEL_MIRROR}/${file}`, dest, (r, t) => onProgress(Math.round((r / t) * 100)))
  }
  if (!existsSync(dest)) throw new Error('模型下载失败')
}

export interface WhisperSegment {
  startMs: number
  endMs: number
  text: string
}

export interface WhisperResult {
  ok: boolean
  segments?: WhisperSegment[]
  srt?: string
  message?: string
}

/** 解析 whisper-cli 的 JSON 输出 */
function parseWhisperJson(jsonText: string): WhisperSegment[] {
  try {
    const j = JSON.parse(jsonText)
    const segs = j.transcription || []
    return segs.map((s: any) => ({
      startMs: Math.round((s.timestamps?.from?._milliseconds ?? 0)),
      endMs: Math.round((s.timestamps?.to?._milliseconds ?? 0)),
      text: String(s.text || '').trim(),
    })).filter((s: WhisperSegment) => s.text)
  } catch {
    return []
  }
}

/** 秒 → SRT 时间 */
function srtTime(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const ms3 = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms3).padStart(3, '0')}`
}

/** 分段转 SRT */
export function segmentsToSrt(segs: WhisperSegment[]): string {
  return segs
    .map((s, i) => `${i + 1}\n${srtTime(s.startMs)} --> ${srtTime(s.endMs)}\n${s.text}\n`)
    .join('\n')
}

/**
 * 本地转写：音频文件 → 分段文本 + SRT
 * whisper-cli -m model -f audio.wav -oj -l zh
 */
export function transcribeLocal(
  audioPath: string,
  model: WhisperModel,
): Promise<WhisperResult> {
  return new Promise((resolve) => {
    const bin = binPath()
    const mod = modelPath(model)
    if (!existsSync(bin) || !existsSync(mod)) {
      return resolve({ ok: false, message: 'whisper 未安装，请先下载' })
    }

    const outBase = audioPath.replace(/\.[^.]+$/, '')
    // 语言固定 zh（中文为主），自动检测在短音频上易误判
    const args = ['-m', mod, '-f', audioPath, '-oj', '-nt', '-l', 'zh']
    const proc = spawn(bin, args, { windowsHide: true })
    let stderr = ''
    proc.stderr?.on('data', (d) => (stderr += d.toString()))
    proc.on('error', (e) => resolve({ ok: false, message: `启动失败：${e.message}` }))
    proc.on('close', (code) => {
      if (code !== 0) {
        return resolve({ ok: false, message: `whisper 退出码 ${code}：${stderr.slice(-300)}` })
      }
      // whisper-cli -oj 的输出路径是 <音频全名>.json（保留原扩展名），其次尝试 <去掉扩展名>.json
      const jsonCandidates = [`${audioPath}.json`, `${outBase}.json`]
      const tryRead = async (): Promise<string> => {
        for (const p of jsonCandidates) {
          try {
            return await fsp.readFile(p, 'utf8')
          } catch {
            /* 下一个 */
          }
        }
        throw new Error('whisper 未生成 JSON 输出')
      }
      tryRead()
        .then((txt) => {
          const segs = parseWhisperJson(txt)
          if (!segs.length) return resolve({ ok: false, message: '未识别到语音内容' })
          resolve({ ok: true, segments: segs, srt: segmentsToSrt(segs) })
        })
        .catch((e) => resolve({ ok: false, message: `读取输出失败：${e.message}` }))
    })
  })
}

/** 下载进度事件名（渲染进程监听） */
export const WHISPER_PROGRESS_CHANNEL = 'whisper:downloadProgress'
