import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type {
  AppSettings,
  AsrResponse,
  BatchProgressEvent,
  BatchRunRequest,
  BatchTask,
  GenerationRecord,
  StylePreset,
  SynthRequest,
  SynthResponse,
  TimelineProgressEvent,
  TimelineRequest,
  TimelineResponse,
  VoiceAsset,
} from '../shared/types'

/**
 * 预加载桥：渲染进程只能通过这里访问主进程能力。
 * 严禁把 ipcRenderer 整体暴露（会导致任意通道可调用）。
 */
const api = {
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC.settingsUpdate, patch),
  },
  apiKey: {
    set: (key: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.apiKeySet, key),
    test: (
      key?: string,
    ): Promise<{ ok: boolean; models?: string[]; message?: string }> =>
      ipcRenderer.invoke(IPC.apiKeyTest, key),
  },
  synth: {
    run: (req: SynthRequest): Promise<SynthResponse> =>
      ipcRenderer.invoke(IPC.synthRun, req),
    cancel: (requestId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.synthCancel, requestId),
    /** 长文本：多段按序合成 + WAV 拼接（每段之间 300ms 静音） */
    runLong: (
      base: SynthRequest,
      segments: string[],
    ): Promise<SynthResponse & { segments?: number }> =>
      ipcRenderer.invoke(IPC.synthRunLong, base, segments),
    /** 时间戳配音：按 [mm:ss] 时间轴逐段合成 + 总轨摆放，输出 WAV + LRC */
    runTimeline: (req: TimelineRequest): Promise<TimelineResponse> =>
      ipcRenderer.invoke(IPC.synthTimeline, req),
    /** 时间轴逐段进度 */
    onTimelineProgress: (cb: (e: TimelineProgressEvent) => void) => {
      const handler = (_e: unknown, payload: TimelineProgressEvent) => cb(payload)
      ipcRenderer.on(IPC.timelineProgress, handler)
      return () => ipcRenderer.removeListener(IPC.timelineProgress, handler)
    },
    /** 长文本逐段进度 */
    onLongProgress: (
      cb: (e: { index: number; total: number; elapsedMs: number }) => void,
    ) => {
      const handler = (_e: unknown, payload: any) => cb(payload)
      ipcRenderer.on('synth:longprogress', handler)
      return () => ipcRenderer.removeListener('synth:longprogress', handler)
    },
    onProgress: (
      cb: (e: { requestId: string; receivedBytes: number; elapsedMs: number }) => void,
    ) => {
      const handler = (_e: unknown, payload: any) => cb(payload)
      ipcRenderer.on('synth:progress', handler)
      return () => ipcRenderer.removeListener('synth:progress', handler)
    },
  },
  file: {
    openDialog: (
      kind: 'audio' | 'output',
    ): Promise<any> => ipcRenderer.invoke(IPC.fileOpenDialog, kind),
    save: (filePath: string, target: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.fileSave, filePath, target),
    reveal: (filePath: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.fileReveal, filePath),
    /** 读取文本文件（仅 txt/srt/lrc/md/csv 白名单扩展名） */
    readText: (filePath: string): Promise<string> =>
      ipcRenderer.invoke(IPC.fileReadText, filePath),
    writeText: (filePath: string, content: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.fileWriteText, filePath, content),
    /** 保存录音的 WAV 字节到应用数据目录，返回落盘绝对路径 */
    saveRecordedAudio: (
      name: string,
      bytes: number[],
    ): Promise<{ ok: boolean; path?: string; bytes?: number; message?: string }> =>
      ipcRenderer.invoke(IPC.fileSaveRecorded, name, bytes),
    /** 音频后期处理（去静音/归一/静音上限/增益/淡入淡出/变速），产出新文件 */
    processAudio: (payload: {
      filePath: string
      trimEdges?: boolean
      normalize?: boolean
      capSilenceMs?: number
      gainDb?: number
      fadeMs?: number
      speed?: number
    }): Promise<{
      ok: boolean
      filePath?: string
      changed?: boolean
      applied?: string[]
      before?: { durationMs: number; peakDb: number }
      after?: { durationMs: number; peakDb: number }
      message?: string
    }> => ipcRenderer.invoke(IPC.audioProcess, payload),
    /** 音频信息：时长、采样率、峰值 */
    audioInfo: (
      filePath: string,
    ): Promise<{
      ok: boolean
      durationMs?: number
      sampleRate?: number
      peakDb?: number
      message?: string
    }> => ipcRenderer.invoke(IPC.audioInfo, filePath),
    /** 批量导出音频包到指定目录（含元数据与清单） */
    exportAudioPack: (
      ids: string[],
    ): Promise<{
      ok: boolean
      copied?: number
      index?: string
      errors?: string[]
      canceled?: boolean
      message?: string
    }> => ipcRenderer.invoke(IPC.exportAudioPack, ids),
    /** 打开文本文件选择框（SRT/TXT 台词导入用），返回 {path,name} 或 null */
    openTextDialog: (): Promise<{ path: string; name: string } | null> =>
      ipcRenderer.invoke('file:openTextDialog'),
    /** 按扩展名解析台词文件（srt/lrc/txt），返回台词数组 */
    parseDialogue: (filePath: string): Promise<string[]> =>
      ipcRenderer.invoke('file:parseDialogue', filePath),
    /** 把本地绝对路径转成可播放的 vcmedia:// URL，不走 file:// 权限 */
    toMediaUrl: (filePath: string): string =>
      `vcmedia://local/${encodeURIComponent(filePath)}`,
  },
  voices: {
    list: (): Promise<VoiceAsset[]> => ipcRenderer.invoke(IPC.voicesList),
    upsert: (input: VoiceAsset): Promise<VoiceAsset> =>
      ipcRenderer.invoke(IPC.voicesUpsert, input),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.voicesRemove, id),
  },
  history: {
    list: (): Promise<GenerationRecord[]> => ipcRenderer.invoke(IPC.historyList),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.historyRemove, id),
    export: (
      format: 'csv' | 'json',
    ): Promise<{ path: string; count: number } | null> =>
      ipcRenderer.invoke(IPC.historyExport, format),
  },
  batch: {
    run: (req: BatchRunRequest): Promise<{ jobId: string; tasks: BatchTask[] }> =>
      ipcRenderer.invoke(IPC.batchRun, req),
    cancel: (jobId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.batchCancel, jobId),
    onProgress: (cb: (e: BatchProgressEvent) => void) => {
      const handler = (_e: unknown, payload: BatchProgressEvent) => cb(payload)
      ipcRenderer.on('batch:progress', handler)
      return () => ipcRenderer.removeListener('batch:progress', handler)
    },
  },
  probe: {
    models: (): Promise<{ ok: boolean; models?: string[]; message?: string }> =>
      ipcRenderer.invoke(IPC.probeModels),
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke(IPC.winMinimize),
    toggleMaximize: (): Promise<boolean | undefined> =>
      ipcRenderer.invoke(IPC.winMaximize),
    close: (): Promise<void> => ipcRenderer.invoke(IPC.winClose),
    isMaximized: (): Promise<boolean | undefined> =>
      ipcRenderer.invoke(IPC.winIsMaximized),
  },
  video: {
    pickOpen: (): Promise<{ path: string; name: string } | null> =>
      ipcRenderer.invoke(IPC.videoPickOpen),
    extractFrames: (videoPath: string, fps: number): Promise<any> =>
      ipcRenderer.invoke(IPC.videoExtractFrames, videoPath, fps),
    extractAudio: (videoPath: string): Promise<{ path: string }> =>
      ipcRenderer.invoke(IPC.videoExtractAudio, videoPath),
    muxAudio: (videoPath: string, audioWav: string): Promise<{ path: string }> =>
      ipcRenderer.invoke(IPC.videoMuxAudio, videoPath, audioWav),
    ocrFrames: (frames: Array<{ path: string; timeMs: number }>): Promise<any[]> =>
      ipcRenderer.invoke(IPC.ocrFrames, frames),
  },
  whisper: {
    status: (): Promise<{ bin: boolean; model: boolean }> =>
      ipcRenderer.invoke(IPC.whisperStatus),
    downloadBin: (onPct: (pct: number) => void): Promise<void> => {
      const handler = (_e: unknown, pct: number) => onPct(pct)
      ipcRenderer.on('whisper:dlProgress', handler)
      return ipcRenderer.invoke(IPC.whisperDownloadBin).finally(() => {
        ipcRenderer.removeListener('whisper:dlProgress', handler)
      })
    },
    downloadModel: (
      model: string,
      onPct: (pct: number) => void,
    ): Promise<void> => {
      const handler = (_e: unknown, pct: number) => onPct(pct)
      ipcRenderer.on('whisper:dlProgress', handler)
      return ipcRenderer
        .invoke(IPC.whisperDownloadModel, model)
        .finally(() => ipcRenderer.removeListener('whisper:dlProgress', handler))
    },
    transcribe: (
      audioPath: string,
      model: string,
    ): Promise<any> =>
      ipcRenderer.invoke(IPC.whisperTranscribe, { audioPath, model }),
  },
  projects: {
    list: (): Promise<any[]> => ipcRenderer.invoke(IPC.projectList),
    get: (id: string): Promise<any | null> => ipcRenderer.invoke(IPC.projectGet, id),
    save: (input: any): Promise<any> => ipcRenderer.invoke(IPC.projectSave, input),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.projectDelete, id),
    importFile: (): Promise<any | null> => ipcRenderer.invoke(IPC.projectImport),
    exportFile: (id: string, name: string): Promise<{ ok: boolean; path?: string; canceled?: boolean }> =>
      ipcRenderer.invoke(IPC.projectExport, id, name),
  },
  llm: {
    /** 把粗糙想法润色成专业音色描述 */
    polishDescription: (idea: string): Promise<string> =>
      ipcRenderer.invoke(IPC.llmPolish, idea),
    /** 根据音色描述生成适配的合成文本 */
    generateSampleText: (description: string): Promise<string> =>
      ipcRenderer.invoke(IPC.llmSampleText, description),
    /** 用 AI 解析任意格式的剧本（时间+角色），比正则更可靠 */
    parseScript: (raw: string): Promise<any> =>
      ipcRenderer.invoke(IPC.llmParseScript, raw),
  },
  asr: {
    /** 语音转文字（mimo-v2.5-asr），传本地音频绝对路径 */
    transcribe: (filePath: string): Promise<AsrResponse> =>
      ipcRenderer.invoke(IPC.asrTranscribe, { path: filePath }),
  },
  styles: {
    list: (): Promise<StylePreset[]> => ipcRenderer.invoke(IPC.styleList),
    save: (
      input: Omit<StylePreset, 'id' | 'createdAt'> & { id?: string },
    ): Promise<StylePreset> => ipcRenderer.invoke(IPC.styleSave, input),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.styleRemove, id),
  },
}

contextBridge.exposeInMainWorld('vc', api)

export type VcApi = typeof api
