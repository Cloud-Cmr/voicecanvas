<script setup lang="ts">
/**
 * 时间戳配音页：给每句台词标一个时间点 [mm:ss]，
 * 声音在对应时间点响起，中间静音填充——适合给视频配音、播客串场。
 * 同时导出 LRC 字幕（按实际摆放时间）。
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import type { TimelineCue, TimelineProgressEvent } from '../../../shared/types'
import { PRESET_VOICES } from '../../../shared/constants'
import { usePlayer } from '../composables/usePlayer'
import Waveform from '../components/Waveform.vue'
import { watch } from 'vue'

const emit = defineEmits<{ (e: 'need-key'): void }>()

const rawText = ref('')
const voiceId = ref('mimo_default')
const instruction = ref('')
const running = ref(false)
const runningIndex = ref(0)
const runningTotal = ref(0)
const resultPath = ref('')
const resultLrc = ref('')
const resultDuration = ref(0)

const player = usePlayer()

watch(resultPath, (p) => {
  if (p) player.load(p)
})

/** 解析 [mm:ss] 文本 → 台词数组。无时间戳的行沿用上一条时间顺延 */
const cues = computed<TimelineCue[]>(() => {
  const out: TimelineCue[] = []
  let lastTime = '0:00'
  for (const line of rawText.value.replace(/\r\n/g, '\n').split('\n')) {
    const t = line.trim()
    if (!t) continue
    const m = t.match(/^\[?(\d{1,2}:\d{1,2}(?::\d{1,2})?(?:\.\d{1,3})?)\]?\s*(.*)$/)
    if (m) {
      lastTime = m[1]
      const text = m[2].trim()
      if (text) out.push({ time: lastTime, text })
    } else {
      out.push({ time: lastTime, text: t })
    }
  }
  return out
})

const totalChars = computed(() => cues.value.reduce((n, c) => n + c.text.length, 0))

const PLACEHOLDER = `[0:00] 欢迎收听本期节目。
[0:05] 今天我们聊聊声音的魔法。
[0:12] 首先来一段开场示范。

规则：
· 每行开头 [分:秒] 是这句台词的起始时间
· 没写时间戳的行会紧跟上一句播放
· 结束时同时导出 LRC 字幕`

async function importSrtLike() {
  const picked = await window.vc.file.openTextDialog()
  if (!picked) return
  const content = await window.vc.file.readText(picked.path)
  if (picked.path.toLowerCase().endsWith('.srt')) {
    const blocks = content.replace(/\r\n/g, '\n').split(/\n{2,}/)
    const out: string[] = []
    for (const b of blocks) {
      const lines = b.split('\n').filter((l) => l.trim())
      const timeLine = lines.find((l) => l.includes('-->'))
      const text = lines
        .filter((l) => !/^\d+$/.test(l.trim()) && !l.includes('-->'))
        .join(' ')
        .replace(/<[^>]+>/g, '')
        .trim()
      if (timeLine && text) {
        const start = timeLine.split('-->')[0].trim().replace(',', '.')
        const p = start.split(':').map(Number)
        const sec = p.length === 3 ? p[0] * 60 + p[1] : p[0]
        out.push(`[${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}]${text}`)
      }
    }
    rawText.value = out.join('\n')
  } else {
    rawText.value = content
  }
  ElMessage.success(`已导入 ${picked.name}`)
}

async function run() {
  if (!cues.value.length) {
    ElMessage.warning('请先粘贴带时间戳的台词')
    return
  }
  running.value = true
  runningTotal.value = cues.value.length
  runningIndex.value = 0
  resultPath.value = ''
  resultLrc.value = ''
  try {
    const res = await window.vc.synth.runTimeline({
      cues: cues.value,
      mode: 'preset',
      voiceId: voiceId.value,
      instruction: instruction.value.trim() || undefined,
    })
    if (res.ok && res.filePath) {
      resultPath.value = res.filePath
      resultLrc.value = res.lrcPath || ''
      resultDuration.value = res.durationMs || 0
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

async function reveal(p: string) {
  void window.vc.file.reveal(p)
}

function fmtMs(ms: number) {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
}

let offProgress: (() => void) | null = null
onMounted(async () => {
  const s = await window.vc.settings.get()
  if (!s.hasApiKey) emit('need-key')
  offProgress = window.vc.synth.onTimelineProgress((e: TimelineProgressEvent) => {
    runningIndex.value = e.index + 1
  })
})
onBeforeUnmount(() => offProgress?.())
</script>

<template>
  <div class="vc-page timeline-page">
    <div class="tl-grid">
      <!-- 左：时间轴文本 -->
      <section class="vc-card">
        <h3 class="vc-card-title">
          时间轴台词
          <span class="vc-spacer" />
          <el-button size="small" :disabled="!rawText" @click="rawText = ''">清空</el-button>
          <el-button size="small" @click="importSrtLike">导入 SRT / LRC</el-button>
        </h3>
        <el-input
          v-model="rawText"
          type="textarea"
          :autosize="{ minRows: 14, maxRows: 24 }"
          :placeholder="PLACEHOLDER"
        />
        <div class="stats">
          <span class="vc-num">{{ cues.length }} 条</span>
          <span class="vc-muted">·</span>
          <span class="vc-num">{{ totalChars }} 字</span>
        </div>
      </section>

      <!-- 右：参数 -->
      <section class="vc-card">
        <h3 class="vc-card-title">配音参数</h3>

        <label class="vc-label">音色（预置）</label>
        <el-select v-model="voiceId" filterable class="full">
          <el-option v-for="v in PRESET_VOICES" :key="v.id" :value="v.id" :label="v.label" />
        </el-select>

        <label class="vc-label">统一风格指令（可空）</label>
        <el-input v-model="instruction" placeholder="例：播报感强一点，语速均匀" />

        <p class="vc-hint">
          每段独立合成后摆放到你标的时间点；段落太挤会自动顺延，不会互相覆盖。
          完成后同时导出 <b>LRC 字幕</b>（按实际摆放时间），可直接进剪辑软件。
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
          {{ running ? `合成中 ${runningIndex}/${runningTotal}` : `开始配音（${cues.length} 段）` }}
        </el-button>
      </section>
    </div>

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
        字幕已同步导出：<span class="vc-mono">{{ resultLrc }}</span>
      </p>
    </section>
  </div>
</template>

<style scoped>
.timeline-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tl-grid {
  display: grid;
  grid-template-columns: 1.7fr 1fr;
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
