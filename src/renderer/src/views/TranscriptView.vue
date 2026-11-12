<script setup lang="ts">
/**
 * 听写转写页（ASR，mimo-v2.5-asr）
 *
 * 与 TTS 反向闭环：音频进、文字出。典型用途：
 * - 把录音/采访快速出稿
 * - 检查 TTS 生成结果是否念对（生成 → 转写回读）
 */
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { usePlayer, formatBytes } from '../composables/usePlayer'
import Waveform from '../components/Waveform.vue'

const emit = defineEmits<{ (e: 'need-key'): void }>()

const filePath = ref('')
const fileName = ref('')
const fileBytes = ref(0)
const transcribing = ref(false)
const resultText = ref('')
const failMsg = ref('')
const stats = ref<{ seconds?: number; audioTokens?: number; totalTokens?: number; elapsedMs?: number } | null>(null)

const player = usePlayer()

const hasFile = computed(() => !!filePath.value)

async function pickFile() {
  const picked = await window.vc.file.openDialog('audio')
  if (!picked) return
  accept(picked.path, picked.name, picked.bytes)
}

function accept(p: string, name: string, bytes: number) {
  const ext = p.toLowerCase().split('.').pop() || ''
  if (ext !== 'wav' && ext !== 'mp3') {
    ElMessage.warning('目前支持 wav / mp3 两种格式')
    return
  }
  if (bytes > 10 * 1024 * 1024) {
    ElMessage.warning('音频超过 10MB，请先裁剪')
    return
  }
  filePath.value = p
  fileName.value = name
  fileBytes.value = bytes
  resultText.value = ''
  failMsg.value = ''
  stats.value = null
  player.load(p)
}

/** 拖拽：拿到 File 对象没有完整路径（浏览器安全限制），提示用按钮选择 */
function onDrop(e: DragEvent) {
  const f = e.dataTransfer?.files?.[0]
  if (!f) return
  ElMessage.info('出于安全限制，拖拽拿不到完整路径，请点击按钮选择文件')
  void f
}

async function transcribeNow() {
  if (!filePath.value || transcribing.value) return
  transcribing.value = true
  failMsg.value = ''
  resultText.value = ''
  try {
    const res = await window.vc.asr.transcribe(filePath.value)
    if (res.ok && res.text != null) {
      resultText.value = res.text
      stats.value = {
        seconds: res.seconds,
        audioTokens: res.audioTokens,
        totalTokens: res.totalTokens,
        elapsedMs: res.elapsedMs,
      }
      ElMessage.success('转写完成')
    } else {
      failMsg.value = res.message || '转写失败'
      ElMessage.error(failMsg.value)
    }
  } catch (e: any) {
    failMsg.value = e?.message || String(e)
    ElMessage.error(failMsg.value)
  } finally {
    transcribing.value = false
  }
}

async function copyText() {
  if (!resultText.value) return
  await navigator.clipboard.writeText(resultText.value)
  ElMessage.success('已复制到剪贴板')
}

const wordCount = computed(() => resultText.value.replace(/\s/g, '').length)

onMounted(async () => {
  const s = await window.vc.settings.get()
  if (!s.hasApiKey) emit('need-key')
})
</script>

<template>
  <div class="vc-page transcript-page">
    <div class="batch-grid">
      <!-- 左：音频 + 波形 -->
      <section
        class="vc-card left"
        @dragover.prevent
        @drop.prevent="onDrop"
      >
        <h3 class="vc-card-title">音频来源</h3>

        <div v-if="!hasFile" class="drop-zone">
          <p class="drop-main">选择一个 wav / mp3 文件开始转写</p>
          <p class="drop-sub">适合采访录音出稿、TTS 结果回读校对 · 不超过 10MB</p>
          <el-button type="primary" @click="pickFile">选择音频文件</el-button>
        </div>

        <template v-else>
          <div class="file-row">
            <span class="file-name">{{ fileName }}</span>
            <span class="vc-muted vc-num">{{ formatBytes(fileBytes) }}</span>
            <span class="vc-spacer" />
            <el-button size="small" @click="pickFile">换一个</el-button>
          </div>

          <Waveform
            :file-path="filePath"
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
              {{ Math.floor(player.currentTime.value / 60) }}:{{ String(Math.floor(player.currentTime.value % 60)).padStart(2, '0') }}
              /
              {{ Math.floor(player.duration.value / 60) }}:{{ String(Math.floor(player.duration.value % 60)).padStart(2, '0') }}
            </span>
          </div>
        </template>
      </section>

      <!-- 右：转写操作 -->
      <section class="vc-card right">
        <h3 class="vc-card-title">转写</h3>
        <p class="vc-hint">
          使用小米 MiMo ASR（mimo-v2.5-asr）把语音转成文字，中英文均可。
        </p>
        <el-button
          type="primary"
          size="large"
          :loading="transcribing"
          :disabled="!hasFile"
          class="go-btn"
          @click="transcribeNow"
        >
          {{ transcribing ? '转写中…' : '开始转写' }}
        </el-button>
        <div v-if="stats" class="stats-box">
          <div class="stat-line">
            <span class="vc-muted">音频时长</span>
            <span class="vc-num">{{ stats.seconds ?? '?' }} 秒</span>
          </div>
          <div class="stat-line">
            <span class="vc-muted">耗时</span>
            <span class="vc-num">{{ ((stats.elapsedMs ?? 0) / 1000).toFixed(1) }} 秒</span>
          </div>
          <div class="stat-line">
            <span class="vc-muted">用量</span>
            <span class="vc-num">{{ stats.totalTokens ?? '?' }} tokens（音频 {{ stats.audioTokens ?? '?' }}）</span>
          </div>
        </div>
        <div v-if="failMsg" class="fail-box">{{ failMsg }}</div>
      </section>
    </div>

    <!-- 转写结果 -->
    <section v-if="resultText || transcribing" class="vc-card">
      <h3 class="vc-card-title">
        转写结果
        <span v-if="resultText" class="vc-muted vc-num">{{ wordCount }} 字</span>
        <span class="vc-spacer" />
        <el-button v-if="resultText" size="small" @click="copyText">复制全文</el-button>
      </h3>
      <div v-if="transcribing" class="transcribing-hint vc-pulsing">
        正在上传音频并转写，通常几秒内完成…
      </div>
      <div v-else class="result-text vc-selectable">{{ resultText }}</div>
    </section>
  </div>
</template>

<style scoped>
.transcript-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.batch-grid {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 16px;
  align-items: start;
}

.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 42px 20px;
  border: 1px dashed var(--vc-border-strong);
  border-radius: var(--vc-radius-md);
  background: var(--vc-bg-input);
}

.drop-main {
  font-size: 14px;
  color: var(--vc-text-primary);
  margin: 0;
}

.drop-sub {
  font-size: 12px;
  color: var(--vc-text-muted);
  margin: 0 0 6px;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.file-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.go-btn {
  width: 100%;
  margin-top: 8px;
}

.stats-box {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stat-line {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.fail-box {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: var(--vc-radius-sm);
  background: rgba(255, 112, 112, 0.1);
  border: 1px solid rgba(255, 112, 112, 0.3);
  color: var(--vc-danger);
  font-size: 12.5px;
}

.transcribing-hint {
  padding: 24px 0;
  text-align: center;
  color: var(--vc-text-secondary);
  font-size: 13px;
}

.result-text {
  font-size: 14px;
  line-height: 1.8;
  color: var(--vc-text-primary);
  white-space: pre-wrap;
  padding: 4px 2px;
}
</style>
