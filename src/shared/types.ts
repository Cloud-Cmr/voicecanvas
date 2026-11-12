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
  synthRunLong: 'synth:runLong',
  fileSave: 'file:save',
  fileOpenDialog: 'file:openDialog',
  fileReveal: 'file:reveal',
  fileReadText: 'file:readText',
  fileWriteText: 'file:writeText',
  voicesList: 'voices:list',
  voicesUpsert: 'voices:upsert',
  voicesRemove: 'voices:remove',
  historyList: 'history:list',
  historyRemove: 'history:remove',
  historyExport: 'history:export',
  batchRun: 'batch:run',
  batchCancel: 'batch:cancel',
  probeModels: 'probe:models',
  llmPolish: 'llm:polishDescription',
  llmSampleText: 'llm:generateSampleText',
  llmSplitText: 'llm:splitLongText',
  asrTranscribe: 'asr:transcribe',
  styleList: 'style:list',
  styleSave: 'style:save',
  styleRemove: 'style:remove',
  synthTimeline: 'synth:timeline',
  fileSaveRecorded: 'file:saveRecorded',
  audioProcess: 'audio:process',
  audioInfo: 'audio:info',
  timelineProgress: 'synth:timelineProgress',
} as const

/** 主进程 → 渲染进程的流式进度事件 */
export interface StreamProgressEvent {
  requestId: string
  receivedBytes: number
  elapsedMs: number
}

// ===== 批量合成 =====

/** 批量队列中的一条任务 */
export interface BatchTask {
  /** 客户端生成的唯一 ID */
  id: string
  /** 台词序号（从导入文件或手输顺序而来） */
  index: number
  /** 待合成文本 */
  text: string
  /** 音色 ID：预置音色 ID 或 VoiceAsset.id */
  voiceKey: string
  /** 音色显示名（用于结果列表） */
  voiceLabel: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  /** 失败原因 */
  error?: string
  /** 生成文件路径 */
  filePath?: string
  bytes?: number
  elapsedMs?: number
  /** 已重试次数 */
  attempts: number
}

/** 批量任务源 */
export interface BatchSource {
  kind: 'preset' | 'asset'
  /** preset 时为音色 ID；asset 时为 VoiceAsset.id */
  voiceKey: string
  label: string
  /** asset 时的克隆样本路径（主进程据此解析样本） */
  samplePath?: string
  /** asset 时的设计描述词 */
  designPrompt?: string
}

/** 批量运行配置 */
export interface BatchRunRequest {
  tasks: Array<Pick<BatchTask, 'id' | 'index' | 'text'>>
  source: BatchSource
  instruction?: string
  format: AudioFormat
  /** 并发数 1-3（官方限流，太高会 429） */
  concurrency: number
}

/** 批量进度事件（主进程 → 渲染进程） */
export interface BatchProgressEvent {
  /** 任务 ID */
  id: string
  status: BatchTask['status']
  error?: string
  filePath?: string
  bytes?: number
  elapsedMs?: number
  /** 已完成任务数 */
  doneCount: number
  total: number
}

/** 历史导出格式 */
export type ExportFormat = 'csv' | 'json'

// ===== 风格方案 =====

/** 一套「音色 + 风格指令」的组合，可命名保存、一键套用 */
export interface StylePreset {
  id: string
  name: string
  /** preset 音色 ID 或 asset:<uuid> */
  voiceKey: string
  voiceLabel: string
  instruction?: string
  /** 备注说明（可选） */
  note?: string
  createdAt: number
}

// ===== ASR 转写 =====

export interface AsrResponse {
  ok: boolean
  text?: string
  /** 音频时长（秒） */
  seconds?: number
  audioTokens?: number
  totalTokens?: number
  elapsedMs?: number
  code?: string
  message?: string
}

// ===== 时间戳配音 =====

/** 一条带时间戳的台词 */
export interface TimelineCue {
  /** 时间点 mm:ss 或 mm:ss.ms */
  time: string
  text: string
}

/** 时间戳配音请求 */
export interface TimelineRequest {
  cues: TimelineCue[]
  mode: 'preset'
  voiceId?: string
  instruction?: string
}

/** 时间轴进度事件 */
export interface TimelineProgressEvent {
  index: number
  total: number
  /** 该段合成后实际摆放的时间点（mm:ss） */
  placedAt?: string
  elapsedMs: number
}

export interface TimelineResponse {
  ok: boolean
  filePath?: string
  /** LRC 字幕文件路径 */
  lrcPath?: string
  durationMs?: number
  placedMs?: number[]
  code?: string
  message?: string
}
