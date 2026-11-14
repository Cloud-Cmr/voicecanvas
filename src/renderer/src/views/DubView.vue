<script setup lang="ts">
/**
 * 视频字幕配音页 v2（完整流水线）
 *
 * 1. 导入视频 → ffmpeg 抽帧（每秒1帧）+ 提取原音轨
 * 2. tesseract.js OCR 识别每帧画面里的硬字幕 → 合并为时间轴字幕
 *    （或 whisper 听写有人声视频的语音生成字幕）
 * 3. 校对台词、分配音色
 * 4. 按时间轴 TTS → 生成配音音轨 → ffmpeg 混流回视频 → 输出带配音的视频
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { usePlayer } from '../composables/usePlayer'
import Waveform from '../components/Waveform.vue'

const emit = defineEmits<{ (e: 'need-key'): void }>()

const videoPath = ref('')
const videoName = ref('')
const audioWavPath = ref('')

const extracting = ref(false)
const extractingStep = ref('')
const recognizing = ref(false)
const mode = ref<'ocr' | 'asr'>('ocr')

interface SubCue {
  startMs: number
  endMs: number
  text: string
  voiceId: string
}
const subtitles = ref<SubCue[]>([])
const srtText = ref('')
const defaultVoice = ref('mimo_default')

const dubbing = ref(false)
const dubIdx = ref(0)
const dubTotal = ref(0)
const dubbedAudio = ref('')
const muxedVideo = ref('')
const muxing = ref(false)

const player = usePlayer()
const whisperState = ref<{ bin: boolean; model: boolean } | null>(null)

/** 退订时间轴合成进度 */
let offTimelineProgress: (() => void) | null = null

const hasSubs = computed(() => subtitles.value.length > 0)

async function refreshWhisper() {
  whisperState.value = await window.vc.whisper.status()
}

onMounted(async () => {
  try {
    const s = await window.vc.settings.get()
    if (!s.hasApiKey) emit('need-key')
    await refreshWhisper()
  } catch {
    /* 截图模式 */
  }
  // 订阅合成进度，驱动「配音中 x/N」
  try {
    offTimelineProgress = window.vc.synth.onTimelineProgress?.((ev) => {
      if (dubbing.value) {
        dubIdx.value = ev.index + 1
        dubTotal.value = ev.total
      }
    }) || null
  } catch {
    /* 进度事件不可用时静默 */
  }
})

function fmtMs(ms: number) {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
}

// ===== 步骤 1a：OCR 模式 =====
async function pickVideoAndOcr() {
  const picked = await window.vc.video.pickOpen()
  if (!picked) return
  videoPath.value = picked.path
  videoName.value = picked.name
  mode.value = 'ocr'
  extracting.value = true
  extractingStep.value = '抽取视频帧…'
  try {
    const frames = await window.vc.video.extractFrames(picked.path, 1)
    extractingStep.value = `OCR 识别 ${frames.frames.length} 帧…`
    recognizing.value = true
    const results = await window.vc.video.ocrFrames(
      frames.frames.map((p: string, i: number) => ({
        path: p,
        timeMs: Math.round((i / frames.fps) * 1000),
      })),
    )
    extracting.value = false
    recognizing.value = false

    const interval = 1000 / frames.fps
    const merged: SubCue[] = []
    let current: SubCue | null = null
    for (const r of results) {
      const t = (r.text || '').replace(/\s+/g, ' ').trim()
      if (!t) {
        if (current) { merged.push(current); current = null }
        continue
      }
      if (current && (t.includes(current.text.slice(0, 10)) || current.text.includes(t.slice(0, 10)))) {
        current.endMs = r.timeMs + interval
        if (t.length > current.text.length) current.text = t
      } else {
        if (current) merged.push(current)
        current = { startMs: r.timeMs, endMs: r.timeMs + interval, text: t, voiceId: defaultVoice.value }
      }
    }
    if (current) merged.push(current)

    subtitles.value = merged.filter((s) => s.text.length >= 2)
    genSrt()
    ElMessage.success(`OCR 完成：${subtitles.value.length} 条字幕，请校对`)
  } catch (e: any) {
    ElMessage.error(e?.message || 'OCR 失败')
  } finally {
    extracting.value = false
    recognizing.value = false
  }
}

// ===== 步骤 1b：whisper 模式 =====
async function pickVideoAndAsr() {
  const picked = await window.vc.video.pickOpen()
  if (!picked) return
  videoPath.value = picked.path
  videoName.value = picked.name
  mode.value = 'asr'
  if (!whisperState.value?.bin || !whisperState.value?.model) {
    ElMessage.warning('请先下载 whisper 引擎与模型')
    return
  }
  extracting.value = true
  extractingStep.value = '提取音轨…'
  try {
    const audio = await window.vc.video.extractAudio(picked.path)
    audioWavPath.value = audio.path
    extractingStep.value = 'whisper 识别中（离线）…'
    recognizing.value = true
    const res = await window.vc.whisper.transcribe(audio.path, 'base')
    recognizing.value = false
    extracting.value = false
    if (res.ok && res.srt) {
      parseSrtToEdit(res.srt)
      ElMessage.success(`识别完成：${subtitles.value.length} 条`)
    } else {
      ElMessage.error(res.message || '识别失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '失败')
    extracting.value = false
    recognizing.value = false
  }
}

function parseSrtToEdit(srt: string) {
  const blocks = srt.replace(/\r\n/g, '\n').split(/\n{2,}/)
  const out: SubCue[] = []
  let idx = 1
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim())
    const timeLine = lines.find((l) => l.includes('-->'))
    const text = lines.filter((l) => !/^\d+$/.test(l.trim()) && !l.includes('-->')).join(' ').trim()
    if (!timeLine || !text) continue
    const [start, end] = timeLine.split('-->').map((s) => srtToMs(s.trim()))
    out.push({ startMs: start, endMs: end, text, voiceId: defaultVoice.value })
  }
  subtitles.value = out
  genSrt()
}

function srtToMs(t: string): number {
  const m = t.replace(',', '.').match(/(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)/)
  if (!m) return 0
  return Math.round(((Number(m[1] || 0) * 60 + Number(m[2] || 0)) * 60 + Number(m[3] || 0)) * 1000)
}

function genSrt() {
  const t = (ms: number) => {
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    const ms3 = ms % 1000
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms3).padStart(3, '0')}`
  }
  srtText.value = subtitles.value
    .map((s, i) => `${i + 1}\n${t(s.startMs)} --> ${t(s.endMs)}\n${s.text}\n`)
    .join('\n')
}

function removeSub(i: number) {
  subtitles.value.splice(i, 1)
  genSrt()
}

onBeforeUnmount(() => {
  offTimelineProgress?.()
  offTimelineProgress = null
})

function reveal(p: string) {
  void window.vc.file.reveal(p)
}

async function downloadWhisperPart(kind: 'bin' | 'model') {
  try {
    if (kind === 'bin') await window.vc.whisper.downloadBin(() => {})
    else await window.vc.whisper.downloadModel('base', () => {})
    await refreshWhisper()
    ElMessage.success(kind === 'bin' ? '引擎下载完成' : '模型下载完成')
  } catch (e: any) {
    ElMessage.error(e?.message || '下载失败')
  }
}

// ===== 步骤 4：配音 + 混流 =====
async function dub() {
  if (!subtitles.value.length || !videoPath.value) return
  dubbing.value = true
  dubTotal.value = subtitles.value.length
  dubIdx.value = 0
  try {
    const res = await window.vc.synth.runTimeline({
      cues: subtitles.value.map((s) => ({
        time: `${Math.floor(s.startMs / 60000)}:${String(Math.floor((s.startMs % 60000) / 1000)).padStart(2, '0')}`,
        text: s.text,
        voiceId: s.voiceId,
      })),
      mode: 'preset',
      voiceId: defaultVoice.value,
    })
    if (!res.ok || !res.filePath) {
      ElMessage.error(res.message || '配音失败')
      return
    }
    dubbedAudio.value = res.filePath
    player.load(res.filePath)

    muxing.value = true
    const mux = await window.vc.video.muxAudio(videoPath.value, res.filePath)
    muxedVideo.value = mux.path
    ElMessage.success('配音视频已生成')
    void window.vc.file.reveal(mux.path)
  } catch (e: any) {
    ElMessage.error(e?.message || String(e))
  } finally {
    dubbing.value = false
    muxing.value = false
  }
}
</script>

<template>
  <div class="vc-page dub2-page">
    <!-- 步骤 1 -->
    <section class="vc-card">
      <h3 class="vc-card-title">① 导入视频并识别字幕</h3>
      <div class="mode-row">
        <el-button type="primary" :loading="extracting && mode === 'ocr'" @click="pickVideoAndOcr">
          {{ mode === 'ocr' && extracting ? extractingStep : '硬字幕视频（OCR 识别画面文字）' }}
        </el-button>
        <el-button :loading="extracting && mode === 'asr'" @click="pickVideoAndAsr">
          {{ mode === 'asr' && extracting ? extractingStep : '有人声视频（whisper 听写语音）' }}
        </el-button>
      </div>
      <p v-if="videoName" class="m-file">已选：{{ videoName }}</p>
      <p class="vc-hint">
        <b>硬字幕模式（推荐）</b>：用 OCR 读取画面文字，无需下载模型，开箱即用，离线可用；
        <b>有人声模式</b>：用 whisper 听写语音生成字幕（需先下载引擎与模型）。
        识别结果在下方校对后，点「开始配音」逐条合成，最后混回原视频，
        输出「原名_配音.mp4」（webm/mkv 输入保持原容器）。
      </p>

      <div class="whisper-box">
        <div class="whisper-status">
          <span>whisper 本地识别引擎（有人声模式用）</span>
          <span v-if="whisperState" class="whisper-tags">
            <span class="w-tag" :class="{ ok: whisperState.bin }">引擎 {{ whisperState.bin ? '✓' : '未下载' }}</span>
            <span class="w-tag" :class="{ ok: whisperState.model }">模型 {{ whisperState.model ? '✓' : '未下载' }}</span>
          </span>
          <span class="vc-spacer" />
          <el-button v-if="whisperState && !whisperState.bin" size="small" @click="downloadWhisperPart('bin')">
            下载引擎（8MB）
          </el-button>
          <el-button v-if="whisperState && !whisperState.model" size="small" @click="downloadWhisperPart('model')">
            下载模型（145MB）
          </el-button>
        </div>
      </div>
    </section>

    <!-- 步骤 2 -->
    <section v-if="hasSubs" class="vc-card">
      <h3 class="vc-card-title">
        ② 校对台词并分配音色
        <span class="vc-spacer" />
        <span class="vc-hint">默认音色</span>
        <el-select v-model="defaultVoice" size="small" filterable style="width: 150px">
          <el-option
            v-for="v in [
              { id: 'mimo_default', label: '默认' },
              { id: '冰糖', label: '冰糖·女' },
              { id: '茉莉', label: '茉莉·女' },
              { id: '苏打', label: '苏打·男' },
              { id: '白桦', label: '白桦·男' },
            ]"
            :key="v.id"
            :value="v.id"
            :label="v.label"
          />
        </el-select>
      </h3>
      <div class="sub-list">
        <div v-for="(s, i) in subtitles" :key="i" class="sub-row">
          <span class="sub-idx vc-num">{{ i + 1 }}</span>
          <span class="sub-time vc-num">{{ fmtMs(s.startMs) }}–{{ fmtMs(s.endMs) }}</span>
          <el-input v-model="s.text" size="small" style="flex: 1" />
          <el-select v-model="s.voiceId" size="small" filterable style="width: 140px">
            <el-option
              v-for="v in [
                { id: 'mimo_default', label: '默认' },
                { id: '冰糖', label: '冰糖·女' },
                { id: '茉莉', label: '茉莉·女' },
                { id: '苏打', label: '苏打·男' },
                { id: '白桦', label: '白桦·男' },
              ]"
              :key="v.id"
              :value="v.id"
              :label="v.label"
            />
          </el-select>
          <el-button size="small" link @click="removeSub(i)">删</el-button>
        </div>
      </div>
    </section>

    <!-- 步骤 3+4 -->
    <section v-if="hasSubs && videoPath" class="vc-card">
      <h3 class="vc-card-title">③ 生成配音并合成视频</h3>
      <p class="vc-hint">
        每条字幕按音色合成，摆放到字幕起始时间；配音音轨自动与原视频混流，输出「原名_配音.mp4」。
      </p>
      <el-button type="primary" size="large" class="go-btn" :loading="dubbing || muxing" @click="dub">
        {{ dubbing ? `配音中 ${dubIdx}/${dubTotal}` : muxing ? '合成视频中…' : `开始配音（${subtitles.length} 段）` }}
      </el-button>
    </section>

    <!-- 结果 -->
    <section v-if="dubbedAudio" class="vc-card">
      <h3 class="vc-card-title">配音音轨预览</h3>
      <Waveform
        :file-path="dubbedAudio"
        :current-time="player.currentTime.value"
        :duration="player.duration.value"
        :height="64"
      />
      <p v-if="muxedVideo" class="vc-hint" style="margin-top: 8px">
        带配音的视频：<span class="vc-mono">{{ muxedVideo }}</span>
        <el-button size="small" link @click="reveal(muxedVideo)">打开位置</el-button>
      </p>
    </section>
  </div>
</template>

<style scoped>
.dub2-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mode-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.m-file {
  font-size: 13px;
  color: var(--vc-text-secondary);
  margin: 10px 0 0;
}

.whisper-box {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--vc-radius-sm);
  background: var(--vc-bg-input);
  border: 1px solid var(--vc-border);
}

.whisper-status {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  flex-wrap: wrap;
}

.whisper-tags {
  display: flex;
  gap: 6px;
}

.w-tag {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 3px;
  background: rgba(255, 180, 84, 0.15);
  color: var(--vc-warning);
}

.w-tag.ok {
  background: var(--vc-accent-soft);
  color: var(--vc-accent);
}

.sub-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 380px;
  overflow-y: auto;
}

.sub-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--vc-radius-xs);
}

.sub-row:hover {
  background: var(--vc-bg-hover);
}

.sub-idx {
  color: var(--vc-text-muted);
  width: 26px;
  flex-shrink: 0;
}

.sub-time {
  color: var(--vc-text-secondary);
  width: 105px;
  flex-shrink: 0;
}

.go-btn {
  width: 100%;
}
</style>
