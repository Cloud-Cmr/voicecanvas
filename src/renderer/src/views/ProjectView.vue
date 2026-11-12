<script setup lang="ts">
/**
 * 项目工作区：把一次配音工作的台词集中管理
 *
 * 场景：给一部短片配 30 句台词——建个项目，逐句生成、逐句试听、
 * 全部完成后一键导出，下次打开项目还能继续。
 */
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { PRESET_VOICES } from '../../../shared/constants'
import type { VoiceAsset } from '../../../shared/types'

interface ProjectClip {
  id: string
  text: string
  voiceKey: string
  voiceLabel: string
  instruction?: string
  filePath?: string
  bytes?: number
  createdAt: number
}

interface Project {
  id: string
  name: string
  description?: string
  clips: ProjectClip[]
  createdAt: number
  updatedAt: number
  schema: 1
}

const emit = defineEmits<{ (e: 'need-key'): void }>()

const projects = ref<Array<{ id: string; name: string; clipCount: number; updatedAt: number }>>([])
const current = ref<Project | null>(null)
const loading = ref(false)
const generating = ref(false)
const genIdx = ref(-1)

// 新建项目
const newName = ref('')
const newDesc = ref('')

// 当前项目的输入区
const draftText = ref('')
const draftVoice = ref('p:mimo_default')
const draftInstruction = ref('')

const assets = ref<VoiceAsset[]>([])

onMounted(async () => {
  const s = await window.vc.settings.get()
  if (!s.hasApiKey) emit('need-key')
  assets.value = await window.vc.voices.list()
  await refreshList()
})

async function refreshList() {
  projects.value = (await window.vc.projects.list()) as any
}

const voiceOptions = computed(() => {
  const opts: Array<{ key: string; label: string; group: string }> = PRESET_VOICES.map((v) => ({
    key: `p:${v.id}`,
    label: v.label,
    group: '预置音色',
  }))
  for (const a of assets.value) {
    if (a.source === 'preset') continue
    opts.push({
      key: `a:${a.id}`,
      label: a.name,
      group: a.source === 'design' ? '设计音色' : '克隆音色',
    })
  }
  return opts
})

const groups = computed(() => {
  const g: Record<string, Array<{ key: string; label: string }>> = {}
  for (const o of voiceOptions.value) (g[o.group] ||= []).push(o)
  return g
})

function voiceLabelOf(key: string): string {
  return voiceOptions.value.find((o) => o.key === key)?.label || key
}

async function createProject() {
  const name = newName.value.trim() || '未命名项目'
  const p = await window.vc.projects.save({ name, description: newDesc.value.trim() || undefined })
  current.value = p
  newName.value = ''
  newDesc.value = ''
  await refreshList()
  ElMessage.success(`项目「${name}」已创建`)
}

async function openProject(id: string) {
  loading.value = true
  try {
    current.value = (await window.vc.projects.get(id)) as Project
  } finally {
    loading.value = false
  }
}

async function removeProject(id: string, name: string) {
  try {
    await ElMessageBox.confirm(`删除项目「${name}」？已生成的音频文件不会被删除。`, '确认删除', {
      type: 'warning',
    })
  } catch {
    return
  }
  await window.vc.projects.remove(id)
  if (current.value?.id === id) current.value = null
  await refreshList()
  ElMessage.success('已删除')
}

async function addClip() {
  if (!current.value) return
  const text = draftText.value.trim()
  if (!text) {
    ElMessage.warning('请输入台词')
    return
  }
  const p = await window.vc.projects.save({
    id: current.value.id,
    name: current.value.name,
    description: current.value.description,
    clips: [
      ...current.value.clips,
      {
        id: `tmp_${Date.now()}`,
        text,
        voiceKey: draftVoice.value,
        voiceLabel: voiceLabelOf(draftVoice.value),
        instruction: draftInstruction.value.trim() || undefined,
        createdAt: Date.now(),
      },
    ],
  })
  current.value = p
  draftText.value = ''
  await refreshList()
}

async function removeClip(idx: number) {
  if (!current.value) return
  const clips = current.value.clips.filter((_, i) => i !== idx)
  current.value = await window.vc.projects.save({
    id: current.value.id,
    name: current.value.name,
    description: current.value.description,
    clips,
  })
  await refreshList()
}

/** 生成单条台词 */
async function genClip(idx: number) {
  if (!current.value) return
  const clip = current.value.clips[idx]
  generating.value = true
  genIdx.value = idx
  try {
    let req: any
    if (clip.voiceKey.startsWith('p:')) {
      req = {
        mode: 'preset',
        text: clip.text,
        instruction: clip.instruction,
        voiceId: clip.voiceKey.slice(2),
        format: 'wav',
      }
    } else {
      const asset = assets.value.find((a) => a.id === clip.voiceKey.slice(2))
      if (!asset) throw new Error('音色不存在')
      req =
        asset.source === 'design'
          ? { mode: 'design', text: clip.text, designPrompt: asset.payload, format: 'wav' }
          : {
              mode: 'clone',
              text: clip.text,
              instruction: clip.instruction,
              samplePath: asset.samplePath,
              format: 'wav',
            }
    }
    const res = await window.vc.synth.run(req)
    if (res.ok) {
      const clips = [...current.value.clips]
      clips[idx] = { ...clips[idx], filePath: res.filePath, bytes: res.bytes }
      current.value = await window.vc.projects.save({
        id: current.value.id,
        name: current.value.name,
        description: current.value.description,
        clips,
      })
      ElMessage.success(`第 ${idx + 1} 条生成完成`)
    } else {
      ElMessage.error(res.message)
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '生成失败')
  } finally {
    generating.value = false
    genIdx.value = -1
  }
}

/** 依次生成所有未完成的台词 */
async function genAll() {
  if (!current.value) return
  const pending = current.value.clips
    .map((c, i) => ({ c, i }))
    .filter((x) => !x.c.filePath)
  if (!pending.length) {
    ElMessage.info('所有台词都已生成')
    return
  }
  for (const { i } of pending) {
    await genClip(i)
  }
  ElMessage.success('全部生成完成')
}

async function exportProject() {
  if (!current.value) return
  const res = await window.vc.projects.exportFile(current.value.id, current.value.name)
  if (res.ok) ElMessage.success(`项目已导出到 ${res.path}`)
}

async function importProject() {
  try {
    const p = await window.vc.projects.importFile()
    if (p) {
      await refreshList()
      current.value = p
      ElMessage.success(`已导入项目「${p.name}」`)
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '导入失败')
  }
}

const doneCount = computed(() => current.value?.clips.filter((c) => c.filePath).length ?? 0)
</script>

<template>
  <div class="vc-page project-page">
    <!-- 项目列表 -->
    <div v-if="!current" class="vc-card">
      <h3 class="vc-card-title">
        我的项目
        <span class="vc-spacer" />
        <el-button size="small" @click="importProject">导入项目</el-button>
      </h3>

      <div class="create-row">
        <el-input v-model="newName" placeholder="新项目名，例如：短片旁白 v1" style="max-width: 260px" />
        <el-input v-model="newDesc" placeholder="备注（可选）" style="max-width: 240px" />
        <el-button type="primary" @click="createProject">新建项目</el-button>
      </div>

      <div v-if="projects.length" class="project-list">
        <div v-for="p in projects" :key="p.id" class="project-row">
          <div class="project-main" @click="openProject(p.id)">
            <div class="project-name">{{ p.name }}</div>
            <div class="project-meta">
              {{ p.clipCount }} 条台词 · 更新于
              {{ new Date(p.updatedAt).toLocaleString('zh-CN') }}
            </div>
          </div>
          <el-button size="small" link @click="removeProject(p.id, p.name)">删除</el-button>
        </div>
      </div>
      <p v-else class="vc-hint">
        还没有项目。建一个项目可以把一次配音的所有台词集中管理，随时接着做。
      </p>
    </div>

    <!-- 项目详情 -->
    <template v-else>
      <div class="vc-card">
        <h3 class="vc-card-title">
          {{ current.name }}
          <span class="vc-num vc-muted">{{ doneCount }}/{{ current.clips.length }} 已完成</span>
          <span class="vc-spacer" />
          <el-button size="small" @click="exportProject">导出项目</el-button>
          <el-button size="small" :loading="generating" @click="genAll">全部生成</el-button>
          <el-button size="small" @click="current = null">返回列表</el-button>
        </h3>

        <!-- 添加台词 -->
        <div class="add-row">
          <el-input
            v-model="draftText"
            type="textarea"
            :rows="2"
            placeholder="输入一条台词，回车或点「添加」加入项目"
          />
          <div class="add-controls">
            <el-select v-model="draftVoice" filterable style="width: 240px" size="small">
              <el-option-group v-for="(opts, g) in groups" :key="g" :label="g">
                <el-option v-for="o in opts" :key="o.key" :value="o.key" :label="o.label" />
              </el-option-group>
            </el-select>
            <el-input
              v-model="draftInstruction"
              size="small"
              placeholder="风格指令（可选）"
              style="max-width: 200px"
            />
            <el-button size="small" type="primary" @click="addClip">添加</el-button>
          </div>
        </div>

        <!-- 台词列表 -->
        <div v-if="current.clips.length" class="clip-list">
          <div v-for="(c, i) in current.clips" :key="c.id" class="clip-row">
            <span class="clip-idx vc-num">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="clip-text" :title="c.text">{{ c.text }}</span>
            <span class="clip-voice">{{ c.voiceLabel }}</span>
            <span class="clip-status" :class="{ done: !!c.filePath }">
              {{ c.filePath ? `${((c.bytes || 0) / 1024).toFixed(0)}KB` : '未生成' }}
            </span>
            <audio
              v-if="c.filePath"
              :src="`vcmedia://local/${encodeURIComponent(c.filePath)}`"
              controls
              class="clip-audio"
            />
            <el-button
              size="small"
              link
              :loading="generating && genIdx === i"
              @click="genClip(i)"
            >
              {{ c.filePath ? '重生成' : '生成' }}
            </el-button>
            <el-button size="small" link @click="removeClip(i)">删除</el-button>
          </div>
        </div>
        <p v-else class="vc-hint">项目还没有台词，用上面的输入框添加第一条。</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.project-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.create-row {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.project-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.project-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--vc-radius-sm);
  border: 1px solid var(--vc-border);
  background: var(--vc-bg-input);
  transition: border-color var(--vc-dur-fast) var(--vc-ease);
}

.project-row:hover {
  border-color: var(--vc-border-strong);
}

.project-main {
  flex: 1;
  cursor: pointer;
  min-width: 0;
}

.project-name {
  font-size: 13.5px;
  font-weight: 600;
}

.project-meta {
  font-size: 11.5px;
  color: var(--vc-text-muted);
  margin-top: 2px;
}

.add-row {
  margin-bottom: 16px;
}

.add-controls {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.clip-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 480px;
  overflow-y: auto;
}

.clip-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: var(--vc-radius-xs);
  font-size: 12.5px;
}

.clip-row:hover {
  background: var(--vc-bg-hover);
}

.clip-idx {
  color: var(--vc-text-muted);
  width: 24px;
  flex-shrink: 0;
}

.clip-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clip-voice {
  font-size: 11.5px;
  color: var(--vc-text-secondary);
  width: 130px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clip-status {
  font-size: 11px;
  color: var(--vc-text-muted);
  width: 62px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.clip-status.done {
  color: var(--vc-scope);
}

.clip-audio {
  width: 200px;
  height: 30px;
  flex-shrink: 0;
}
</style>
