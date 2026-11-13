<script setup lang="ts">
/**
 * 视频字幕配音页
 *
 * 三步流水线：
 * 1. 导入视频/音频 → whisper 本地识别 → 提取带时间轴的字幕（SRT）
 * 2. 校对字幕文本、给不同说话人/段落分配音色
 * 3. 按字幕时间轴 TTS 合成 → 输出配音音轨（wav）+ 新字幕，拖进剪辑软件与原视频对齐
 *
 * whisper 本地运行（离线、不用 Key），TTS 走 MiMo。
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePlayer } from '../composables/usePlayer'
import Waveform from '../components/Waveform.vue'

const emit = defineEmits<{ (e: 'need-key'): void }>()

// ===== 步骤 1：媒体导入与识别 =====
const mediaPath = ref('')
const mediaName = ref('')
const recognizing = ref(false)
const recognizeProgress = ref(0)
const srtText = ref('')

// ===== 步骤 2：字幕编辑 =====
interface SubCue {
  index: number
  startMs: number
  endMs: number
  text: string
  voiceId: string
}
const subtitles = ref<SubCue[]>([])
const defaultVoice = ref('mimo_default')

// ===== 步骤 3：配音合成 =====
const dubbing = ref(false)
const dubIdx = ref(0)
const dubTotal = ref(0)
const resultPath = ref('')
const resultLrc = ref('')

const player = usePlayer()

// whisper 安装状态
const whisperState = ref<{ bin: boolean; model: boolean } | null>(null)
const downloading = ref('')
const downloadPct = ref(0)

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
})

function pickMedia() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'audio/*,video/*'
  input.onchange = async () => {
    const f = input.files?.[0]
    if (!f) return
    // Electron 里拖拽/选择的文件有完整路径
    const p = (f as any).path
    if (!p) {
      ElMessage.warning('请用「选择文件」对话框（可拿到完整路径）')
      return
    }
    mediaPath.value = p
    mediaName.value = f.name
  }
  input.click()
}

async function pickMediaDialog() {
  // 桌面对话框：接受视频和音频
  const res = await window.vc.file.openDialog('audio')
  if (!res) return
  mediaPath.value = res.path
  mediaName.value = res.name
}

/** 识别：先提取音轨（视频则用 ffmpeg？暂不支持视频直接转，提示用户先转音频）
 *  简化：whisper-cli 只吃 wav。视频文件让用户先导出音频，或后续版本内置提取。
 *  目前支持 wav/mp3：mp3 whisper 不吃 → 需 wav。用 MediaRecorder 不行（是文件）。
 *  折中：非 wav 先提示需要 wav；后续版本接 ffmpeg。
 */
async function recognize() {
  if (!mediaPath.value) return
  const lower = mediaPath.value.toLowerCase()
  if (!lower.endsWith('.wav')) {
    ElMessage.warning('whisper 只吃 WAV。请先把视频/MP3 转成 WAV（后续版本会内置转换）。')
    return
  }
  if (!whisperState.value?.bin || !whisperState.value?.model) {
    ElMessage.warning('请先下载 whisper 引擎和模型')
    return
  }
  recognizing.value = true
  srtText.value = ''
  subtitles.value = []
  try {
    const res = await window.vc.whisper.transcribe(mediaPath.value, 'base')
    if (res.ok && res.srt) {
      srtText.value = res.srt
      parseSrt()
      ElMessage.success(`识别完成：${subtitles.value.length} 条字幕`)
    } else {
      ElMessage.error(res.message || '识别失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '识别失败')
  } finally {
    recognizing.value = false
  }
}

/** 解析 SRT 到可编辑列表 */
function parseSrt() {
  const blocks = srtText.value.replace(/\r\n/g, '\n').split(/\n{2,}/)
  const out: SubCue[] = []
  let idx = 1
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim())
    const timeLine = lines.find((l) => l.includes('-->'))
    const text = lines
      .filter((l) => !/^\d+$/.test(l.trim()) && !l.includes('-->'))
      .join(' ')
      .trim()
    if (!timeLine || !text) continue
    const [start, end] = timeLine.split('-->').map((s) => srtToMs(s.trim()))
    out.push({ index: idx++, startMs: start, endMs: end, text, voiceId: defaultVoice.value })
  }
  subtitles.value = out
}

function srtToMs(t: string): number {
  const m = t.replace(',', '.').match(/(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)/)
  if (!m) return 0
  const h = Number(m[1] || 0)
  const min = Number(m[2] || 0)
  const s = Number(m[3] || 0)
  return Math.round(((h * 60 + min) * 60 + s) * 1000)
}

function fmtMs(ms: number) {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 下载 whisper */
async function downloadBin() {
  downloading.value = 'engine'
  downloadPct.value = 0
  try {
    await window.vc.whisper.downloadBin((pct: number) => (downloadPct.value = pct))
    await refreshWhisper()
    ElMessage.success('引擎下载完成')
  } catch (e: any) {
    ElMessage.error(e?.message || '下载失败')
  } finally {
    downloading.value = ''
  }
}

async function downloadModel() {
  downloading.value = 'model'
  downloadPct.value = 0
  try {
    await window.vc.whisper.downloadModel('base', (pct: number) => (downloadPct.value = pct))
    await refreshWhisper()
    ElMessage.success('模型下载完成（base，中文可用）')
  } catch (e: any) {
    ElMessage.error(e?.message || '下载失败')
  } finally {
    downloading.value = ''
  }
}

/** 配音合成：按字幕时间轴摆放各段 */
async function dub() {
  if (!subtitles.value.length) return
  dubbing.value = true
  dubTotal.value = subtitles.value.length
  dubIdx.value = 0
  resultPath.value = ''
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
    if (res.ok && res.filePath) {
      resultPath.value = res.filePath
      resultLrc.value = res.lrcPath || ''
      player.load(res.filePath)
      ElMessage.success('配音音轨已生成，可与原视频对齐')
    } else {
      ElMessage.error(res.message || '配音失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.message || String(e))
  } finally {
    dubbing.value = false
  }
}

function reveal(p: string) {
  void window.vc.file.reveal(p)
}

function removeSub(i: number) {
  subtitles.value.splice(i, 1)
}

onBeforeUnmount(() => {})
</script>

<template>
  <div class="vc-page dub-page">
    <!-- 步骤 1 -->
    <section class="vc-card">
      <h3 class="vc-card-title">① 导入媒体并识别字幕</h3>

      <div v-if="!mediaPath" class="import-row">
        <el-button type="primary" @click="pickMediaDialog">选择视频 / 音频文件</el-button>
        <span class="vc-hint">视频需先转成 WAV 音频（后续版本内置转换）；音频支持 WAV</span>
      </div>
      <div v-else class="import-row">
        <span class="file-name">{{ mediaName }}</span>
        <el-button size="small" @click="pickMediaDialog">换一个</el-button>
      </div>

      <!-- whisper 引擎状态 -->
      <div class="whisper-box">
        <div class="whisper-status">
          <span>本地识别引擎（whisper，离线运行）</span>
          <span v-if="whisperState" class="whisper-tags">
            <span class="w-tag" :class="{ ok: whisperState.bin }">引擎 {{ whisperState.bin ? '✓' : '未下载' }}</span>
            <span class="w-tag" :class="{ ok: whisperState.model }">模型 {{ whisperState.model ? '✓' : '未下载' }}</span>
          </span>
          <span class="vc-spacer" />
          <el-button v-if="whisperState && !whisperState.bin" size="small" :loading="downloading === 'engine'" @click="downloadBin">
            下载引擎（8MB）
          </el-button>
          <el-button v-if="whisperState && !whisperState.model" size="small" :loading="downloading === 'model'" @click="downloadModel">
            下载模型（145MB）
          </el-button>
        </div>
        <el-progress v-if="downloading" :percentage="downloadPct" :stroke-width="6" />
      </div>

      <div class="import-row" style="margin-top: 10px">
        <el-button
          type="primary"
          :loading="recognizing"
          :disabled="!mediaPath || !whisperState?.bin || !whisperState?.model"
          @click="recognize"
        >
          {{ recognizing ? '识别中…' : '识别字幕' }}
        </el-button>
        <span class="vc-hint">识别在本地离线运行，不上传任何内容</span>
      </div>

      <div v-if="srtText" class="srt-preview">
        <label class="vc-label">识别出的字幕（SRT，可直接编辑下面的表格）</label>
        <el-input v-model="srtText" type="textarea" :rows="4" class="vc-mono" />
      </div>
    </section>

    <!-- 步骤 2 -->
    <section v-if="subtitles.length" class="vc-card">
      <h3 class="vc-card-title">
        ② 校对台词并分配音色
        <span class="vc-spacer" />
        <span class="vc-hint">默认音色</span>
        <el-select v-model="defaultVoice" size="small" filterable style="width: 160px">
          <el-option v-for="v in [
            { id: 'mimo_default', label: 'MiMo-默认' },
            { id: '冰糖', label: '冰糖 · 女声' },
            { id: '茉莉', label: '茉莉 · 女声' },
            { id: '苏打', label: '苏打 · 男声' },
            { id: '白桦', label: '白桦 · 男声' },
          ]" :key="v.id" :value="v.id" :label="v.label" />
        </el-select>
      </h3>
      <div class="sub-list">
        <div v-for="(s, i) in subtitles" :key="i" class="sub-row">
          <span class="sub-idx vc-num">{{ i + 1 }}</span>
          <span class="sub-time vc-num">{{ fmtMs(s.startMs) }}–{{ fmtMs(s.endMs) }}</span>
          <el-input v-model="s.text" size="small" style="flex: 1" />
          <el-select v-model="s.voiceId" size="small" filterable style="width: 150px">
            <el-option v-for="v in [
              { id: 'mimo_default', label: '默认' },
              { id: '冰糖', label: '冰糖·女' },
              { id: '茉莉', label: '茉莉·女' },
              { id: '苏打', label: '苏打·男' },
              { id: '白桦', label: '白桦·男' },
            ]" :key="v.id" :value="v.id" :label="v.label" />
          </el-select>
          <el-button size="small" link @click="removeSub(i)">删</el-button>
        </div>
      </div>
    </section>

    <!-- 步骤 3 -->
    <section v-if="subtitles.length" class="vc-card">
      <h3 class="vc-card-title">③ 生成配音音轨</h3>
      <p class="vc-hint">
        每条字幕按角色音色合成，摆放到字幕的起始时间。输出的 WAV 与原视频等长对齐，
        拖进剪辑软件替换原声即可。同时导出 LRC。
      </p>
      <el-button
        type="primary"
        size="large"
        class="go-btn"
        :loading="dubbing"
        @click="dub"
      >
        {{ dubbing ? `配音中 ${dubIdx}/${dubTotal}` : `生成配音音轨（${subtitles.length} 段）` }}
      </el-button>
    </section>

    <!-- 结果 -->
    <section v-if="resultPath" class="vc-card">
      <h3 class="vc-card-title">配音结果</h3>
      <Waveform
        :file-path="resultPath"
        :current-time="player.currentTime.value"
        :duration="player.duration.value"
        :height="72"
      />
      <p class="vc-hint" style="margin-top: 8px">
        音轨：<span class="vc-mono">{{ resultPath }}</span>
        <el-button size="small" link @click="reveal(resultPath)">打开位置</el-button>
      </p>
    </section>
  </div>
</template>

<style scoped>
.dub-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.import-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.file-name {
  font-size: 13.5px;
  font-weight: 600;
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

.srt-preview {
  margin-top: 12px;
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
