<script setup lang="ts">
/**
 * 朗读跟读页：选一句 → 听标准发音 → 自己录音跟读 → 并排对比重听
 *
 * 场景：语言学习、播音练习、台词背稿。
 * 链路：TTS 生成示范音频 → 麦克风录音（复用 useRecorder）→ 两个播放器并排。
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { PRESET_VOICES } from '../../../shared/constants'
import { SCRIPT_TEMPLATES } from '../../../shared/scripts'
import { usePlayer } from '../composables/usePlayer'
import { useRecorder, formatDuration } from '../composables/useRecorder'
import Waveform from '../components/Waveform.vue'

const emit = defineEmits<{ (e: 'need-key'): void }>()

// 跟读材料：手输或从场景文案模板选
const text = ref('')
const voiceId = ref('mimo_default')
const instruction = ref('')

// 标准音频
const generating = ref(false)
const modelPath = ref('')
const modelBytes = ref(0)
const player = usePlayer()

// 跟读录音
const recorder = useRecorder()
const recording = computed(() => recorder.recording.value)
const myPath = ref('')
const myBytes = ref(0)
const myPlayer = usePlayer()

// 文案模板选择
const scriptPicker = ref(false)
const scenes = [...new Set(SCRIPT_TEMPLATES.map((s) => s.scene))]

const hasModel = computed(() => !!modelPath.value)
const hasMine = computed(() => !!myPath.value)

watch(modelPath, (p) => {
  if (p) player.load(p)
})
watch(myPath, (p) => {
  if (p) myPlayer.load(p)
})


async function generateModel() {
  if (!text.value.trim()) {
    ElMessage.warning('请先输入要跟读的句子')
    return
  }
  generating.value = true
  try {
    const res = await window.vc.synth.run({
      mode: 'preset',
      text: text.value.trim(),
      instruction: instruction.value.trim() || undefined,
      voiceId: voiceId.value,
      format: 'wav',
    })
    if (res.ok) {
      modelPath.value = res.filePath
      modelBytes.value = res.bytes
      ElMessage.success('示范音频已生成')
    } else {
      ElMessage.error(res.message)
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '生成失败')
  } finally {
    generating.value = false
  }
}

async function startRec() {
  if (!hasModel.value) {
    ElMessage.warning('请先生成示范音频')
    return
  }
  const ok = await recorder.start()
  if (!ok && recorder.error.value) ElMessage.error(recorder.error.value)
}

async function stopRec() {
  const res = await recorder.stop()
  if (!res) {
    if (recorder.error.value) ElMessage.error(recorder.error.value)
    return
  }
  myPath.value = res.path
  myBytes.value = res.bytes
  ElMessage.success(`录音完成（${res.seconds} 秒），可以对比了`)
}

function applyScript(s: (typeof SCRIPT_TEMPLATES)[number]) {
  text.value = s.text.replace(/^[（(\[][^）)\]]*[）)\]]\s*/, '') // 去掉开头的风格标签，跟读只要正文
  scriptPicker.value = false
}

// 双播放器同步重听：同时从 0 播放
async function playBoth() {
  if (!hasModel.value || !hasMine.value) return
  player.seek(0)
  myPlayer.seek(0)
  await player.toggle()
  await myPlayer.toggle()
}

onMounted(async () => {
  try {
    const s = await window.vc.settings.get()
    if (!s.hasApiKey) emit('need-key')
  } catch {
    /* IPC 不可用（如截图模式）不影响界面渲染 */
  }
})
onBeforeUnmount(() => recorder.cancel())
</script>

<template>
  <div class="vc-page follow-page">
    <!-- 选材料 -->
    <div class="vc-card">
      <h3 class="vc-card-title">
        跟读材料
        <span class="vc-spacer" />
        <el-button size="small" @click="scriptPicker = !scriptPicker">
          从文案模板选
        </el-button>
      </h3>
      <el-input
        v-model="text"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 8 }"
        maxlength="300"
        placeholder="输入要跟读的一两句话。语言学习可以输入外语句子和中文翻译对照。"
      />

      <div v-if="scriptPicker" class="script-grid">
        <button
          v-for="s in SCRIPT_TEMPLATES.slice(0, 12)"
          :key="s.id"
          class="script-chip"
          @click="applyScript(s)"
        >
          <span class="sc-name">{{ s.name }}</span>
          <span class="sc-scene">{{ s.scene }}</span>
        </button>
      </div>

      <div class="gen-row">
        <el-select v-model="voiceId" filterable style="width: 220px" size="small">
          <el-option v-for="v in PRESET_VOICES" :key="v.id" :value="v.id" :label="v.label" />
        </el-select>
        <el-input
          v-model="instruction"
          size="small"
          placeholder="示范风格指令（可选）：读慢一点，清晰一些"
          style="max-width: 260px"
        />
        <el-button type="primary" :loading="generating" @click="generateModel">
          生成示范音频
        </el-button>
      </div>
    </div>

    <!-- 对比区 -->
    <div v-if="hasModel || hasMine" class="compare-grid">
      <!-- 标准音频 -->
      <div class="vc-card" :class="{ dim: !hasModel }">
        <h3 class="vc-card-title">
          标准发音
          <span v-if="hasModel" class="vc-num vc-muted">{{ (modelBytes / 1024).toFixed(0) }} KB</span>
        </h3>
        <template v-if="hasModel">
          <Waveform
            :file-path="modelPath"
            :current-time="player.currentTime.value"
            :duration="player.duration.value"
            :height="56"
            :color="'#2b3a3d'"
            :progress-color="'#6fd3c7'"
          />
          <div class="play-row">
            <button class="mini-play" @click="player.toggle()">
              {{ player.playing.value ? '❚❚' : '▶' }}
            </button>
            <button class="mini-play replay" title="重听" @click="player.seek(0); player.toggle()">
              ↺
            </button>
          </div>
        </template>
        <p v-else class="vc-hint">先生成示范音频</p>
      </div>

      <!-- 我的录音 -->
      <div class="vc-card" :class="{ dim: !hasMine }">
        <h3 class="vc-card-title">
          我的跟读
          <span v-if="hasMine" class="vc-num vc-muted">{{ (myBytes / 1024).toFixed(0) }} KB</span>
        </h3>
        <template v-if="!recording && !hasMine">
          <div class="rec-cta">
            <el-button type="danger" size="large" :disabled="!hasModel" @click="startRec">
              ● 开始跟读录音
            </el-button>
            <p class="vc-hint">听完示范后点这里，念一遍你听到的内容</p>
          </div>
        </template>
        <template v-else-if="recording">
          <div class="rec-bar">
            <span class="rec-dot" />
            <span class="rec-text">录音中 {{ formatDuration(recorder.elapsed.value) }}</span>
            <div class="level-meter">
              <div class="level-fill" :style="{ width: Math.round(recorder.level.value * 100) + '%' }" />
            </div>
            <el-button size="small" type="danger" @click="stopRec">完成</el-button>
            <el-button size="small" @click="recorder.cancel()">放弃</el-button>
          </div>
        </template>
        <template v-else-if="hasMine">
          <Waveform
            :file-path="myPath"
            :current-time="myPlayer.currentTime.value"
            :duration="myPlayer.duration.value"
            :height="56"
          />
          <div class="play-row">
            <button class="mini-play" @click="myPlayer.toggle()">
              {{ myPlayer.playing.value ? '❚❚' : '▶' }}
            </button>
            <el-button size="small" @click="startRec">再录一遍</el-button>
          </div>
        </template>
      </div>
    </div>

    <!-- 同步对比播放 -->
    <div v-if="hasModel && hasMine" class="vc-card both-card">
      <el-button type="primary" plain style="width: 100%" @click="playBoth">
        同时播放对比（标准 + 我的）
      </el-button>
      <p class="vc-hint" style="text-align: center; margin-top: 8px">
        提示：也可以分别单放，用两侧的 ↺ 反复重听某一句。
      </p>
    </div>
  </div>
</template>

<style scoped>
.follow-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.script-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.script-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--vc-border);
  background: var(--vc-bg-elevated);
  color: var(--vc-text-secondary);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

.script-chip:hover {
  border-color: var(--vc-accent);
  color: var(--vc-accent);
}

.sc-name {
  font-weight: 550;
}

.sc-scene {
  font-size: 10.5px;
  color: var(--vc-text-muted);
}

.gen-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.compare-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  align-items: stretch;
}

.dim {
  opacity: 0.75;
}

.play-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.mini-play {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: var(--vc-scope);
  color: var(--vc-text-inverse);
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mini-play.replay {
  background: var(--vc-bg-hover);
  color: var(--vc-text-secondary);
}

.rec-cta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px 0;
}

.rec-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--vc-radius-sm);
  background: rgba(255, 112, 112, 0.08);
  border: 1px solid rgba(255, 112, 112, 0.28);
}

.rec-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vc-danger);
  flex-shrink: 0;
  animation: vc-pulse 1.2s ease-in-out infinite;
}

.rec-text {
  font-size: 12.5px;
  flex-shrink: 0;
}

.level-meter {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--vc-bg-input);
  overflow: hidden;
}

.level-fill {
  height: 100%;
  background: var(--vc-danger);
  transition: width 80ms linear;
}

.both-card {
  text-align: center;
}
</style>
