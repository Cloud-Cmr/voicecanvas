/**
 * 视频处理：抽帧（给 OCR）+ 音轨混流（把配音合回视频）
 * 依赖系统 ffmpeg（自动探测常见位置）
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync as fs_mkdirSync } from 'node:fs'
import path from 'node:path'

/** 探测 ffmpeg：PATH → 常见安装位置 */
export function findFfmpeg(): string | null {
  // 1. 先在 PATH 里找（Windows 按 PATHEXT 扩展名逐个目录试）
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const exts = (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
  for (const dir of pathDirs) {
    for (const ext of exts) {
      const cand = path.join(dir, `ffmpeg${ext.toLowerCase()}`)
      if (existsSync(cand)) return cand
    }
    // 无扩展名的裸 ffmpeg（POSIX）
    const bare = path.join(dir, 'ffmpeg')
    if (existsSync(bare)) return bare
  }

  // 2. 回退到常见安装位置
  const fallbacks = [
    'D:\\qqbot\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'D:\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ffmpeg', 'bin', 'ffmpeg.exe'),
  ]
  for (const c of fallbacks) {
    if (c && existsSync(c)) return c
  }
  return null
}

export interface ExtractFramesResult {
  frames: string[]
  fps: number
  durationSec: number
}

/** 从视频抽帧：每 fps 秒一帧，输出 jpg 序列 */
export function extractFrames(
  videoPath: string,
  outDir: string,
  fps = 1,
): Promise<ExtractFramesResult> {
  return new Promise((resolve, reject) => {
    const ff = findFfmpeg()
    if (!ff) return reject(new Error('未找到 ffmpeg，请安装后重试'))
    fs_mkdirSync(outDir, { recursive: true })

    // 先取时长
    const probe = spawn(ff, ['-i', videoPath, '-f', 'null', '-'], { windowsHide: true })
    let meta = ''
    probe.stderr?.on('data', (d) => (meta += d.toString()))
    probe.on('close', () => {
      const durMatch = meta.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/)
      if (!durMatch) return reject(new Error('无法读取视频时长'))
      const durationSec =
        Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3])

      // 抽帧
      const args = [
        '-i', videoPath,
        '-vf', `fps=${fps}`,
        '-q:v', '2', // jpeg 质量
        path.join(outDir, 'frame_%05d.jpg'),
        '-y',
      ]
      const proc = spawn(ff, args, { windowsHide: true })
      let err = ''
      proc.stderr?.on('data', (d) => (err += d.toString()))
      proc.on('error', (e) => reject(new Error(`ffmpeg 启动失败：${e.message}`)))
      proc.on('close', (code) => {
        if (code !== 0) return reject(new Error(`抽帧失败：${err.slice(-300)}`))
        const { readdirSync } = require('node:fs') as typeof import('node:fs')
        const frames = readdirSync(outDir)
          .filter((f) => f.startsWith('frame_') && f.endsWith('.jpg'))
          .sort()
          .map((f) => path.join(outDir, f))
        resolve({ frames, fps, durationSec })
      })
    })
  })
}

/** 从视频提取音轨为 wav（whisper 需要 wav） */
export function extractAudio(videoPath: string, outWav: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = findFfmpeg()
    if (!ff) return reject(new Error('未找到 ffmpeg'))
    // 输出目录可能不存在（用户直接走 whisper 模式时没先抽帧）
    try {
      fs_mkdirSync(path.dirname(outWav), { recursive: true })
    } catch (e: any) {
      return reject(new Error(`创建输出目录失败：${e.message}`))
    }
    const proc = spawn(
      ff,
      ['-i', videoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '24000', '-ac', '1', outWav, '-y'],
      { windowsHide: true },
    )
    let err = ''
    proc.stderr?.on('data', (d) => (err += d.toString()))
    proc.on('error', (e) => reject(new Error(`ffmpeg 启动失败：${e.message}`)))
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`提取音轨失败：${err.slice(-200)}`))
      resolve()
    })
  })
}

/**
 * 依据输入选择输出容器。
 * mp4/mov 系保持 mp4；其余（webm 的 vp8/vp9、mkv 里的各种流）一律落到 mkv——
 * mkv 几乎什么流都能装，而把 vp8 copy 进 mp4 会让 ffmpeg 直接失败。
 */
export function pickMuxExt(videoPath: string): '.mp4' | '.mkv' {
  const ext = path.extname(videoPath).toLowerCase()
  return ext === '.mp4' || ext === '.mov' || ext === '.m4v' ? '.mp4' : '.mkv'
}

/** 把配音音轨混回视频（替换原音轨，保留画面） */
export function muxAudio(
  videoPath: string,
  audioWav: string,
  outVideo: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = findFfmpeg()
    if (!ff) return reject(new Error('未找到 ffmpeg'))
    const proc = spawn(
      ff,
      [
        '-i', videoPath,
        '-i', audioWav,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy', // 画面不重编码
        '-c:a', 'aac',
        // apad 把配音补静音到无限长，-shortest 才会以视频长度收尾。
        // 否则配音比视频短时（最后一句字幕后画面仍在播）视频尾部会被截掉。
        '-af', 'apad',
        '-shortest',
        outVideo,
        '-y',
      ],
      { windowsHide: true },
    )
    let err = ''
    proc.stderr?.on('data', (d) => (err += d.toString()))
    proc.on('error', (e) => reject(new Error(`ffmpeg 启动失败：${e.message}`)))
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`混流失败：${err.slice(-200)}`))
      resolve()
    })
  })
}
