import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Tray, Menu } from 'electron'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { IPC } from '../shared/types'
import type {
  GenerationRecord,
  SynthResponse,
  VoiceAsset,
} from '../shared/types'
import {
  addHistory,
  ensureOutputDir,
  getApiKey,
  getSettings,
  listHistory,
  listVoices,
  removeHistory,
  removeVoice,
  setApiKey,
  updateSettings,
  upsertVoice,
} from './store'
import {
  synthesize,
  verifyKey,
  TtsError,
  PRESET_VOICES,
  DEFAULT_MODELS,
  DEFAULT_BASE_URL,
} from './providers/mimo'
import { runBatch, cancelBatch, parseSrt, parseTxt } from './batch'
import { polishVoiceDescription, generateSampleText, DEFAULT_LLM_MODEL } from './providers/llm'
import { concatWavs, buildTimelineWav, type TimelineItem } from './wav'
import { trimEdges, normalizePeak, capSilence, applyGain, getWavInfo } from './audiofx'
import { transcribe } from './providers/asr'
import { listStyles, saveStyle, removeStyle } from './styles'
import type {
  AsrResponse,
  BatchRunRequest,
  ExportFormat,
  StylePreset,
  SynthRequest,
  TimelineRequest,
  TimelineResponse,
} from '../shared/types'

/** "mm:ss" / "mm:ss.ms" / "hh:mm:ss" → 毫秒 */
function parseTimeMs(t: string): number {
  const parts = t.trim().split(':').map((p) => parseFloat(p))
  if (parts.some((n) => Number.isNaN(n))) return 0
  if (parts.length === 3) return ((parts[0] * 60 + parts[1]) * 60 + parts[2]) * 1000
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000
  return parts[0] * 1000
}

let mainWindow: BrowserWindow | null = null

/**
 * 自定义媒体协议：vcmedia://local/<encodeURIComponent(绝对路径)>
 * 只允许读取音频文件，避免给渲染进程开放 file:// 全盘访问权限。
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vcmedia',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

const AUDIO_EXT = new Set(['.wav', '.mp3', '.pcm', '.ogg', '.flac', '.m4a'])

function registerMediaProtocol(): void {
  protocol.handle('vcmedia', async (request) => {
    try {
      const url = new URL(request.url)
      const encoded = url.pathname.replace(/^\/+/, '')
      const filePath = decodeURIComponent(encoded)
      const ext = path.extname(filePath).toLowerCase()
      if (!AUDIO_EXT.has(ext)) {
        return new Response('Forbidden: not an audio file', { status: 403 })
      }
      return await net.fetch(`file:///${filePath.replace(/\\/g, '/')}`)
    } catch (err: any) {
      return new Response(`Bad request: ${err?.message}`, { status: 400 })
    }
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#131417',
    autoHideMenuBar: true,
    title: '声绘 VoiceCanvas',
    icon: path.join(process.env.VITE_DEV_SERVER_URL ? process.cwd() : __dirname, '../../build/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 批量任务运行期间点关闭 → 隐藏到托盘，任务不中断
  mainWindow.on('close', (e) => {
    const quitting = (app as any).isQuitting === true
    if (batchRunningCount > 0 && !quitting && tray) {
      e.preventDefault()
      mainWindow?.hide()
      mainWindow?.webContents.send('batch:hidden', true)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

const inflight = new Map<string, AbortController>()

function registerIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsUpdate, (_e, patch) => updateSettings(patch))

  ipcMain.handle(IPC.probeModels, async () => {
    const key = await getApiKey()
    if (!key) return { ok: false, message: '尚未配置 API Key' }
    const settings = await getSettings()
    return verifyKey(key, settings.baseUrl)
  })

  ipcMain.handle(IPC.apiKeyTest, async (_e, apiKey?: string) => {
    const key = (apiKey || '').trim() || (await getApiKey())
    if (!key) return { ok: false, message: '请先填写 API Key' }
    const settings = await getSettings()
    return verifyKey(key, settings.baseUrl)
  })

  ipcMain.handle(IPC.apiKeySet, async (_e, apiKey: string) => {
    await setApiKey(String(apiKey || ''))
    return { ok: true }
  })

  ipcMain.handle(
    IPC.synthRun,
    async (event, req: SynthRequest): Promise<SynthResponse> => {
      const started = Date.now()
      const apiKey = await getApiKey()
      if (!apiKey) {
        return {
          ok: false,
          code: 'E_NO_KEY',
          message: '尚未配置 API Key，请到「设置」页填写',
        }
      }
      const settings = await getSettings()

      const controller = new AbortController()
      const reqId = randomUUID()
      inflight.set(reqId, controller)

      try {
        let cloneSample: { buffer: Buffer; path: string } | undefined
        if (req.mode === 'clone') {
          if (!req.samplePath) {
            return { ok: false, code: 'E_NO_SAMPLE', message: '请先选择音色样本文件' }
          }
          const buffer = await fs.readFile(req.samplePath)
          cloneSample = { buffer, path: req.samplePath }
        }

        const raw = await synthesize(
          req,
          {
            apiKey,
            baseUrl: settings.baseUrl,
            models: settings.models,
            signal: controller.signal,
            onProgress: (receivedBytes) => {
              if (!event.sender.isDestroyed()) {
                event.sender.send('synth:progress', {
                  requestId: reqId,
                  receivedBytes,
                  elapsedMs: Date.now() - started,
                })
              }
            },
          },
          cloneSample,
        )

        const dir = await ensureOutputDir()
        const ext = raw.format === 'mp3' ? 'mp3' : 'wav'
        const stamp = new Date()
          .toISOString()
          .replace(/[:T]/g, '-')
          .replace(/\..+$/, '')
        const fileName = `${req.mode}-${stamp}.${ext}`
        const filePath = path.join(dir, fileName)
        await fs.writeFile(filePath, raw.audio)

        const record: GenerationRecord = {
          id: randomUUID(),
          mode: req.mode,
          text: req.text,
          instruction: req.instruction,
          voiceName:
            req.mode === 'preset'
              ? req.voiceId || 'mimo_default'
              : req.mode === 'design'
                ? req.designPrompt?.slice(0, 30)
                : path.basename(req.samplePath || ''),
          filePath,
          bytes: raw.audio.length,
          format: raw.format,
          usage: raw.usage,
          createdAt: Date.now(),
        }
        await addHistory(record)

        return {
          ok: true,
          filePath,
          bytes: raw.audio.length,
          finalTextPreview: raw.finalTextPreview,
          usage: raw.usage,
          elapsedMs: raw.elapsedMs,
          firstByteMs: raw.firstByteMs,
        }
      } catch (err: any) {
        if (err instanceof TtsError) {
          return { ok: false, code: err.code, message: err.message, detail: err.detail }
        }
        return {
          ok: false,
          code: 'E_UNKNOWN',
          message: err?.message || String(err),
        }
      } finally {
        inflight.delete(reqId)
      }
    },
  )

  ipcMain.handle(IPC.synthCancel, async (_e, requestId: string) => {
    const c = inflight.get(requestId)
    if (c) {
      c.abort()
      inflight.delete(requestId)
      return { ok: true }
    }
    return { ok: false, message: '未找到该请求' }
  })

  ipcMain.handle(IPC.fileOpenDialog, async (_e, kind: 'audio' | 'output') => {
    if (kind === 'output') {
      const res = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
      })
      return res.canceled ? null : res.filePaths[0]
    }
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '音频样本', extensions: ['wav', 'mp3'] }],
    })
    if (res.canceled || !res.filePaths[0]) return null
    const p = res.filePaths[0]
    const stat = await fs.stat(p)
    return { path: p, name: path.basename(p), bytes: stat.size }
  })

  ipcMain.handle(IPC.fileSave, async (_e, src: string, target: string) => {
    await fs.copyFile(src, target)
    return { ok: true }
  })

  // ===== 批量合成 =====
  ipcMain.handle(IPC.fileReadText, async (_e, filePath: string) => {
    // 仅允许读取文本类扩展名，防止任意文件读取被滥用
    const ext = path.extname(filePath).toLowerCase()
    if (!['.txt', '.srt', '.lrc', '.md', '.csv'].includes(ext)) {
      throw new Error('仅支持读取 txt / srt / lrc / md / csv 文本文件')
    }
    return fs.readFile(filePath, 'utf8')
  })

  /** 文本文件选择对话框（供批量导入 SRT/TXT 用） */
  ipcMain.handle('file:openTextDialog', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: '台词/字幕文件', extensions: ['txt', 'srt', 'lrc', 'md', 'csv'] },
      ],
    })
    if (res.canceled || !res.filePaths[0]) return null
    const p = res.filePaths[0]
    return { path: p, name: path.basename(p) }
  })

  /** 解析台词文件：按扩展名选规则，返回台词数组（渲染端不再各自实现） */
  ipcMain.handle('file:parseDialogue', async (_e, filePath: string) => {
    const content = await fs.readFile(filePath, 'utf8')
    const ext = path.extname(filePath).toLowerCase()
    let lines: string[]
    if (ext === '.srt') lines = parseSrt(content)
    else if (ext === '.lrc') {
      lines = content
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l) => l.replace(/^\[[^\]]*\]\s*/, '').trim())
        .filter(Boolean)
    } else lines = parseTxt(content)
    return lines
  })

  ipcMain.handle(IPC.fileWriteText, async (_e, filePath: string, content: string) => {
    await fs.writeFile(filePath, content, 'utf8')
    return { ok: true }
  })

  /** 保存录音样本：渲染端转好 WAV 字节数组传过来，落到 samples 目录 */
  ipcMain.handle(
    IPC.fileSaveRecorded,
    async (_e, name: string, bytes: number[]) => {
      try {
        const dir = path.join(app.getPath('userData'), 'samples')
        await fs.mkdir(dir, { recursive: true })
        // 防路径穿越：只取文件名部分，并把非法字符替换掉
        const safe = path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        const target = path.join(dir, safe)
        const buf = Buffer.from(bytes)
        await fs.writeFile(target, buf)
        return { ok: true, path: target, bytes: buf.length }
      } catch (e: any) {
        return { ok: false, message: e?.message || String(e) }
      }
    },
  )

  /** 音频后期处理：去静音 / 响度归一 / 静音上限 / 增益（产出新文件，不覆盖原件） */
  ipcMain.handle(
    IPC.audioProcess,
    async (
      _e,
      payload: {
        filePath: string
        trimEdges?: boolean
        normalize?: boolean
        capSilenceMs?: number
        gainDb?: number
      },
    ) => {
      try {
        const raw = await fs.readFile(payload.filePath)
        // Buffer<ArrayBufferLike> → Buffer 的宽松类型，audiofx 返回普通 Buffer
        let out: Buffer = Buffer.from(raw)
        const applied: string[] = []

        if (payload.trimEdges) {
          out = trimEdges(out)
          applied.push('去首尾静音')
        }
        if (payload.capSilenceMs && payload.capSilenceMs > 0) {
          out = capSilence(out, payload.capSilenceMs)
          applied.push(`静音上限 ${payload.capSilenceMs}ms`)
        }
        if (payload.gainDb) {
          out = applyGain(out, payload.gainDb)
          applied.push(`增益 ${payload.gainDb > 0 ? '+' : ''}${payload.gainDb}dB`)
        }
        if (payload.normalize) {
          out = normalizePeak(out, -1)
          applied.push('峰值归一 -1dB')
        }

        if (out === raw) {
          return { ok: true, filePath: payload.filePath, changed: false, applied }
        }

        const dir = path.dirname(payload.filePath)
        const base = path.basename(payload.filePath, path.extname(payload.filePath))
        const ext = path.extname(payload.filePath) || '.wav'
        const target = path.join(dir, `${base}_processed${ext}`)
        await fs.writeFile(target, out)

        return {
          ok: true,
          filePath: target,
          changed: true,
          applied,
          before: getWavInfo(raw),
          after: getWavInfo(out),
        }
      } catch (e: any) {
        return { ok: false, message: e?.message || String(e) }
      }
    },
  )

  /** 读取音频基本信息（时长、峰值 dB），用于 UI 展示 */
  ipcMain.handle(IPC.audioInfo, async (_e, filePath: string) => {
    try {
      const buf = await fs.readFile(filePath)
      return { ok: true, ...getWavInfo(buf) }
    } catch (e: any) {
      return { ok: false, message: e?.message || String(e) }
    }
  })

  ipcMain.handle(IPC.batchRun, async (event, req: BatchRunRequest) => {
    setBatchRunning(true)
    try {
      return await runBatch(req, {
        send: (channel, payload) => {
          if (!event.sender.isDestroyed()) event.sender.send(channel, payload)
        },
      })
    } finally {
      setBatchRunning(false)
    }
  })

  ipcMain.handle(IPC.batchCancel, (_e, jobId: string) => {
    return { ok: cancelBatch(jobId) }
  })

  // ===== 文本模型辅助（音色描述润色 / 采样文本生成）=====
  ipcMain.handle(IPC.llmPolish, async (_e, idea: string) => {
    const apiKey = await getApiKey()
    if (!apiKey) throw new TtsError('E_NO_KEY', '尚未配置 API Key')
    const settings = await getSettings()
    return polishVoiceDescription(idea, {
      apiKey,
      baseUrl: settings.baseUrl ?? undefined,
    })
  })

  ipcMain.handle(IPC.llmSampleText, async (_e, description: string) => {
    const apiKey = await getApiKey()
    if (!apiKey) throw new TtsError('E_NO_KEY', '尚未配置 API Key')
    const settings = await getSettings()
    return generateSampleText(description, {
      apiKey,
      baseUrl: settings.baseUrl ?? undefined,
    })
  })

  // ===== ASR 转写 =====
  ipcMain.handle(
    IPC.asrTranscribe,
    async (_e, payload: { path: string }): Promise<AsrResponse> => {
      try {
        const apiKey = await getApiKey()
        if (!apiKey) return { ok: false, code: 'E_NO_KEY', message: '尚未配置 API Key' }
        const settings = await getSettings()
        const buf = await fs.readFile(payload.path)
        const ext = path.extname(payload.path).toLowerCase()
        const format: 'wav' | 'mp3' = ext === '.mp3' ? 'mp3' : 'wav'
        const r = await transcribe(buf, format, {
          apiKey,
          baseUrl: settings.baseUrl ?? undefined,
        })
        return {
          ok: true,
          text: r.text,
          seconds: r.seconds,
          audioTokens: r.usage?.audioTokens,
          totalTokens: r.usage?.totalTokens,
          elapsedMs: r.elapsedMs,
        }
      } catch (err: any) {
        if (err instanceof TtsError) {
          return { ok: false, code: err.code, message: err.message }
        }
        return { ok: false, code: 'E_UNKNOWN', message: err?.message || String(err) }
      }
    },
  )

  // ===== 风格方案 =====
  ipcMain.handle(IPC.styleList, () => listStyles())
  ipcMain.handle(IPC.styleSave, (_e, input: Omit<StylePreset, 'id' | 'createdAt'> & { id?: string }) =>
    saveStyle(input),
  )
  ipcMain.handle(IPC.styleRemove, (_e, id: string) => removeStyle(id))

  // ===== 时间戳配音：按 [mm:ss] 时间轴逐段合成 + 总轨摆放 =====
  ipcMain.handle(
    IPC.synthTimeline,
    async (event, req: TimelineRequest): Promise<TimelineResponse> => {
      const apiKey = await getApiKey()
      if (!apiKey) return { ok: false, code: 'E_NO_KEY', message: '尚未配置 API Key' }
      if (!req.cues.length) return { ok: false, code: 'E_EMPTY', message: '没有可合成的台词' }
      const settings = await getSettings()
      const started = Date.now()

      try {
        const items: TimelineItem[] = []
        const placedStr: string[] = []
        for (let i = 0; i < req.cues.length; i++) {
          const cue = req.cues[i]
          const raw = await synthesize(
            {
              mode: 'preset',
              text: cue.text,
              instruction: req.instruction,
              voiceId: req.voiceId || 'mimo_default',
              format: 'wav',
            },
            { apiKey, baseUrl: settings.baseUrl ?? undefined, models: settings.models },
          )
          items.push({ audio: raw.audio, offsetMs: parseTimeMs(cue.time) })
          const placed = items[i]
          // 实际摆放位置在 buildTimelineWav 里定，这里先给请求时间
          placedStr.push(cue.time)
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC.timelineProgress, {
              index: i,
              total: req.cues.length,
              placedAt: cue.time,
              elapsedMs: Date.now() - started,
            })
          }
        }

        const merged = buildTimelineWav(items)
        const dir = await ensureOutputDir()
        const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '')
        const filePath = path.join(dir, `timeline-${stamp}.wav`)
        await fs.writeFile(filePath, merged.buffer)

        // 同步导出 LRC 字幕（用实际摆放时间）
        const lrcPath = filePath.replace(/\.wav$/, '.lrc')
        const lrcLines = req.cues.map((c, i) => {
          const ms = merged.placedMs[i] ?? 0
          const m = Math.floor(ms / 60000)
          const s = Math.floor((ms % 60000) / 1000)
          const cs = Math.floor((ms % 1000) / 10)
          return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}]${c.text}`
        })
        await fs.writeFile(lrcPath, `[ti:VoiceCanvas 时间戳配音]\n${lrcLines.join('\n')}`, 'utf8')

        await addHistory({
          id: randomUUID(),
          mode: 'preset',
          text: `时间戳配音 ${req.cues.length} 段（${req.cues[0]?.text.slice(0, 30) || ''}…）`,
          instruction: req.instruction,
          voiceName: req.voiceId || 'mimo_default',
          filePath,
          bytes: merged.buffer.length,
          format: 'wav',
          createdAt: Date.now(),
        })

        return {
          ok: true,
          filePath,
          lrcPath,
          durationMs: merged.durationMs,
          placedMs: merged.placedMs,
        }
      } catch (err: any) {
        if (err instanceof TtsError) {
          return { ok: false, code: err.code, message: err.message }
        }
        return { ok: false, code: 'E_UNKNOWN', message: err?.message || String(err) }
      }
    },
  )

  // ===== 风格方案 =====（原位置）
  ipcMain.handle(IPC.styleList, () => listStyles())
  ipcMain.handle(IPC.styleSave, (_e, input: Omit<StylePreset, 'id' | 'createdAt'> & { id?: string }) =>
    saveStyle(input),
  )
  ipcMain.handle(IPC.styleRemove, (_e, id: string) => removeStyle(id))

  // ===== 长文本分段合成：多段按序合成 + WAV 拼接 =====
  ipcMain.handle(IPC.synthRunLong, async (event, base: SynthRequest, segments: string[]) => {
    const apiKey = await getApiKey()
    if (!apiKey) return { ok: false, code: 'E_NO_KEY', message: '尚未配置 API Key' }
    const settings = await getSettings()
    const started = Date.now()
    const audioParts: Buffer[] = []
    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

    try {
      for (let i = 0; i < segments.length; i++) {
        if (event.sender.isDestroyed()) break
        const seg = segments[i]
        const segReq: SynthRequest = { ...base, text: seg, stream: false }
        let cloneSample: { buffer: Buffer; path: string } | undefined
        if (segReq.mode === 'clone' && segReq.samplePath) {
          cloneSample = { buffer: await fs.readFile(segReq.samplePath), path: segReq.samplePath }
        }
        const raw = await synthesize(
          segReq,
          {
            apiKey,
            baseUrl: settings.baseUrl ?? undefined,
            models: settings.models,
          },
          cloneSample,
        )
        audioParts.push(raw.audio)
        if (raw.usage) {
          usage.promptTokens += raw.usage.promptTokens
          usage.completionTokens += raw.usage.completionTokens
          usage.totalTokens += raw.usage.totalTokens
        }
        event.sender.send('synth:longprogress', {
          index: i,
          total: segments.length,
          elapsedMs: Date.now() - started,
        })
      }

      const merged = concatWavs(audioParts)
      const dir = await ensureOutputDir()
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '')
      const ext = merged ? 'wav' : 'wav'
      const filePath = path.join(dir, `long-${stamp}.${ext}`)
      await fs.writeFile(filePath, merged)

      await addHistory({
        id: randomUUID(),
        mode: base.mode,
        text: `${base.text.slice(0, 80)}${base.text.length > 80 ? '…' : ''}（长文 ${segments.length} 段）`,
        instruction: base.instruction,
        voiceName: base.voiceId || '长文合成',
        filePath,
        bytes: merged.length,
        format: 'wav',
        usage,
        createdAt: Date.now(),
      })

      return {
        ok: true,
        filePath,
        bytes: merged.length,
        usage,
        elapsedMs: Date.now() - started,
        segments: segments.length,
      }
    } catch (err: any) {
      if (err instanceof TtsError) {
        return { ok: false, code: err.code, message: err.message, detail: err.detail }
      }
      return { ok: false, code: 'E_UNKNOWN', message: err?.message || String(err) }
    }
  })

  ipcMain.handle(IPC.historyExport, async (_e, format: ExportFormat) => {
    const records = await listHistory()
    const res = await dialog.showSaveDialog({
      defaultPath: `voicecanvas-history-${new Date().toISOString().slice(0, 10)}.${format}`,
      filters:
        format === 'csv'
          ? [{ name: 'CSV 表格', extensions: ['csv'] }]
          : [{ name: 'JSON 数据', extensions: ['json'] }],
    })
    if (res.canceled || !res.filePath) return null

    if (format === 'json') {
      await fs.writeFile(res.filePath, JSON.stringify(records, null, 2), 'utf8')
    } else {
      // CSV 带 BOM，Excel 打开不乱码
      const header = '时间,模式,音色,文本,文件路径,大小(字节),格式,prompt_tokens,completion_tokens'
      const esc = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`
      const rows = records.map((r) =>
        [
          new Date(r.createdAt).toLocaleString('zh-CN'),
          r.mode,
          esc(r.voiceName || ''),
          esc(r.text),
          esc(r.filePath),
          r.bytes,
          r.format,
          r.usage?.promptTokens ?? '',
          r.usage?.completionTokens ?? '',
        ].join(','),
      )
      await fs.writeFile(res.filePath, '\ufeff' + [header, ...rows].join('\r\n'), 'utf8')
    }
    return { path: res.filePath, count: records.length }
  })

  ipcMain.handle(IPC.fileReveal, async (_e, target: string) => {
    shell.showItemInFolder(target)
    return { ok: true }
  })

  ipcMain.handle(IPC.voicesList, () => listVoices())
  ipcMain.handle(IPC.voicesUpsert, (_e, input: Partial<VoiceAsset>) =>
    upsertVoice(input as any),
  )
  ipcMain.handle(IPC.voicesRemove, (_e, id: string) => removeVoice(id))

  ipcMain.handle(IPC.historyList, () => listHistory())
  ipcMain.handle(IPC.historyRemove, (_e, id: string) => removeHistory(id))
}

app.whenReady().then(() => {
  registerMediaProtocol()
  registerIpc()
  createWindow()
  createTray()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ===== 托盘：批量任务跑批时关窗口 = 隐藏到托盘继续干活 =====
let tray: Tray | null = null
let batchRunningCount = 0

// 托盘「退出」或系统关机时的正常退出标记
app.on('before-quit', () => {
  ;(app as any).isQuitting = true
})

function createTray(): void {
  try {
    const iconPath = path.join(process.resourcesPath || '', 'icon.ico')
    const fallback = path.join(app.getAppPath(), 'build', 'icon.ico')
    const icon = require('node:fs').existsSync(iconPath) ? iconPath : fallback
    tray = new Tray(icon)
  } catch {
    return
  }
  tray.setToolTip('声绘 VoiceCanvas')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => mainWindow?.show() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          tray = null
          app.quit()
        },
      },
    ]),
  )
  tray.on('double-click', () => mainWindow?.show())
}

/** 批量引擎运行时改判关闭行为：有任务 → 隐藏到托盘；否则正常退出 */
export function setBatchRunning(running: boolean): void {
  batchRunningCount += running ? 1 : -1
  if (batchRunningCount < 0) batchRunningCount = 0
}

export { PRESET_VOICES, DEFAULT_MODELS, DEFAULT_BASE_URL }
