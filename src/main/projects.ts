/**
 * 项目档案：把一次配音工作打包成一个可保存、可重开的工作区
 *
 * 结构：
 * - 项目名、创建/更新时间
 * - 台词条目（文本 + 音色 + 风格指令 + 生成结果路径）
 * - 关联的音色快照（避免音色被删后项目失效）
 *
 * 存成 .vcpj.json，可导出分享给协作者。
 */

import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export interface ProjectClip {
  id: string
  /** 台词文本 */
  text: string
  /** 音色标识：p:<id> 或 a:<uuid> */
  voiceKey: string
  /** 音色显示名（快照，音色被删也不丢信息） */
  voiceLabel: string
  instruction?: string
  /** 生成结果文件路径（可能为空，表示还没生成） */
  filePath?: string
  bytes?: number
  createdAt: number
}

export interface Project {
  id: string
  name: string
  description?: string
  clips: ProjectClip[]
  createdAt: number
  updatedAt: number
  /** 版本号，便于将来做迁移 */
  schema: 1
}

const DIR = () => path.join(app.getPath('userData'), 'projects')

async function ensureDir(): Promise<string> {
  const d = DIR()
  await fs.mkdir(d, { recursive: true })
  return d
}

function fileOf(id: string): string {
  return path.join(DIR(), `${id}.vcpj.json`)
}

export async function listProjects(): Promise<
  Array<Pick<Project, 'id' | 'name' | 'description' | 'createdAt' | 'updatedAt'> & { clipCount: number }>
> {
  await ensureDir()
  const files = (await fs.readdir(DIR())).filter((f) => f.endsWith('.vcpj.json'))
  const out = []
  for (const f of files) {
    try {
      const raw = await fs.readFile(path.join(DIR(), f), 'utf8')
      const p = JSON.parse(raw) as Project
      out.push({
        id: p.id,
        name: p.name,
        description: p.description,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        clipCount: p.clips?.length ?? 0,
      })
    } catch {
      /* 跳过损坏文件 */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getProject(id: string): Promise<Project | null> {
  try {
    const raw = await fs.readFile(fileOf(id), 'utf8')
    return JSON.parse(raw) as Project
  } catch {
    return null
  }
}

export async function saveProject(input: {
  id?: string
  name: string
  description?: string
  clips?: ProjectClip[]
}): Promise<Project> {
  await ensureDir()
  const now = Date.now()
  let project: Project
  if (input.id) {
    const existing = await getProject(input.id)
    project = {
      id: input.id,
      name: input.name,
      description: input.description,
      clips: input.clips ?? existing?.clips ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      schema: 1,
    }
  } else {
    project = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      clips: input.clips ?? [],
      createdAt: now,
      updatedAt: now,
      schema: 1,
    }
  }
  const tmp = `${fileOf(project.id)}.tmp`
  await fs.writeFile(tmp, JSON.stringify(project, null, 2), 'utf8')
  await fs.rename(tmp, fileOf(project.id))
  return project
}

export async function deleteProject(id: string): Promise<void> {
  try {
    await fs.unlink(fileOf(id))
  } catch {
    /* 不存在即忽略 */
  }
}

/** 导出项目为独立文件（用户选路径） */
export async function exportProjectFile(id: string, target: string): Promise<boolean> {
  const p = await getProject(id)
  if (!p) return false
  await fs.writeFile(target, JSON.stringify(p, null, 2), 'utf8')
  return true
}

/** 从外部文件导入项目 */
export async function importProjectFile(source: string): Promise<Project> {
  const raw = await fs.readFile(source, 'utf8')
  const parsed = JSON.parse(raw) as Project
  if (!parsed.name || !Array.isArray(parsed.clips)) {
    throw new Error('不是有效的项目文件')
  }
  // 导入时重新生成 id，避免覆盖已有项目
  return saveProject({
    name: `${parsed.name}（导入）`,
    description: parsed.description,
    clips: parsed.clips.map((c) => ({ ...c, id: randomUUID() })),
  })
}

/** 往项目里加一条台词 */
export async function addClip(
  projectId: string,
  clip: Omit<ProjectClip, 'id' | 'createdAt'>,
): Promise<Project | null> {
  const p = await getProject(projectId)
  if (!p) return null
  p.clips.push({ ...clip, id: randomUUID(), createdAt: Date.now() })
  return saveProject({ id: p.id, name: p.name, description: p.description, clips: p.clips })
}
