import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { IPC } from '../shared/types'
import type {
  GenerationRecord,
  SynthRequest,
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
import { concatWavs } from './wav'
import type { BatchRunRequest, ExportFormat } from '../shared/types'

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

  ipcMain.handle(IPC.batchRun, async (event, req: BatchRunRequest) => {
    return runBatch(req, {
      send: (channel, payload) => {
        if (!event.sender.isDestroyed()) event.sender.send(channel, payload)
      },
    })
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
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export { PRESET_VOICES, DEFAULT_MODELS, DEFAULT_BASE_URL }
