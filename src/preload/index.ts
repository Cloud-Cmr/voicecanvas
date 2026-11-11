import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type {
  AppSettings,
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
  },
  probe: {
    models: (): Promise<{ ok: boolean; models?: string[]; message?: string }> =>
      ipcRenderer.invoke(IPC.probeModels),
  },
}

contextBridge.exposeInMainWorld('vc', api)

export type VcApi = typeof api
