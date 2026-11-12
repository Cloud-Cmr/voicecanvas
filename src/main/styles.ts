/**
 * 风格方案持久化：一套「音色 + 风格指令」组合存成方案，
 * 下次一键套用。存 settings.json 旁边的 styles.json。
 */

import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { StylePreset } from '../shared/types'

const FILE = () => path.join(app.getPath('userData'), 'data', 'styles.json')

async function readAll(): Promise<StylePreset[]> {
  try {
    const raw = await fs.readFile(FILE(), 'utf8')
    return JSON.parse(raw) as StylePreset[]
  } catch {
    return []
  }
}

async function writeAll(list: StylePreset[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE()), { recursive: true })
  const tmp = `${FILE()}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf8')
  await fs.rename(tmp, FILE())
}

export async function listStyles(): Promise<StylePreset[]> {
  const list = await readAll()
  return list.sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveStyle(
  input: Omit<StylePreset, 'id' | 'createdAt'> & { id?: string },
): Promise<StylePreset> {
  const list = await readAll()
  const now = Date.now()
  if (input.id) {
    const idx = list.findIndex((s) => s.id === input.id)
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...input, id: input.id }
      await writeAll(list)
      return list[idx]
    }
  }
  const preset: StylePreset = {
    id: randomUUID(),
    name: input.name,
    voiceKey: input.voiceKey,
    voiceLabel: input.voiceLabel,
    instruction: input.instruction,
    note: input.note,
    createdAt: now,
  }
  list.push(preset)
  await writeAll(list)
  return preset
}

export async function removeStyle(id: string): Promise<void> {
  const list = await readAll()
  await writeAll(list.filter((s) => s.id !== id))
}
