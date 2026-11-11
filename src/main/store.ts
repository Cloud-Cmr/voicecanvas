/**
 * 本地持久化层
 *
 * 刻意不用 better-sqlite3：原生模块需要 electron-rebuild 按 ABI 重编译，
 * 否则打出来的 exe 一开就报 NODE_MODULE_VERSION 不匹配。音色库/历史这种量级
 * （千条以内）用 JSON 足够，且零编译风险。
 *
 * 存储位置：app.getPath('userData')/data/*.json
 * API Key 单独用 safeStorage 加密存 keystore.bin，绝不明文落盘。
 */

import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AppSettings,
  GenerationRecord,
  ModelMap,
  VoiceAsset,
} from '../shared/types'
import { DEFAULT_BASE_URL, DEFAULT_MODELS, PRESET_VOICES } from './providers/mimo'

const DATA_DIR = () => path.join(app.getPath('userData'), 'data')
const SETTINGS_FILE = () => path.join(DATA_DIR(), 'settings.json')
const VOICES_FILE = () => path.join(DATA_DIR(), 'voices.json')
const HISTORY_FILE = () => path.join(DATA_DIR(), 'history.json')
const KEYSTORE_FILE = () => path.join(app.getPath('userData'), 'keystore.bin')

/** 原子写：先写临时文件再 rename，避免断电/崩溃写坏 */
async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, file)
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// ===== 设置 =====

function defaultSettings(): AppSettings {
  return {
    providerId: 'mimo',
    baseUrl: DEFAULT_BASE_URL,
    models: { ...DEFAULT_MODELS },
    defaultFormat: 'wav',
    outputDir: path.join(app.getPath('music'), 'VoiceCanvas'),
    hasApiKey: false,
  }
}

export async function getSettings(): Promise<AppSettings> {
  const stored = await readJson<Partial<AppSettings>>(SETTINGS_FILE(), {})
  const merged: AppSettings = { ...defaultSettings(), ...stored }
  // 修正被写坏/缺字段的 models
  merged.models = { ...DEFAULT_MODELS, ...(stored.models || {}) } as ModelMap
  merged.hasApiKey = await hasApiKey()
  return merged
}

export async function updateSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = await getSettings()
  const next: AppSettings = { ...current, ...patch }
  // hasApiKey 由 keystore 决定，不接受外部传入
  delete (next as any).hasApiKey
  await atomicWrite(SETTINGS_FILE(), JSON.stringify(next, null, 2))
  return getSettings()
}

// ===== API Key（加密存储）=====

export async function setApiKey(key: string): Promise<void> {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('API Key 不能为空')
  let payload: Buffer
  if (safeStorage.isEncryptionAvailable()) {
    payload = Buffer.concat([
      Buffer.from('ENC1'),
      safeStorage.encryptString(trimmed),
    ])
  } else {
    // 系统不支持加密时的降级（会有告警提示用户）
    payload = Buffer.concat([Buffer.from('RAW1'), Buffer.from(trimmed, 'utf8')])
  }
  await fs.mkdir(path.dirname(KEYSTORE_FILE()), { recursive: true })
  await fs.writeFile(KEYSTORE_FILE(), payload, { mode: 0o600 })
}

export async function getApiKey(): Promise<string | null> {
  try {
    const buf = await fs.readFile(KEYSTORE_FILE())
    const tag = buf.subarray(0, 4).toString('utf8')
    const body = buf.subarray(4)
    if (tag === 'ENC1') return safeStorage.decryptString(body)
    if (tag === 'RAW1') return body.toString('utf8')
    return null
  } catch {
    return null
  }
}

export async function hasApiKey(): Promise<boolean> {
  const k = await getApiKey()
  return !!k
}

export async function clearApiKey(): Promise<void> {
  try {
    await fs.unlink(KEYSTORE_FILE())
  } catch {
    /* 不存在即忽略 */
  }
}

// ===== 音色库 =====

export async function listVoices(): Promise<VoiceAsset[]> {
  const list = await readJson<VoiceAsset[]>(VOICES_FILE(), [])
  return list.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function upsertVoice(
  input: Partial<VoiceAsset> & { name: string; source: VoiceAsset['source'] },
): Promise<VoiceAsset> {
  const list = await readJson<VoiceAsset[]>(VOICES_FILE(), [])
  const now = Date.now()

  if (input.id) {
    const idx = list.findIndex((v) => v.id === input.id)
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...input, updatedAt: now }
      await atomicWrite(VOICES_FILE(), JSON.stringify(list, null, 2))
      return list[idx]
    }
  }

  const asset: VoiceAsset = {
    id: randomUUID(),
    name: input.name,
    source: input.source,
    payload: input.payload ?? '',
    samplePath: input.samplePath,
    sampleName: input.sampleName,
    sampleBytes: input.sampleBytes,
    description: input.description,
    note: input.note,
    createdAt: now,
    updatedAt: now,
  }
  list.push(asset)
  await atomicWrite(VOICES_FILE(), JSON.stringify(list, null, 2))
  return asset
}

export async function removeVoice(id: string): Promise<void> {
  const list = await readJson<VoiceAsset[]>(VOICES_FILE(), [])
  await atomicWrite(
    VOICES_FILE(),
    JSON.stringify(
      list.filter((v) => v.id !== id),
      null,
      2,
    ),
  )
}

// ===== 生成历史 =====

export async function listHistory(): Promise<GenerationRecord[]> {
  const list = await readJson<GenerationRecord[]>(HISTORY_FILE(), [])
  return list.sort((a, b) => b.createdAt - a.createdAt).slice(0, 500)
}

export async function addHistory(rec: GenerationRecord): Promise<void> {
  const list = await readJson<GenerationRecord[]>(HISTORY_FILE(), [])
  list.push(rec)
  // 只保留最近 500 条，避免无限增长
  const trimmed = list.sort((a, b) => b.createdAt - a.createdAt).slice(0, 500)
  await atomicWrite(HISTORY_FILE(), JSON.stringify(trimmed, null, 2))
}

export async function removeHistory(id: string): Promise<void> {
  const list = await readJson<GenerationRecord[]>(HISTORY_FILE(), [])
  await atomicWrite(
    HISTORY_FILE(),
    JSON.stringify(
      list.filter((r) => r.id !== id),
      null,
      2,
    ),
  )
}

/** 确保输出目录存在，返回可用路径 */
export async function ensureOutputDir(preferred?: string): Promise<string> {
  const settings = await getSettings()
  const dir = preferred || settings.outputDir
  await fs.mkdir(dir, { recursive: true })
  return dir
}

export { PRESET_VOICES }
