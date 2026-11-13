/**
 * 平台适配层：让同一套 Vue 界面既能跑在 Electron（window.vc），
 * 也能跑在纯浏览器 / PWA / Capacitor APK 里。
 *
 * 浏览器模式下的差异：
 * - 没有 IPC → API 直接用 fetch（需要服务端允许 CORS，或走 Capacitor 的原生 HTTP）
 * - 没有 safeStorage → Key 存 localStorage（明示风险）
 * - 没有文件系统 → 音频用 Blob + 下载链接，音色库存 IndexedDB/localStorage
 *
 * 用法：界面只 import { api } from '@renderer/platform'，不直接碰 window.vc。
 */

import type {
  AppSettings,
  AsrResponse,
  BatchProgressEvent,
  BatchRunRequest,
  GenerationRecord,
  StylePreset,
  SynthRequest,
  SynthResponse,
  TimelineRequest,
  TimelineResponse,
  VoiceAsset,
} from '../../shared/types'
import { DEFAULT_BASE_URL, DEFAULT_MODELS } from '../../shared/constants'

const isElectron = typeof window !== 'undefined' && !!window.vc

// ============ 浏览器模式的本地存储 ============

const LS_KEY = 'vc.apiKey'
const LS_SETTINGS = 'vc.settings'
const LS_VOICES = 'vc.voices'
const LS_HISTORY = 'vc.history'
const LS_STYLES = 'vc.styles'

function lsGet<T>(k: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(k)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function lsSet(k: string, v: unknown): void {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* 配额满时忽略 */
  }
}

// ============ 浏览器模式的直接 API 调用 ============

interface ChatAudioResult {
  audioBase64: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  finalTextPreview?: string
}

async function webSynthesize(req: SynthRequest): Promise<ChatAudioResult> {
  const settings = webGetSettings()
  const key = localStorage.getItem(LS_KEY) || ''
  if (!key) throw new Error('尚未配置 API Key')

  const messages: Array<{ role: string; content: string }> = []
  if (req.mode === 'design') {
    if (!req.designPrompt?.trim()) throw new Error('音色设计模式必须填写描述')
    messages.push({ role: 'user', content: req.designPrompt })
  } else if (req.instruction?.trim()) {
    messages.push({ role: 'user', content: req.instruction })
  }
  if (req.text?.trim()) messages.push({ role: 'assistant', content: req.text })

  const model =
    req.mode === 'design'
      ? settings.models.design
      : req.mode === 'clone'
        ? settings.models.clone
        : settings.models.preset

  const audio: Record<string, unknown> = { format: req.format === 'pcm16' ? 'wav' : req.format }
  if (req.mode === 'preset') audio.voice = req.voiceId || 'mimo_default'
  if (req.mode === 'design' && req.optimizeTextPreview) audio.optimize_text_preview = true
  if (req.mode === 'clone' && (req as any).cloneVoiceDataUri) {
    audio.voice = (req as any).cloneVoiceDataUri
  }

  const res = await fetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, audio }),
  })
  if (!res.ok) {
    const t = await res.text()
    let msg = t.slice(0, 200)
    try {
      msg = JSON.parse(t)?.error?.message ?? msg
    } catch {
      /* keep */
    }
    throw new Error(`接口返回 ${res.status}：${msg}`)
  }
  const json = await res.json()
  const b64 = json?.choices?.[0]?.message?.audio?.data
  if (!b64) throw new Error('服务端没有返回音频')
  return {
    audioBase64: b64,
    usage: json?.usage,
    finalTextPreview: json?.choices?.[0]?.message?.final_text_preview,
  }
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** 浏览器模式：把音频变成可播放的 blob URL，并触发一次下载 */
function saveBlobUrl(blob: Blob): string {
  return URL.createObjectURL(blob)
}

/**
 * UUID 生成：crypto.randomUUID 只在安全上下文（HTTPS/localhost）可用，
 * file:// 打开的 PWA 不算安全上下文，必须有 fallback。
 */
function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID()
    }
  } catch {
    /* 继续用 fallback */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// ============ 浏览器模式的设置 ============

function webGetSettings(): AppSettings {
  const stored = lsGet<Partial<AppSettings>>(LS_SETTINGS, {})
  return {
    providerId: 'mimo',
    baseUrl: stored.baseUrl || DEFAULT_BASE_URL,
    models: { ...DEFAULT_MODELS, ...(stored.models || {}) },
    defaultFormat: stored.defaultFormat || 'wav',
    outputDir: stored.outputDir || '（浏览器内下载）',
    hasApiKey: !!localStorage.getItem(LS_KEY),
  }
}

// ============ 统一 API 出口 ============

export const isWeb = !isElectron

export const api = {
  isWeb,
  settings: {
    get: async (): Promise<AppSettings> =>
      isElectron ? window.vc.settings.get() : webGetSettings(),
    update: async (patch: Partial<AppSettings>): Promise<AppSettings> => {
      if (isElectron) return window.vc.settings.update(patch)
      const cur = webGetSettings()
      lsSet(LS_SETTINGS, { ...cur, ...patch })
      return webGetSettings()
    },
  },
  apiKey: {
    set: async (key: string): Promise<{ ok: boolean }> => {
      if (isElectron) return window.vc.apiKey.set(key)
      localStorage.setItem(LS_KEY, key.trim())
      return { ok: true }
    },
    test: async (
      key?: string,
    ): Promise<{ ok: boolean; models?: string[]; message?: string }> => {
      if (isElectron) return window.vc.apiKey.test(key)
      const k = (key || localStorage.getItem(LS_KEY) || '').trim()
      if (!k) return { ok: false, message: '尚未填写 API Key' }
      try {
        const s = webGetSettings()
        const res = await fetch(`${s.baseUrl.replace(/\/+$/, '')}/models`, {
          headers: { 'api-key': k },
        })
        if (!res.ok) return { ok: false, message: `鉴权失败（${res.status}）` }
        const j = await res.json()
        return { ok: true, models: (j?.data || []).map((m: any) => m.id) }
      } catch (e: any) {
        return { ok: false, message: e?.message || '连接失败' }
      }
    },
  },
  synth: {
    run: async (req: SynthRequest): Promise<SynthResponse & { blobUrl?: string }> => {
      if (isElectron) return window.vc.synth.run(req)
      const started = Date.now()
      try {
        const r = await webSynthesize(req)
        const mime = req.format === 'mp3' ? 'audio/mpeg' : 'audio/wav'
        const blob = base64ToBlob(r.audioBase64, mime)
        const blobUrl = saveBlobUrl(blob)
        // 浏览器模式的历史记录
        const hist = lsGet<GenerationRecord[]>(LS_HISTORY, [])
        const rec: GenerationRecord = {
          id: genId(),
          mode: req.mode,
          text: req.text,
          instruction: req.instruction,
          voiceName: req.voiceId,
          filePath: blobUrl,
          bytes: blob.size,
          format: req.format,
          usage: r.usage
            ? {
                promptTokens: r.usage.prompt_tokens,
                completionTokens: r.usage.completion_tokens,
                totalTokens: r.usage.total_tokens,
              }
            : undefined,
          createdAt: Date.now(),
        }
        lsSet(LS_HISTORY, [rec, ...hist].slice(0, 200))
        return {
          ok: true,
          filePath: blobUrl,
          blobUrl,
          bytes: blob.size,
          finalTextPreview: r.finalTextPreview,
          usage: rec.usage,
          elapsedMs: Date.now() - started,
        }
      } catch (e: any) {
        return { ok: false, code: 'E_WEB', message: e?.message || String(e) }
      }
    },
    cancel: async (): Promise<{ ok: boolean }> => ({ ok: true }),
    onProgress: () => () => {},
    runLong: async (
      base: SynthRequest,
      segments: string[],
    ): Promise<SynthResponse & { segments?: number }> => {
      if (isElectron) return window.vc.synth.runLong(base, segments)
      // 浏览器模式：逐段合成后用 Web Audio 拼接
      try {
        const buffers: AudioBuffer[] = []
        const ctx = new AudioContext()
        for (const seg of segments) {
          const r = await webSynthesize({ ...base, text: seg, stream: false })
          const blob = base64ToBlob(r.audioBase64, 'audio/wav')
          buffers.push(await ctx.decodeAudioData(await blob.arrayBuffer()))
        }
        const totalLen = buffers.reduce((n, b) => n + b.length, 0)
        const merged = ctx.createBuffer(1, totalLen, buffers[0]?.sampleRate || 24000)
        const ch = merged.getChannelData(0)
        let off = 0
        for (const b of buffers) {
          ch.set(b.getChannelData(0), off)
          off += b.length
        }
        const wav = encodeWavFromBuffer(merged)
        const blobUrl = URL.createObjectURL(wav)
        await ctx.close()
        return {
          ok: true,
          filePath: blobUrl,
          blobUrl,
          bytes: wav.size,
          elapsedMs: 0,
          segments: segments.length,
        } as any
      } catch (e: any) {
        return { ok: false, code: 'E_WEB', message: e?.message || String(e) }
      }
    },
    runTimeline: async (req: TimelineRequest): Promise<TimelineResponse> => {
      if (isElectron) return window.vc.synth.runTimeline(req)
      return { ok: false, code: 'E_WEB_UNSUPPORTED', message: '浏览器模式暂不支持时间轴配音' }
    },
    onLongProgress: () => () => {},
    onTimelineProgress: () => () => {},
  },
  file: {
    openDialog: async (kind: 'audio' | 'output'): Promise<any> => {
      if (isElectron) return window.vc.file.openDialog(kind)
      // 浏览器：用 input[type=file] 模拟
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = kind === 'audio' ? 'audio/wav,audio/mpeg' : '*/*'
        input.onchange = () => {
          const f = input.files?.[0]
          if (!f) return resolve(null)
          if (kind === 'output') return resolve(null)
          resolve({ path: URL.createObjectURL(f), name: f.name, bytes: f.size })
        }
        input.click()
      })
    },
    save: async (): Promise<{ ok: boolean }> => ({ ok: true }),
    reveal: async (): Promise<{ ok: boolean }> => ({ ok: true }),
    readText: async (): Promise<string> => '',
    writeText: async (): Promise<{ ok: boolean }> => ({ ok: true }),
    openTextDialog: async (): Promise<{ path: string; name: string } | null> => {
      if (isElectron) return window.vc.file.openTextDialog()
      return null
    },
    parseDialogue: async (): Promise<string[]> => [],
    saveRecordedAudio: async (): Promise<{
      ok: boolean
      path?: string
      bytes?: number
      message?: string
    }> => ({
      ok: false,
      message: '浏览器模式不支持该操作',
    }),
    processAudio: async (): Promise<any> => ({ ok: false, message: '浏览器模式暂不支持' }),
    audioInfo: async (): Promise<any> => ({ ok: false }),
    toMediaUrl: (p: string): string => (isElectron ? window.vc.file.toMediaUrl(p) : p),
  },
  voices: {
    list: async (): Promise<VoiceAsset[]> =>
      isElectron ? window.vc.voices.list() : lsGet(LS_VOICES, []),
    upsert: async (input: VoiceAsset): Promise<VoiceAsset> => {
      if (isElectron) return window.vc.voices.upsert(input)
      const list = lsGet<VoiceAsset[]>(LS_VOICES, [])
      const now = Date.now()
      const asset: VoiceAsset = {
        ...(input as VoiceAsset),
        id: input.id || genId(),
        createdAt: now,
        updatedAt: now,
      }
      const idx = list.findIndex((v) => v.id === asset.id)
      if (idx >= 0) list[idx] = asset
      else list.push(asset)
      lsSet(LS_VOICES, list)
      return asset
    },
    remove: async (id: string): Promise<void> => {
      if (isElectron) return window.vc.voices.remove(id)
      lsSet(
        LS_VOICES,
        lsGet<VoiceAsset[]>(LS_VOICES, []).filter((v) => v.id !== id),
      )
    },
  },
  history: {
    list: async (): Promise<GenerationRecord[]> =>
      isElectron ? window.vc.history.list() : lsGet(LS_HISTORY, []),
    remove: async (id: string): Promise<void> => {
      if (isElectron) return window.vc.history.remove(id)
      lsSet(
        LS_HISTORY,
        lsGet<GenerationRecord[]>(LS_HISTORY, []).filter((r) => r.id !== id),
      )
    },
    export: async (): Promise<{ path: string; count: number } | null> => {
      if (isElectron) return window.vc.history.export('json')
      return null
    },
  },
  batch: {
    run: async (req: BatchRunRequest): Promise<any> => {
      if (isElectron) return window.vc.batch.run(req)
      return { jobId: 'web', tasks: [] }
    },
    cancel: async (): Promise<{ ok: boolean }> => ({ ok: true }),
    onProgress: (_cb: (e: BatchProgressEvent) => void) => () => {},
  },
  probe: {
    models: async (): Promise<{ ok: boolean; models?: string[]; message?: string }> =>
      api.apiKey.test(),
  },
  llm: {
    polishDescription: async (idea: string): Promise<string> => {
      if (isElectron) return window.vc.llm.polishDescription(idea)
      throw new Error('浏览器模式暂不支持 AI 写手')
    },
    generateSampleText: async (description: string): Promise<string> => {
      if (isElectron) return window.vc.llm.generateSampleText(description)
      throw new Error('浏览器模式暂不支持 AI 写手')
    },
  },
  asr: {
    transcribe: async (): Promise<AsrResponse> => ({ ok: false, message: '浏览器模式暂不支持' }),
  },
  styles: {
    list: async (): Promise<StylePreset[]> =>
      isElectron ? window.vc.styles.list() : lsGet(LS_STYLES, []),
    save: async (input: any): Promise<StylePreset> => {
      if (isElectron) return window.vc.styles.save(input)
      const list = lsGet<StylePreset[]>(LS_STYLES, [])
      const preset: StylePreset = { ...input, id: genId(), createdAt: Date.now() }
      list.push(preset)
      lsSet(LS_STYLES, list)
      return preset
    },
    remove: async (id: string): Promise<void> => {
      if (isElectron) return window.vc.styles.remove(id)
      lsSet(
        LS_STYLES,
        lsGet<StylePreset[]>(LS_STYLES, []).filter((s) => s.id !== id),
      )
    },
  },
}

/** AudioBuffer → WAV Blob（浏览器拼接用） */
function encodeWavFromBuffer(buffer: AudioBuffer): Blob {
  const numCh = 1
  const rate = buffer.sampleRate
  const samples = buffer.length
  const ab = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(ab)
  const ws = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i))
  }
  ws(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  ws(8, 'WAVE')
  ws(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numCh, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ws(36, 'data')
  view.setUint32(40, samples * 2, true)
  const data = buffer.getChannelData(0)
  let off = 44
  for (let i = 0; i < samples; i++) {
    const s = Math.max(-1, Math.min(1, data[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  return new Blob([ab], { type: 'audio/wav' })
}

export function downloadBlob(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}
