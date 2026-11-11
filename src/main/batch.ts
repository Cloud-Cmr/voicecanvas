/**
 * 批量合成引擎（主进程）
 *
 * 设计要点：
 * - 并发限流默认 1（官方限流严格，429 得不偿失），最多 3
 * - 任务间串行落盘 + 历史记录，失败自动重试 1 次（幂等，生成文件名带序号）
 * - 每个任务的状态变化通过 BatchProgressEvent 推给渲染进程
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AudioFormat,
  BatchProgressEvent,
  BatchRunRequest,
  BatchTask,
  SynthRequest,
} from '../shared/types'
import { synthesize, TtsError } from './providers/mimo'
import { addHistory, ensureOutputDir, getApiKey, getSettings, listVoices } from './store'

interface BatchJob {
  id: string
  cancelled: boolean
}

const runningJobs = new Map<string, BatchJob>()

/** 解析任务用的音色：预置 ID 直用；VoiceAsset 则还原为请求参数 */
async function resolveVoice(voiceKey: string) {
  if (!voiceKey.startsWith('asset:')) {
    return { mode: 'preset' as const, voiceId: voiceKey }
  }
  const assetId = voiceKey.slice('asset:'.length)
  const voices = await listVoices()
  const asset = voices.find((v) => v.id === assetId)
  if (!asset) throw new TtsError('E_VOICE_NOT_FOUND', `音色资产不存在：${assetId}`)
  if (asset.source === 'clone') {
    if (!asset.samplePath) throw new TtsError('E_SAMPLE_MISSING', `音色「${asset.name}」的样本文件缺失`)
    return { mode: 'clone' as const, samplePath: asset.samplePath, designPrompt: undefined }
  }
  if (asset.source === 'design') {
    return { mode: 'design' as const, samplePath: undefined, designPrompt: asset.payload }
  }
  throw new TtsError('E_VOICE_KIND', `音色「${asset.name}」类型不支持批量`)
}

function extOf(format: AudioFormat): string {
  return format === 'mp3' ? 'mp3' : 'wav'
}

/**
 * 运行一批任务。返回最终的任务状态数组（渲染进程同时会收到事件流）。
 */
export async function runBatch(
  req: BatchRunRequest,
  sender: { send: (channel: string, payload: BatchProgressEvent) => void },
): Promise<{ jobId: string; tasks: BatchTask[] }> {
  const apiKey = await getApiKey()
  if (!apiKey) throw new TtsError('E_NO_KEY', '尚未配置 API Key')
  const apiKey_ = apiKey // 收窄为 string，避免 try 块内丢窄化

  const settings = await getSettings()
  const jobId = randomUUID()
  const job: BatchJob = { id: jobId, cancelled: false }
  runningJobs.set(jobId, job)

  const voice = await resolveVoice(req.source.voiceKey)
  const dir = await ensureOutputDir()
  const concurrency = Math.min(3, Math.max(1, req.concurrency))

  const tasks: BatchTask[] = req.tasks.map((t) => ({
    ...t,
    voiceKey: req.source.voiceKey,
    voiceLabel: req.source.label,
    status: 'pending',
    attempts: 0,
  }))

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '')

  let doneCount = 0
  let cursor = 0

  const emit = (t: BatchTask) => {
    sender.send('batch:progress', {
      id: t.id,
      status: t.status,
      error: t.error,
      filePath: t.filePath,
      bytes: t.bytes,
      elapsedMs: t.elapsedMs,
      doneCount,
      total: tasks.length,
    })
  }

  async function runOne(t: BatchTask): Promise<void> {
    if (job.cancelled) {
      t.status = 'skipped'
      emit(t)
      return
    }
    t.status = 'running'
    emit(t)

    const buildReq = (): SynthRequest => {
      if (voice.mode === 'preset') {
        return {
          mode: 'preset',
          text: t.text,
          instruction: req.instruction,
          voiceId: (voice as { voiceId: string }).voiceId,
          format: req.format,
        }
      }
      if (voice.mode === 'design') {
        return {
          mode: 'design',
          text: t.text,
          designPrompt: (voice as { designPrompt?: string }).designPrompt,
          format: req.format,
        }
      }
      return {
        mode: 'clone',
        text: t.text,
        instruction: req.instruction,
        samplePath: (voice as { samplePath?: string }).samplePath,
        format: req.format,
      }
    }

    // 失败自动重试 1 次（429 时多等 2 秒）
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (job.cancelled) break
      t.attempts = attempt
      try {
        const raw = await synthesize(buildReq(), {
          apiKey: apiKey_,
          baseUrl: settings.baseUrl ?? undefined,
          models: settings.models,
        })
        const fileName = `batch_${stamp}_${String(t.index).padStart(3, '0')}.${extOf(req.format)}`
        const filePath = path.join(dir, fileName)
        await fs.writeFile(filePath, raw.audio)

        await addHistory({
          id: randomUUID(),
          mode: voice.mode,
          text: t.text,
          instruction: req.instruction,
          voiceName: req.source.label,
          filePath,
          bytes: raw.audio.length,
          format: req.format,
          usage: raw.usage,
          createdAt: Date.now(),
        })

        t.status = 'done'
        t.filePath = filePath
        t.bytes = raw.audio.length
        t.elapsedMs = raw.elapsedMs
        doneCount++
        emit(t)
        return
      } catch (err) {
        const msg = err instanceof TtsError ? err.message : String(err)
        if (attempt < 2) {
          // 429/超时类等待后重试
          await new Promise((r) => setTimeout(r, 2000))
          continue
        }
        t.status = 'failed'
        t.error = msg
        doneCount++
        emit(t)
      }
    }
  }

  // 简单并发池
  const workers = Array.from({ length: concurrency }, async () => {
    while (!job.cancelled) {
      const idx = cursor++
      if (idx >= tasks.length) return
      await runOne(tasks[idx])
    }
    // 取消后剩余任务标记 skipped
    for (let i = cursor; i < tasks.length; i++) {
      if (tasks[i].status === 'pending') {
        tasks[i].status = 'skipped'
        emit(tasks[i])
      }
    }
  })
  await Promise.all(workers)

  runningJobs.delete(jobId)
  return { jobId, tasks }
}

export function cancelBatch(jobId: string): boolean {
  const job = runningJobs.get(jobId)
  if (job) {
    job.cancelled = true
    return true
  }
  return false
}

/** 解析 SRT 字幕为台词数组（去序号行/时间轴行，保留文本行） */
export function parseSrt(content: string): string[] {
  const blocks = content.replace(/\r\n/g, '\n').split(/\n{2,}/)
  const out: string[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean)
    // 去掉序号行（纯数字）与时间轴行（含 -->）
    const text = lines
      .filter((l) => !/^\d+$/.test(l.trim()) && !l.includes('-->'))
      .join(' ')
      .replace(/<[^>]+>/g, '') // 去 HTML 标签
      .trim()
    if (text) out.push(text)
  }
  return out
}

/** 解析 TXT 台词表：每行一条（空行分隔可选用） */
export function parseTxt(content: string): string[] {
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}
