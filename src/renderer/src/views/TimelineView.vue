<script setup lang="ts">
/**
 * 时间戳配音页 v2：粘贴任意格式的剧本，AI 自动识别时间与角色，
 * 每个角色可分配不同音色，一次合成带角色切换的完整音轨 + LRC 字幕。
 *
 * 识别策略：AI 解析（mimo-v2.6-flash，主）+ 本地正则（即时预览/降级）。
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { TimelineProgressEvent } from '../../../shared/types'
import { PRESET_VOICES } from '../../../shared/constants'
import { parseScript, formatMs } from '../../../shared/scriptParser'
import { usePlayer } from '../composables/usePlayer'
import Waveform from '../components/Waveform.vue'

const emit = defineEmits<{ (e: 'need-key'): void }>()

const rawText = ref('')
const instruction = ref('')
const running = ref(false)
const runningIndex = ref(0)
const runningTotal = ref(0)
const runningRole = ref('')
const resultPath = ref('')
const resultLrc = ref('')
const resultDuration = ref(0)

/** 解析出的台词（含角色与音色分配） */
interface Cue {
  startMs: number
  role?: string
  text: string
  voiceId: string
}
const cues = ref<Cue[]>([])
const roleVoices = ref<Record<string, string>>({})
const parseSource = ref<'ai' | 'local' | null>(null)
const parsing = ref(false)
const parseNote = ref('')

const player = usePlayer()

/** 本地正则即时解析（防抖 400ms，仅用于快速预览；AI 结果优先不被覆盖） */
let localTimer: ReturnType<typeof setTimeout> | null = null
watch(rawText, (v) => {
  if (parsing.value) return
  if (localTimer) clearTimeout(localTimer)
  localTimer = setTimeout(() => {
    if (parseSource.value === 'ai') return
    const r = parseScript(v)
    applyParsed(
      r.cues.map((c) => ({ startMs: c.startMs, role: c.role, text: c.text })),
      'local',
      r.warnings.join('；'),
    )
  }, 400)
})

/** 应用解析结果（保留已分配的音色；新角色按顺序自动分配预置音色） */
function applyParsed(
  parsed: Array<{ startMs: number; role?: string; text: string }>,
  source: 'ai' | 'local',
  note?: string,
) {
  const prevVoices = { ...roleVoices.value }
  const next: Cue[] = []
  const autoPool = PRESET_VOICES.filter((v) => v.id !== 'mimo_default')
  let autoIdx = 0
  for (const c of parsed) {
    let vid = c.role ? prevVoices[c.role] || '' : ''
    if (!vid && c.role) {
      vid = autoPool[autoIdx % autoPool.length].id
      autoIdx++
    }
    next.push({
      startMs: c.startMs,
      role: c.role,
      text: c.text,
      voiceId: vid || 'mimo_default',
    })
  }
  cues.value = next
  parseSource.value = source
  parseNote.value = note || ''
}

/** AI 智能识别（主通道） */
async function aiParse() {
  if (!rawText.value.trim()) {
    ElMessage.warning('请先粘贴剧本')
    return
  }
  parsing.value = true
  try {
    const r: any = await window.vc.llm.parseScript(rawText.value)
    applyParsed(
      r.cues.map((c: any) => ({ startMs: c.startMs, role: c.role, text: c.text })),
      'ai',
      r.note,
    )
    ElMessage.success(
      `AI 识别完成：${r.cues.length} 条台词${r.roles?.length ? `，${r.roles.length} 个角色` : ''}`,
    )
  } catch (e: any) {
    // AI 失败自动降级到本地解析
    const r = parseScript(rawText.value)
    applyParsed(
      r.cues.map((c) => ({ startMs: c.startMs, role: c.role, text: c.text })),
      'local',
      `AI 识别失败（${e?.message || ''}），已用本地解析`,
    )
    ElMessage.warning('AI 识别失败，已改用本地解析')
  } finally {
    parsing.value = false
  }
}

/** 角色列表（去重 + 句数） */
const roleList = computed(() => {
  const seen = new Map<string, number>()
  for (const c of cues.value) {
    if (c.role) seen.set(c.role, (seen.get(c.role) || 0) + 1)
  }
  return Array.from(seen.entries()).map(([role, count]) => ({ role, count }))
})

function setRoleVoice(role: string, voiceId: string) {
  roleVoices.value[role] = voiceId
  for (const c of cues.value) {
    if (c.role === role) c.voiceId = voiceId
  }
}

const totalChars = computed(() => cues.value.reduce((n, c) => n + c.text.length, 0))
const roleCount = computed(() => roleList.value.length)

const PLACEHOLDER = `直接粘贴任意格式的剧本，点「AI 智能识别」自动解析时间和角色。例如：

【旁白】0分0秒 夜色渐深，城市的灯一盏盏亮起来。
【小明】12秒 妈，我回来了。
【妈妈】11分12秒 饭在锅里，自己热一下。

也可以是：
张三：00:12 你好啊。
李四 0:45 最后一句。
[00:11:12] 带小时的也行。
甚至 SRT 字幕、纯台词都能识别。`

async function importSrtLike() {
  const picked = await window.vc.file.openTextDialog()
  if (!picked) return
  const content = await window.vc.file.readText(picked.path)
  rawText.value = content
  ElMessage.success(`已导入 ${picked.name}，点「AI 智能识别」解析`)
}

async function run() {
  if (!cues.value.length) {
    ElMessage.warning('请先粘贴剧本并解析')
    return
  }
  running.value = true
  runningTotal.value = cues.value.length
  runningIndex.value = 0
  resultPath.value = ''
  resultLrc.value = ''
  try {
    const res = await window.vc.synth.runTimeline({
      cues: cues.value.map((c) => ({
        time: formatMs(c.startMs),
        text: c.text,
        role: c.role,
        voiceId: c.voiceId,
      })),
      mode: 'preset',
      voiceId: 'mimo_default',
      instruction: instruction.value.trim() || undefined,
      roleVoices: { ...roleVoices.value },
    })
    if (res.ok && res.filePath) {
      resultPath.value = res.filePath
      resultLrc.value = res.lrcPath || ''
      resultDuration.value = res.durationMs || 0
      player.load(res.filePath)
      ElMessage.success('时间轴配音完成')
    } else {
      ElMessage.error(res.message || '失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.message || String(e))
  } finally {
    running.value = false
  }
}

function reveal(p: string) {
  void window.vc.file.reveal(p)
}

function fmtMs(ms: number) {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
}

let offProgress: (() => void) | null = null
onMounted(async () => {
  try {
    const s = await window.vc.settings.get()
    if (!s.hasApiKey) emit('need-key')
  } catch {
    /* 截图模式 */
  }
  offProgress = window.vc.synth.onTimelineProgress((e: TimelineProgressEvent) => {
    runningIndex.value = e.index + 1
    runningRole.value = e.role || ''
  })
})
onBeforeUnmount(() => offProgress?.())
</script>

<template>
  <div class="vc-page tl2-page">
    <div class="tl-grid">
      <!-- 左：剧本输入 + 角色分配 -->
      <div class="tl-left">
        <section class="vc-card">
          <h3 class="vc-card-title">
            剧本（任意格式）
            <span class="vc-spacer" />
            <el-button size="small" :disabled="!rawText" @click="rawText = ''">清空</el-button>
            <el-button size="small" @click="importSrtLike">导入文件</el-button>
          </h3>
          <el-input
            v-model="rawText"
            type="textarea"
            :autosize="{ minRows: 10, maxRows: 18 }"
            :placeholder="PLACEHOLDER"
          />
          <div class="parse-row">
            <el-button
              type="primary"
              :loading="parsing"
              :disabled="!rawText.trim()"
              @click="aiParse"
            >
              {{ parsing ? 'AI 识别中…' : 'AI 智能识别' }}
            </el-button>
            <span v-if="parseSource" class="parse-src">
              {{ parseSource === 'ai' ? 'AI 识别' : '本地解析' }}
              · {{ cues.length }} 条
              <template v-if="roleCount"> · {{ roleCount }} 个角色</template>
              <template v-if="totalChars"> · {{ totalChars }} 字</template>
            </span>
            <span class="vc-spacer" />
            <span class="vc-hint">AI 能理解「十一点十二分」「1分12.5秒」等任意写法</span>
          </div>
          <p v-if="parseNote" class="parse-note">{{ parseNote }}</p>
        </section>

        <!-- 角色分配 -->
        <section v-if="roleList.length" class="vc-card">
          <h3 class="vc-card-title">角色音色分配</h3>
          <div v-for="r in roleList" :key="r.role" class="role-row">
            <span class="role-name">{{ r.role }}</span>
            <span class="role-count vc-num vc-muted">{{ r.count }} 句</span>
            <el-select
              :model-value="roleVoices[r.role]"
              size="small"
              filterable
              style="flex: 1"
              @update:model-value="(v: string) => setRoleVoice(r.role, v)"
            >
              <el-option v-for="v in PRESET_VOICES" :key="v.id" :value="v.id" :label="v.label" />
            </el-select>
          </div>
          <p class="vc-hint">没有角色的台词使用「默认音色」。</p>

          <label class="vc-label" style="margin-top: 10px">默认音色（无角色台词）</label>
          <el-select
            :model-value="cues.find((c) => !c.role)?.voiceId || 'mimo_default'"
            size="small"
            filterable
            style="width: 100%"
            @update:model-value="(v: string) => { for (const c of cues) if (!c.role) c.voiceId = v }"
          >
            <el-option v-for="v in PRESET_VOICES" :key="v.id" :value="v.id" :label="v.label" />
          </el-select>
        </section>
      </div>

      <!-- 右：参数 -->
      <section class="vc-card">
        <h3 class="vc-card-title">配音参数</h3>
        <label class="vc-label">统一风格指令（可空）</label>
        <el-input v-model="instruction" placeholder="例：播报感强一点，语速均匀" />

        <p class="vc-hint" style="margin-top: 12px">
          每段按角色音色独立合成，摆放到识别出的时间点；段落重叠自动顺延。
          完成后同时导出 <b>LRC 字幕</b>（含角色名）。
        </p>

        <div class="vc-divider" />
        <el-button
          type="primary"
          size="large"
          class="go-btn"
          :loading="running"
          :disabled="!cues.length"
          @click="run"
        >
          {{
            running
              ? `合成中 ${runningIndex}/${runningTotal}${runningRole ? `（${runningRole}）` : ''}`
              : `开始配音（${cues.length} 段）`
          }}
        </el-button>
      </section>
    </div>

    <!-- 台词明细 -->
    <section v-if="cues.length" class="vc-card">
      <h3 class="vc-card-title">台词明细</h3>
      <div class="cue-list">
        <div v-for="(c, i) in cues" :key="i" class="cue-row">
          <span class="cue-idx vc-num">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="cue-time vc-num">{{ fmtMs(c.startMs) }}</span>
          <span v-if="c.role" class="cue-role">{{ c.role }}</span>
          <span class="cue-text" :title="c.text">{{ c.text }}</span>
          <span class="cue-voice vc-muted">{{ PRESET_VOICES.find((v) => v.id === c.voiceId)?.label || c.voiceId }}</span>
        </div>
      </div>
    </section>

    <!-- 结果 -->
    <section v-if="resultPath" class="vc-card">
      <h3 class="vc-card-title">
        配音结果
        <span class="vc-muted vc-num">总长 {{ fmtMs(resultDuration) }}</span>
        <span class="vc-spacer" />
        <el-button size="small" @click="reveal(resultPath)">打开位置</el-button>
      </h3>
      <Waveform
        :file-path="resultPath"
        :current-time="player.currentTime.value"
        :duration="player.duration.value"
        :height="72"
      />
      <div class="player-controls">
        <button class="play-btn" @click="player.toggle()">
          <span v-if="player.playing.value">❚❚</span>
          <span v-else>▶</span>
        </button>
        <span class="vc-mono vc-num">
          {{ Math.floor(player.currentTime.value / 60) }}:{{
            String(Math.floor(player.currentTime.value % 60)).padStart(2, '0')
          }}
          /
          {{ Math.floor(player.duration.value / 60) }}:{{
            String(Math.floor(player.duration.value % 60)).padStart(2, '0')
          }}
        </span>
      </div>
      <p class="vc-hint" style="margin-top: 8px">
        LRC 字幕：<span class="vc-mono">{{ resultLrc }}</span>
      </p>
    </section>
  </div>
</template>

<style scoped>
.tl2-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tl-grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 16px;
  align-items: start;
}

.tl-left {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.parse-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.parse-src {
  font-size: 12.5px;
  color: var(--vc-scope);
}

.parse-note {
  font-size: 12px;
  color: var(--vc-text-muted);
  margin: 8px 0 0;
}

.role-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.role-name {
  font-size: 13px;
  font-weight: 600;
  width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-count {
  font-size: 11px;
  width: 40px;
  flex-shrink: 0;
}

.cue-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 360px;
  overflow-y: auto;
}

.cue-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: var(--vc-radius-xs);
  font-size: 12.5px;
}

.cue-row:hover {
  background: var(--vc-bg-hover);
}

.cue-idx {
  color: var(--vc-text-muted);
  width: 24px;
  flex-shrink: 0;
}

.cue-time {
  width: 62px;
  flex-shrink: 0;
  color: var(--vc-text-secondary);
}

.cue-role {
  font-size: 11.5px;
  color: var(--vc-accent);
  width: 70px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cue-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cue-voice {
  font-size: 11.5px;
  width: 110px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.go-btn {
  width: 100%;
}

.player-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}

.play-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: var(--vc-accent);
  color: var(--vc-text-inverse);
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
