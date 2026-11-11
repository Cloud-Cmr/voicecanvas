<script setup lang="ts">
/**
 * 批量合成工作台
 *
 * 三步流程：选音色 → 灌台词（粘贴 / 导入 SRT·TXT）→ 运行队列。
 * 相对官方网页 Studio 的最大差异点：一次跑完一整份台词/字幕。
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type {
  AudioFormat,
  BatchProgressEvent,
  BatchRunRequest,
  BatchTask,
  VoiceAsset,
} from '../../../shared/types'
import { PRESET_VOICES } from '../../../shared/constants'

const emit = defineEmits<{ (e: 'need-key'): void }>()

// ===== 音色选择 =====
interface VoiceOption {
  key: string          // preset:音色ID 或 asset:UUID
  label: string
  group: '预置音色' | '我的音色'
}

const voiceOptions = ref<VoiceOption[]>([])
const selectedVoice = ref<string>('')
const instruction = ref('')
const format = ref<AudioFormat>('wav')
const concurrency = ref(1)

async function loadVoices() {
  const assets: VoiceAsset[] = await window.vc.voices.list()
  const opts: VoiceOption[] = PRESET_VOICES.map((v) => ({
    key: `preset:${v.id}`,
    label: v.label,
    group: '预置音色' as const,
  }))
  for (const a of assets) {
    if (a.source === 'preset') continue
    opts.push({
      key: `asset:${a.id}`,
      label: `${a.name}（${a.source === 'design' ? '设计' : '克隆'}）`,
      group: '我的音色',
    })
  }
  voiceOptions.value = opts
  if (!selectedVoice.value && opts.length) {
    selectedVoice.value = opts[0].key
  }
}

const grouped = computed(() => {
  const g: Record<string, VoiceOption[]> = {}
  for (const o of voiceOptions.value) (g[o.group] ||= []).push(o)
  return g
})

// ===== 台词编辑 =====
const rawText = ref('')
const lines = computed(() =>
  rawText.value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean),
)

const importing = ref(false)
async function importDialogue() {
  importing.value = true
  try {
    const picked = await window.vc.file.openTextDialog()
    if (!picked) return
    const content = await window.vc.file.readText(picked.path)
    const ext = picked.path.toLowerCase().split('.').pop()
    const parsed =
      ext === 'srt'
        ? parseSrtLocal(content)
        : ext === 'lrc'
          ? parseLrcLocal(content)
          : parseTxtLocal(content)
    if (!parsed.length) {
      ElMessage.warning('文件里没有解析到可用的台词')
      return
    }
    rawText.value = parsed.join('\n')
    ElMessage.success(`已导入 ${parsed.length} 条台词（来源：${picked.name}）`)
  } catch (e: any) {
    ElMessage.error(e?.message || '导入失败')
  } finally {
    importing.value = false
  }
}

/** 本地解析（与主进程 parseSrt 同规则的渲染端副本，仅用于预览计数） */
function parseSrtLocal(content: string): string[] {
  return content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) =>
      b
        .split('\n')
        .filter((l) => !/^\d+$/.test(l.trim()) && !l.includes('-->'))
        .join(' ')
        .replace(/<[^>]+>/g, '')
        .trim(),
    )
    .filter(Boolean)
}

function parseLrcLocal(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.replace(/^\[[^\]]*\]\s*/, '').trim())
    .filter(Boolean)
}

function parseTxtLocal(content: string): string[] {
  return content.split('\n').map((l) => l.trim()).filter(Boolean)
}

const totalChars = computed(() => lines.value.reduce((n, l) => n + l.length, 0))

// 中文语速约 4 字/秒，粗估时长给用户预期
const estimateSec = computed(() => Math.round(totalChars.value / 4))

// ===== 运行 =====
const running = ref(false)
const tasks = ref<BatchTask[]>([])
const jobId = ref('')
const doneCount = ref(0)

let offProgress: (() => void) | null = null

const progressPct = computed(() =>
  tasks.value.length ? Math.round((doneCount.value / tasks.value.length) * 100) : 0,
)

const failedCount = computed(() => tasks.value.filter((t) => t.status === 'failed').length)

onMounted(async () => {
  await loadVoices()
  const s = await window.vc.settings.get()
  if (!s.hasApiKey) emit('need-key')
  offProgress = window.vc.batch.onProgress((e: BatchProgressEvent) => {
    const t = tasks.value.find((x) => x.id === e.id)
    if (t) {
      t.status = e.status
      t.error = e.error
      t.filePath = e.filePath
      t.bytes = e.bytes
      t.elapsedMs = e.elapsedMs
    }
    doneCount.value = e.doneCount
  })
})

onBeforeUnmount(() => offProgress?.())

async function run() {
  if (!lines.value.length) {
    ElMessage.warning('请先粘贴或导入台词，每行一条')
    return
  }
  if (!selectedVoice.value) {
    ElMessage.warning('请先选择音色')
    return
  }
  running.value = true
  tasks.value = lines.value.map((text, i) => ({
    id: `t${Date.now()}_${i}`,
    index: i + 1,
    text,
    voiceKey: selectedVoice.value,
    voiceLabel: voiceOptions.value.find((v) => v.key === selectedVoice.value)?.label || '',
    status: 'pending',
    attempts: 0,
  }))
  doneCount.value = 0

  try {
    const req: BatchRunRequest = {
      tasks: tasks.value.map((t) => ({ id: t.id, index: t.index, text: t.text })),
      source: {
        kind: selectedVoice.value.startsWith('asset:') ? 'asset' : 'preset',
        voiceKey: selectedVoice.value.slice(selectedVoice.value.indexOf(':') + 1),
        label: voiceOptions.value.find((v) => v.key === selectedVoice.value)?.label || '',
      },
      instruction: instruction.value.trim() || undefined,
      format: format.value,
      concurrency: concurrency.value,
    }
    const res = await window.vc.batch.run(req)
    jobId.value = res.jobId
    const failed = res.tasks.filter((t) => t.status === 'failed').length
    if (failed) ElMessage.warning(`完成，${failed} 条失败（可查看错误后重跑）`)
    else ElMessage.success(`全部完成，共 ${res.tasks.length} 条`)
  } catch (e: any) {
    ElMessage.error(e?.message || '批量任务失败')
  } finally {
    running.value = false
  }
}

async function cancel() {
  try {
    await ElMessageBox.confirm('确定取消剩余任务吗？已生成的音频会保留。', '取消批量', {
      type: 'warning',
    })
  } catch {
    return
  }
  await window.vc.batch.cancel(jobId.value)
}

const STATUS_META: Record<BatchTask['status'], { label: string; cls: string }> = {
  pending: { label: '等待', cls: 'st-pending' },
  running: { label: '合成中', cls: 'st-running' },
  done: { label: '完成', cls: 'st-done' },
  failed: { label: '失败', cls: 'st-failed' },
  skipped: { label: '跳过', cls: 'st-skipped' },
}

function fmtBytes(n?: number) {
  if (!n) return ''
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

function reveal(p: string) {
  void window.vc.file.reveal(p)
}

// 导入功能依赖 preload 的 openTextDialog，在下一版加；当前版本先提供粘贴区
watch(rawText, (v) => {
  if (v.length > 200000) ElMessage.warning('文本过长，建议分批（单批 ≤ 200k 字符）')
})
</script>

<template>
  <div class="vc-page batch-page">
    <div class="batch-grid">
      <!-- 左：台词 -->
      <section class="vc-card left">
        <h3 class="vc-card-title">台词 / 字幕文本</h3>
        <el-input
          v-model="rawText"
          type="textarea"
          :autosize="{ minRows: 16, maxRows: 26 }"
          placeholder="每行一条台词。也可以点上方「导入 SRT / TXT」自动解析。"
        />
        <div class="stats">
          <span class="vc-num">{{ lines.length }} 条</span>
          <span class="vc-muted">·</span>
          <span class="vc-num">{{ totalChars }} 字</span>
          <span class="vc-muted">·</span>
          <span>预计 <span class="vc-num">≈{{ Math.floor(estimateSec / 60) }} 分 {{ estimateSec % 60 }} 秒</span> 音频</span>
          <span class="vc-spacer" />
          <el-button size="small" :loading="importing" @click="importDialogue">
            导入 SRT / TXT
          </el-button>
          <el-button size="small" :disabled="!rawText" @click="rawText = ''">清空</el-button>
        </div>
      </section>

      <!-- 右：参数 -->
      <section class="vc-card right">
        <h3 class="vc-card-title">批量参数</h3>

        <label class="vc-label">音色（整个队列共用）</label>
        <el-select v-model="selectedVoice" filterable class="full">
          <el-option-group v-for="(opts, g) in grouped" :key="g" :label="g">
            <el-option v-for="o in opts" :key="o.key" :value="o.key" :label="o.label" />
          </el-option-group>
        </el-select>

        <label class="vc-label">统一风格指令（可选，全部台词生效）</label>
        <el-input v-model="instruction" placeholder="例：语速稍慢，温柔一些" />

        <div class="two-col">
          <div>
            <label class="vc-label">输出格式</label>
            <el-radio-group v-model="format" size="small">
              <el-radio-button value="wav">WAV</el-radio-button>
              <el-radio-button value="mp3">MP3</el-radio-button>
            </el-radio-group>
          </div>
          <div>
            <label class="vc-label">并发数</label>
            <el-select v-model="concurrency" size="small" class="full">
              <el-option :value="1" label="1（稳妥，防限流）" />
              <el-option :value="2" label="2（较快）" />
              <el-option :value="3" label="3（激进）" />
            </el-select>
          </div>
        </div>

        <p class="vc-hint">
          批量使用与单条相同的接口；失败的任务会自动重试一次。生成的文件按
          <code>batch_日期_序号</code> 命名，与单条合成一样进入「生成历史」。
        </p>

        <div class="vc-divider" />

        <div class="run-row">
          <el-button
            type="primary"
            size="large"
            :loading="running"
            :disabled="!lines.length || !selectedVoice"
            @click="run"
          >
            {{ running ? `合成中 ${doneCount}/${tasks.length}` : `开始批量合成（${lines.length} 条）` }}
          </el-button>
          <el-button v-if="running" @click="cancel">取消</el-button>
        </div>
      </section>
    </div>

    <!-- 队列进度 -->
    <section v-if="tasks.length" class="vc-card queue">
      <h3 class="vc-card-title">
        队列进度
        <span class="vc-num vc-muted">{{ doneCount }}/{{ tasks.length }}</span>
        <span v-if="failedCount" class="vc-tag vc-tag-warn">失败 {{ failedCount }}</span>
      </h3>
      <el-progress :percentage="progressPct" :stroke-width="8" />

      <div class="task-list">
        <div v-for="t in tasks" :key="t.id" class="task-row">
          <span class="t-idx vc-num">{{ String(t.index).padStart(2, '0') }}</span>
          <span class="t-status" :class="STATUS_META[t.status].cls">
            {{ STATUS_META[t.status].label }}
          </span>
          <span class="t-text" :title="t.error || t.text">{{ t.error || t.text }}</span>
          <span class="t-meta vc-muted vc-num">
            {{ fmtBytes(t.bytes) }}<template v-if="t.elapsedMs"> · {{ (t.elapsedMs / 1000).toFixed(1) }}s</template>
          </span>
          <el-button v-if="t.filePath" link size="small" @click="reveal(t.filePath!)">
            打开
          </el-button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.batch-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.batch-grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 16px;
  align-items: start;
}

.full {
  width: 100%;
}

.stats {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--vc-text-secondary);
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 8px;
}

.run-row {
  display: flex;
  gap: 8px;
}

.queue {
  margin-top: 4px;
}

.task-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 320px;
  overflow-y: auto;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: var(--vc-radius-xs);
  font-size: 12.5px;
}

.task-row:hover {
  background: var(--vc-bg-hover);
}

.t-idx {
  color: var(--vc-text-muted);
  width: 26px;
  flex-shrink: 0;
}

.t-status {
  width: 52px;
  flex-shrink: 0;
  font-size: 11.5px;
  font-weight: 600;
}

.st-pending { color: var(--vc-text-muted); }
.st-running { color: var(--vc-info); }
.st-done { color: var(--vc-accent); }
.st-failed { color: var(--vc-danger); }
.st-skipped { color: var(--vc-text-muted); opacity: 0.7; }

.t-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vc-text-primary);
}

.task-row:has(.st-failed) .t-text {
  color: var(--vc-danger);
}

.t-meta {
  flex-shrink: 0;
  font-size: 11.5px;
}

code {
  font-family: var(--vc-font-mono);
  background: var(--vc-bg-input);
  padding: 1px 4px;
  border-radius: 3px;
}
</style>
