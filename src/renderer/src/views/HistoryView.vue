<script setup lang="ts">
/**
 * 生成历史：按时间倒序列出最近 500 条生成记录。
 *
 * 记录里的 filePath 指向落盘的真实文件，所以这里只做三件事：
 * 播一下、去文件夹看看、从列表里删掉。
 * 「删除」只删记录不动文件——用户可能已经把音频另存/移动，静默删文件风险太大。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { GenerationRecord, TtsMode } from '../../../shared/types'
import { MODE_META } from '../composables/useSynth'
import { formatBytes } from '../composables/usePlayer'
import AudioPlayer from '../components/AudioPlayer.vue'

interface ModeFilter {
  value: 'all' | TtsMode
  label: string
}

const filters: ModeFilter[] = [
  { value: 'all', label: '全部' },
  { value: 'preset', label: '预置音色' },
  { value: 'design', label: '音色设计' },
  { value: 'clone', label: '音色克隆' },
]

const records = ref<GenerationRecord[]>([])
const loading = ref(true)
const activeFilter = ref<'all' | TtsMode>('all')
const keyword = ref('')
const clearing = ref(false)

/** 当前正在试听的记录，null 表示没有展开的播放器 */
const playingRecord = ref<GenerationRecord | null>(null)

const filtered = computed<GenerationRecord[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  return records.value.filter((r) => {
    if (activeFilter.value !== 'all' && r.mode !== activeFilter.value) return false
    if (!kw) return true
    const haystack = [r.text, r.instruction ?? '', r.voiceName ?? '', r.filePath]
      .join(' ')
      .toLowerCase()
    return haystack.includes(kw)
  })
})

const counts = computed(() => {
  const base: Record<'all' | TtsMode, number> = {
    all: records.value.length,
    preset: 0,
    design: 0,
    clone: 0,
  }
  for (const r of records.value) base[r.mode] += 1
  return base
})

const totalBytes = computed(() => records.value.reduce((n, r) => n + (r.bytes || 0), 0))

/** IPC 抛出的错误不保证是 Error 实例，统一转成可读文案 */
function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

async function load(): Promise<void> {
  loading.value = true
  try {
    records.value = await window.vc.history.list()
    // 列表刷新后，若正在播的那条被删掉了就收起播放器
    if (playingRecord.value) {
      const still = records.value.find((r) => r.id === playingRecord.value?.id)
      playingRecord.value = still ?? null
    }
  } catch (e) {
    ElMessage.error(`读取历史失败：${errText(e)}`)
  } finally {
    loading.value = false
  }
}

/* ---------------- 展示辅助 ---------------- */

function formatDateTime(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 表格里只放 60 字以内的摘要，完整正文放到 tooltip 里 */
function summarize(text: string): string {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  if (!t) return '（未填写正文）'
  return t.length > 60 ? `${t.slice(0, 60)}…` : t
}

function modeLabel(mode: TtsMode): string {
  return MODE_META[mode].label
}

function modeTag(mode: TtsMode): string {
  return MODE_META[mode].tag
}

function voiceText(r: GenerationRecord): string {
  if (r.voiceName) return r.voiceName
  return r.mode === 'design' ? '自定义设计' : '—'
}

/* ---------------- 行操作 ---------------- */

function togglePlay(r: GenerationRecord): void {
  if (playingRecord.value?.id === r.id) {
    playingRecord.value = null
    return
  }
  playingRecord.value = r
}

async function reveal(r: GenerationRecord): Promise<void> {
  try {
    await window.vc.file.reveal(r.filePath)
  } catch (e) {
    ElMessage.error(`打开位置失败：${errText(e)}。文件可能已被移动或删除。`)
  }
}

async function removeOne(r: GenerationRecord): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定要删除这条记录吗？只删除列表记录，磁盘上的音频文件不会被删除。`,
      '删除记录',
      {
        type: 'warning',
        confirmButtonText: '删除记录',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }
  try {
    await window.vc.history.remove(r.id)
    if (playingRecord.value?.id === r.id) playingRecord.value = null
    ElMessage.success('已删除记录')
    await load()
  } catch (e) {
    ElMessage.error(`删除失败：${errText(e)}`)
  }
}

async function clearAll(): Promise<void> {
  if (!records.value.length) {
    ElMessage.info('当前没有历史记录')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定要清空全部 ${records.value.length} 条历史记录吗？此操作不可撤销。` +
        '磁盘上的音频文件不会被删除，只是不再出现在这里。',
      '清空历史',
      {
        type: 'warning',
        confirmButtonText: '全部清空',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }
  clearing.value = true
  try {
    // 主进程没有批量删除接口，逐条删（最多 500 条，串行够快且不并发压垮 IPC）
    for (const r of records.value) {
      await window.vc.history.remove(r.id)
    }
    playingRecord.value = null
    ElMessage.success('历史已清空')
    await load()
  } catch (e) {
    ElMessage.error(`清空失败：${errText(e)}`)
    await load()
  } finally {
    clearing.value = false
  }
}

function resetFilters(): void {
  keyword.value = ''
  activeFilter.value = 'all'
}

function rowClassName({ row }: { row: GenerationRecord }): string {
  return playingRecord.value?.id === row.id ? 'row-playing' : ''
}

onMounted(load)
</script>

<template>
  <div class="vc-page history-page">
    <!-- 顶部工具条 -->
    <div class="toolbar">
      <el-radio-group v-model="activeFilter" size="small">
        <el-radio-button v-for="f in filters" :key="f.value" :value="f.value">
          {{ f.label }}（{{ counts[f.value] }}）
        </el-radio-button>
      </el-radio-group>
      <el-input
        v-model="keyword"
        class="search"
        size="small"
        placeholder="搜索正文、指令或音色名"
        clearable
      />
      <span class="vc-spacer" />
      <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      <el-button
        size="small"
        type="danger"
        plain
        :loading="clearing"
        :disabled="!records.length"
        @click="clearAll"
      >
        清空全部
      </el-button>
    </div>

    <p class="vc-hint summary">
      共 {{ records.length }} 条记录，占用 {{ formatBytes(totalBytes) }}。记录会保留最近
      500 条，超出的旧记录自动淘汰（音频文件仍在磁盘上）。
    </p>

    <!-- 播放器（点行内「播放」后展开） -->
    <div v-if="playingRecord" class="vc-card player-card">
      <AudioPlayer
        :key="playingRecord.id"
        :file-path="playingRecord.filePath"
        :bytes="playingRecord.bytes"
        :title="`${modeLabel(playingRecord.mode)} · ${voiceText(playingRecord)}`"
        :meta="`${formatDateTime(playingRecord.createdAt)} · ${summarize(playingRecord.text)}`"
      />
      <div class="player-close">
        <el-button size="small" link @click="playingRecord = null">收起播放器</el-button>
      </div>
    </div>

    <!-- 表格 -->
    <div v-if="loading" class="vc-muted loading">加载历史记录…</div>

    <el-empty
      v-else-if="!records.length"
      description="还没有生成记录。到「语音合成」页生成第一段音频，记录会自动出现在这里。"
    />

    <el-empty
      v-else-if="!filtered.length"
      description="没有匹配的记录。试试换个关键词或筛选条件。"
    >
      <el-button size="small" @click="resetFilters">清除筛选条件</el-button>
    </el-empty>

    <el-table
      v-else
      :data="filtered"
      class="history-table"
      size="small"
      :row-class-name="rowClassName"
      empty-text="暂无数据"
    >
      <el-table-column label="时间" width="112">
        <template #default="{ row }">
          <span class="vc-mono time-cell">{{ formatDateTime(row.createdAt) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="模式" width="102">
        <template #default="{ row }">
          <span :class="modeTag(row.mode)">{{ modeLabel(row.mode) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="音色" width="150" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="cell-text">{{ voiceText(row) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="文本摘要" min-width="240">
        <template #default="{ row }">
          <span class="cell-text" :title="row.text">{{ summarize(row.text) }}</span>
          <div v-if="row.instruction" class="instruction" :title="row.instruction">
            指令：{{ row.instruction }}
          </div>
        </template>
      </el-table-column>

      <el-table-column label="格式" width="72">
        <template #default="{ row }">
          <span class="vc-mono fmt">{{ String(row.format).toUpperCase() }}</span>
        </template>
      </el-table-column>

      <el-table-column label="大小" width="92">
        <template #default="{ row }">
          <span class="vc-mono">{{ formatBytes(row.bytes) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="Token" width="82">
        <template #default="{ row }">
          <span class="vc-mono">{{ row.usage ? row.usage.totalTokens : '—' }}</span>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="188" fixed="right">
        <template #default="{ row }">
          <div class="row-actions">
            <el-button size="small" link type="primary" @click="togglePlay(row)">
              {{ playingRecord?.id === row.id ? '收起' : '播放' }}
            </el-button>
            <el-button size="small" link @click="reveal(row)">打开位置</el-button>
            <el-button size="small" link type="danger" @click="removeOne(row)">
              删除
            </el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.history-page {
  display: flex;
  flex-direction: column;
  gap: var(--vc-gap-md);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.search {
  width: 240px;
}

.summary {
  margin: 0;
}

.loading {
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
}

.player-card {
  position: sticky;
  top: 0;
  z-index: 5;
  border-color: color-mix(in srgb, var(--vc-accent) 30%, var(--vc-border));
  box-shadow: var(--vc-shadow-md);
}

.player-close {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.history-table {
  width: 100%;
}

.time-cell {
  font-size: 11.5px;
  color: var(--vc-text-secondary);
}

.fmt {
  font-size: 11.5px;
  color: var(--vc-text-secondary);
}

.cell-text {
  font-size: 12.5px;
  word-break: break-word;
}

.instruction {
  font-size: 11px;
  color: var(--vc-text-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: nowrap;
}

:deep(.row-playing) > td {
  background: var(--vc-accent-soft) !important;
}
</style>
