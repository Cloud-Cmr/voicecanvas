/**
 * 声绘 VoiceCanvas — 共享类型定义
 * 主进程 / preload / 渲染进程三端共用，任何改动都要三端同步。
 */

/** 支持的合成模式 */
export type TtsMode = 'preset' | 'design' | 'clone'

/** 音频输出格式 */
export type AudioFormat = 'wav' | 'mp3' | 'pcm16'

/** 单个 provider 的模型映射，全部可配置（官方会改模型 ID，禁止硬编码到业务逻辑里） */
export interface ModelMap {
  preset: string
  design: string
  clone: string
}

/** Provider 配置 */
export interface ProviderConfig {
  id: string
  label: string
  baseUrl: string
  models: ModelMap
  /** 预置音色列表（仅 preset 模式用） */
  presetVoices: PresetVoice[]
}

export interface PresetVoice {
  id: string
  label: string
  lang: 'zh' | 'en'
  gender: 'female' | 'male'
}

/** 音色来源 */
export type VoiceSource = 'preset' | 'design' | 'clone'

/** 本地音色资产（用户保存的"我的音色"） */
export interface VoiceAsset {
  id: string
  name: string
  source: VoiceSource
  /** preset 模式存 voiceId；design 存描述词 */
  payload: string
  /** clone 模式存样本音频的绝对路径 */
  samplePath?: string
  sampleName?: string
  sampleBytes?: number
  /** design 模式的原始描述，便于二次编辑 */
  description?: string
  note?: string
  createdAt: number
  updatedAt: number
}

/** 一次合成请求（渲染进程 → 主进程） */
export interface SynthRequest {
  mode: TtsMode
  /** 要合成的正文，会放进 assistant 消息 */
  text: string
  /** 风格指令，会放进 user 消息 */
  instruction?: string
  /** preset 用音色 ID */
  voiceId?: string
  /** design 用音色描述（此时 user 消息即描述） */
  designPrompt?: string
  /** clone 用样本文件绝对路径 */
  samplePath?: string
  format: AudioFormat
  /** 仅 design 模式有效 */
  optimizeTextPreview?: boolean
  stream?: boolean
}

/** 合成结果 */
export interface SynthResult {
  ok: true
  /** 落盘后的音频绝对路径 */
  filePath: string
  bytes: number
  /** 服务端返回的润色后文本（optimize_text_preview 为 true 时才有） */
  finalTextPreview?: string
  usage?: TokenUsage
  /** 端到端耗时 */
  elapsedMs: number
  /** 首字节耗时（流式时有意义） */
  firstByteMs?: number
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface SynthFailure {
  ok: false
  code: string
  message: string
  /** 原始响应，便于排查 */
  detail?: string
}

export type SynthResponse = SynthResult | SynthFailure

/** 生成历史记录 */
export interface GenerationRecord {
  id: string
  mode: TtsMode
  text: string
  instruction?: string
  voiceName?: string
  filePath: string
  bytes: number
  durationMs?: number
  format: AudioFormat
  usage?: TokenUsage
  createdAt: number
}

/** 应用设置 */
export interface AppSettings {
  providerId: string
  baseUrl: string
  models: ModelMap
  defaultFormat: AudioFormat
  outputDir: string
  /** 是否已保存过 key（不回传明文） */
  hasApiKey: boolean
}

/** IPC 通道名集中定义，避免字符串写错 */
export const IPC = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  apiKeySet: 'apikey:set',
  apiKeyTest: 'apikey:test',
  synthRun: 'synth:run',
  synthCancel: 'synth:cancel',
  fileSave: 'file:save',
  fileOpenDialog: 'file:openDialog',
  fileReveal: 'file:reveal',
  voicesList: 'voices:list',
  voicesUpsert: 'voices:upsert',
  voicesRemove: 'voices:remove',
  historyList: 'history:list',
  historyRemove: 'history:remove',
  probeModels: 'probe:models',
} as const

/** 主进程 → 渲染进程的流式进度事件 */
export interface StreamProgressEvent {
  requestId: string
  receivedBytes: number
  elapsedMs: number
}
