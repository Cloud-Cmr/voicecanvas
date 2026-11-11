/**
 * 三端共用的常量。
 * 模型 ID 与音色 ID 集中在此，主进程和渲染进程都从这里取，避免两处不一致。
 */
import type { ModelMap, PresetVoice } from './types'

export const DEFAULT_BASE_URL = 'https://api.xiaomimimo.com/v1'

/** 官方会改模型版本号，默认值仅作兜底，实际以设置页为准 */
export const DEFAULT_MODELS: ModelMap = {
  preset: 'mimo-v2.5-tts',
  design: 'mimo-v2.5-tts-voicedesign',
  clone: 'mimo-v2.5-tts-voiceclone',
}

/** 预置音色：中文音色 ID 就是 "冰糖" 这类中文，不要转拼音 */
export const PRESET_VOICES: PresetVoice[] = [
  { id: 'mimo_default', label: 'MiMo-默认（冰糖）', lang: 'zh', gender: 'female' },
  { id: '冰糖', label: '冰糖 · 女声', lang: 'zh', gender: 'female' },
  { id: '茉莉', label: '茉莉 · 女声', lang: 'zh', gender: 'female' },
  { id: '苏打', label: '苏打 · 男声', lang: 'zh', gender: 'male' },
  { id: '白桦', label: '白桦 · 男声', lang: 'zh', gender: 'male' },
  { id: 'Mia', label: 'Mia · 英文女声', lang: 'en', gender: 'female' },
  { id: 'Chloe', label: 'Chloe · 英文女声', lang: 'en', gender: 'female' },
  { id: 'Milo', label: 'Milo · 英文男声', lang: 'en', gender: 'male' },
  { id: 'Dean', label: 'Dean · 英文男声', lang: 'en', gender: 'male' },
]

/**
 * 音色克隆样本上限。
 * 服务端限制 base64 后 10MB，base64 膨胀约 33%，所以原文件安全线取 7.5MB。
 */
export const CLONE_SAMPLE_MAX_BYTES = Math.floor(7.5 * 1024 * 1024)

/** 各模式能力矩阵，UI 用来禁用不支持的选项 */
export const CAPABILITIES = {
  preset: { streaming: true, singing: true, voice: true, describe: false },
  design: { streaming: false, singing: false, voice: false, describe: true },
  clone: { streaming: false, singing: false, voice: true, describe: false },
} as const
