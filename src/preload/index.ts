import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type {
  AppSettings,
  BatchProgressEvent,
  BatchRunRequest,
  BatchTask,
  GenerationRecord,
  SynthRequest,
  SynthResponse,
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
    /** 打开文本文件选择框（SRT/TXT 台词导入用），返回 {path,name} 或 null */
    openTextDialog: (): Promise<{ path: string; name: string } | null> =>
      ipcRenderer.invoke('file:openTextDialog'),
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
  llm: {
    /** 把粗糙想法润色成专业音色描述 */
    polishDescription: (idea: string): Promise<string> =>
      ipcRenderer.invoke(IPC.llmPolish, idea),
    /** 根据音色描述生成适配的合成文本 */
    generateSampleText: (description: string): Promise<string> =>
      ipcRenderer.invoke(IPC.llmSampleText, description),
  },
}

contextBridge.exposeInMainWorld('vc', api)

export type VcApi = typeof api
