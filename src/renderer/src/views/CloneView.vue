<script setup lang="ts">
/**
 * 音色克隆页（voiceclone 模式）
 *
 * 对应 API 事实（已实测）：
 * - 样本以 data:audio/wav;base64,... 形式塞进 audio.voice，服务端上限 10MB；
 *   base64 膨胀约 33%，所以原文件安全线取 7.5MB。
 * - clone 模式的 user 消息是「风格指令」，不是音色描述（描述由样本自身决定）。
 * - 不是真流式：流式参数会被忽略，服务端跑完一次性返回，通常十几秒。
 * - 不支持 (唱歌) 标签。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { AudioFormat, VoiceAsset } from '../../../shared/types'
import { CLONE_SAMPLE_MAX_BYTES } from '../../../shared/constants'
import { useSynth, FORMAT_OPTIONS } from '../composables/useSynth'
import { formatBytes } from '../composables/usePlayer'
import AudioPlayer from '../components/AudioPlayer.vue'

const emit = defineEmits<{ (e: 'need-key'): void }>()

type VoiceUpsertInput = Partial<VoiceAsset> & { name: string; source: VoiceAsset['source'] }

const { loading, error, result, runningMs, humanElapsed, run } = useSynth()

/** 主进程 file.openDialog('audio') 的真实返回结构 */
interface PickedFile {
  path: string
  name: string
  bytes: number
}

// ---------- 样本 ----------
const samplePath = ref('')
const sampleName = ref('')
const sampleBytes = ref(0)
const dragging = ref(false)
const sampleError = ref('')

const ACCEPT_EXT = ['.wav', '.mp3']
const MAX_LABEL = formatBytes(CLONE_SAMPLE_MAX_BYTES)

const hasSample = computed(() => !!samplePath.value)

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i).toLowerCase()
}

/** 统一的样本校验：扩展名 + 体积。返回 true 表示通过 */
function validateSample(name: string, bytes: number): boolean {
  const ext = extOf(name)
  if (!ACCEPT_EXT.includes(ext)) {
    sampleError.value = `不支持的格式「${ext || '未知'}」，音色样本仅支持 .wav / .mp3。`
    return false
  }
  if (bytes <= 0) {
    sampleError.value = '这个文件是空的，请换一个音频样本。'
    return false
  }
  if (bytes > CLONE_SAMPLE_MAX_BYTES) {
    const over = bytes - CLONE_SAMPLE_MAX_BYTES
    sampleError.value =
      `样本 ${formatBytes(bytes)}，超出 ${MAX_LABEL} 上限（多出 ${formatBytes(over)}）。` +
      '服务端限制 base64 后 10MB，编码后体积会膨胀约 33%，请先裁剪到 30 秒以内或转成码率更低的 MP3。'
    return false
  }
  sampleError.value = ''
  return true
}

function applySample(p: PickedFile) {
  samplePath.value = p.path
  sampleName.value = p.name
  sampleBytes.value = p.bytes
}

async function pickSample() {
  const picked = (await window.vc.file.openDialog('audio')) as PickedFile | null
  if (!picked) return
  if (!validateSample(picked.name, picked.bytes)) {
    ElMessage.error('该样本不满足要求，请看上方提示')
    return
  }
  applySample(picked)
  ElMessage.success(`已载入样本「${picked.name}」`)
}

/**
 * 拖拽落盘的路径获取。
 * Electron 32 起 File.path 被移除，官方的替代是 preload 里的 webUtils.getPathForFile()。
 * 本项目 preload 暂未暴露它，这里做一次兼容尝试；拿不到时引导用户走文件选择框，
 * 并仍然先把「格式 / 体积」校验结果反馈出来。
 */
function resolveDroppedPath(file: File): string {
  const legacy = (file as File & { path?: string }).path
  if (typeof legacy === 'string' && legacy) return legacy
  return ''
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  dragging.value = true
}

function onDragLeave() {
  dragging.value = false
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (!file) return

  if (!validateSample(file.name, file.size)) {
    ElMessage.error('该样本不满足要求，请看上传区提示')
    return
  }

  const p = resolveDroppedPath(file)
  if (!p) {
    sampleError.value =
      '文件已识别，但当前 Electron 版本不再向页面暴露拖拽文件的完整路径。请点击上传区用文件选择框选取同一个文件。'
    ElMessage.warning('请点击上传区选择文件（拖拽暂无法取得本地路径）')
    return
  }
  applySample({ path: p, name: file.name, bytes: file.size })
  ElMessage.success(`已载入样本「${file.name}」`)
}

function clearSample() {
  samplePath.value = ''
  sampleName.value = ''
  sampleBytes.value = 0
  sampleError.value = ''
}

// ---------- 表单 ----------
const instruction = ref('')
const text = ref('')
const format = ref<AudioFormat>('wav')
const hasKey = ref(true)

onMounted(async () => {
  try {
    const s = await window.vc.settings.get()
    hasKey.value = s.hasApiKey
    format.value = s.defaultFormat
  } catch {
    hasKey.value = false
  }
})

// ---------- 生成 ----------
const canGenerate = computed(
  () => hasSample.value && text.value.trim().length > 0 && !loading.value,
)

async function generate() {
  if (!samplePath.value) {
    ElMessage.warning('请先上传音色样本')
    return
  }
  if (!text.value.trim()) {
    ElMessage.warning('请填写要合成的文本')
    return
  }
  try {
    const s = await window.vc.settings.get()
    hasKey.value = s.hasApiKey
  } catch {
    hasKey.value = false
  }
  if (!hasKey.value) {
    ElMessage.warning('尚未配置 API Key，请先到设置页填写')
    emit('need-key')
    return
  }

  savedName.value = ''
  const res = await run({
    mode: 'clone',
    samplePath: samplePath.value,
    text: text.value.trim(),
    instruction: instruction.value.trim(),
    format: format.value,
  })
  if (res) {
    ElMessage.success(`克隆合成完成，耗时 ${(res.elapsedMs / 1000).toFixed(1)} 秒`)
  }
}

// ---------- 存为我的音色 ----------
const saveDialog = ref(false)
const voiceName = ref('')
const saving = ref(false)
const savedName = ref('')

function openSave() {
  if (!hasSample.value) return
  const base = sampleName.value.replace(/\.(wav|mp3)$/i, '')
  voiceName.value = `克隆音色 · ${base}`.slice(0, 40)
  saveDialog.value = true
}

async function confirmSave() {
  const name = voiceName.value.trim()
  if (!name) {
    ElMessage.warning('请给这个音色起个名字')
    return
  }
  saving.value = true
  try {
    const input: VoiceUpsertInput = {
      name,
      source: 'clone',
      // clone 音的 payload 存样本路径，之后在合成页选中它时直接复用
      payload: samplePath.value,
      samplePath: samplePath.value,
      sampleName: sampleName.value,
      sampleBytes: sampleBytes.value,
    }
    await window.vc.voices.upsert(input as VoiceAsset)
    savedName.value = name
    saveDialog.value = false
    ElMessage.success(`已存入「我的音色」：${name}`)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="vc-page clone-page">
    <!-- 顶部说明条 -->
    <div class="notice-bar">
      <div class="notice-mark">🧬</div>
      <div class="notice-body">
        <div class="notice-title">用一段录音，复刻一个人的音色</div>
        <p class="notice-text">上传 5～30 秒<b>干净的人声</b>作为样本，模型抽取音色特征后朗读你的文本。样本以 <code>data:audio/*;base64</code> 形式随请求发送，服务端上限 10MB（编码后），所以原文件不能超过 <b>{{ MAX_LABEL }}</b>。</p>
        <p class="notice-text">该模式<b>不支持 (唱歌)</b>；<b>没有真流式</b>——流式参数会被忽略，服务端跑完一次性返回，通常需要十几秒。</p>
      </div>
    </div>

    <div v-if="!hasKey" class="key-warn">
      <span>⚠ 还没有配置 API Key，生成会失败。</span>
      <el-button size="small" type="primary" plain @click="emit('need-key')">
        去设置页配置
      </el-button>
    </div>

    <div class="clone-grid">
      <!-- ================= 左栏：样本 ================= -->
      <div class="col">
        <section class="vc-card">
          <h3 class="vc-card-title">
            ① 音色样本
            <span class="req">必填</span>
          </h3>

          <!-- 拖拽区 -->
          <div
            class="drop-zone"
            :class="{ dragging, filled: hasSample }"
            @dragover="onDragOver"
            @dragenter.prevent="dragging = true"
            @dragleave="onDragLeave"
            @drop="onDrop"
            @click="pickSample"
          >
            <div v-if="!hasSample" class="drop-empty">
              <div class="drop-icon">🎧</div>
              <div class="drop-title">把 .wav / .mp3 拖到这里</div>
              <div class="drop-sub">或点击选择文件 · 单个样本不超过 {{ MAX_LABEL }}</div>
            </div>
            <div v-else class="drop-filled">
              <div class="drop-icon">🎵</div>
              <div class="file-meta">
                <div class="file-name" :title="sampleName">{{ sampleName }}</div>
                <div class="file-info vc-mono">
                  {{ formatBytes(sampleBytes) }} · {{ samplePath }}
                </div>
              </div>
            </div>
          </div>

          <div class="drop-actions">
            <el-button size="small" type="primary" plain @click="pickSample">
              选择文件…（系统对话框）
            </el-button>
            <el-button v-if="hasSample" size="small" type="danger" plain @click="clearSample">
              移除样本
            </el-button>
          </div>

          <p v-if="sampleError" class="sample-err">{{ sampleError }}</p>

          <div v-if="hasSample" class="sample-preview">
            <AudioPlayer
              :file-path="samplePath"
              :bytes="sampleBytes"
              title="样本试听"
              meta="正式合成前先确认这段人声干净、没有背景音乐"
            />
          </div>

          <ul class="sample-tips">
            <li>只保留<b>一个人的声音</b>，不要有第二个人说话或和声。</li>
            <li>尽量<b>去掉背景音乐和噪声</b>，混响过重会让克隆结果发闷。</li>
            <li>时长 5～30 秒最稳；过短特征不足，过长容易触发体积上限。</li>
            <li>样本里的情绪会成为默认基调，中性平静的片段通用性最好。</li>
          </ul>
        </section>

        <!-- 能力说明 -->
        <section class="vc-card">
          <h3 class="vc-card-title">克隆模式的边界</h3>
          <table class="cap-table">
            <tbody>
              <tr>
                <td>音色来源</td>
                <td>你上传的样本，<b>不能</b>再用文字描述改造</td>
              </tr>
              <tr>
                <td>唱歌 <code>(唱歌)</code></td>
                <td class="no">不支持</td>
              </tr>
              <tr>
                <td>流式输出</td>
                <td class="no">不支持（会降级为一次性返回）</td>
              </tr>
              <tr>
                <td>样本体积</td>
                <td>原文件 ≤ {{ MAX_LABEL }}</td>
              </tr>
              <tr>
                <td>典型耗时</td>
                <td>十几秒（比预置音色慢很多，属正常）</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <!-- ================= 右栏：合成 ================= -->
      <div class="col">
        <section class="vc-card">
          <h3 class="vc-card-title">② 风格指令（可选）</h3>
          <el-textarea
            v-model="instruction"
            :rows="3"
            :maxlength="500"
            resize="vertical"
            placeholder="例：语速稍慢一些，语气温和，句尾放轻。&#10;（这一栏会作为 user 消息发给模型；克隆模式里它不是音色描述，音色由样本决定）"
          />
          <p class="vc-hint">
            留空则完全按样本的原始听感朗读。这里只适合写<b>情绪、语速、语气</b>这类表演层面的指令。
          </p>
        </section>

        <section class="vc-card">
          <h3 class="vc-card-title">
            ③ 合成文本
            <span class="req">必填</span>
            <span class="vc-spacer" />
            <span class="count vc-mono">{{ text.length }} 字</span>
          </h3>
          <el-textarea
            v-model="text"
            :rows="9"
            :maxlength="3000"
            resize="vertical"
            placeholder="要让它读出来的内容。长文本会明显更慢，建议一次不超过 500 字，长稿分段生成。"
          />

          <div class="field">
            <label class="vc-label">输出格式</label>
            <el-radio-group v-model="format" size="small">
              <el-radio-button v-for="f in FORMAT_OPTIONS" :key="f.value" :value="f.value">
                {{ f.label }}
              </el-radio-button>
            </el-radio-group>
            <p class="vc-hint">{{ FORMAT_OPTIONS.find((f) => f.value === format)?.desc }}</p>
          </div>

          <el-button
            class="gen-btn"
            type="primary"
            :loading="loading"
            :disabled="!canGenerate && !loading"
            @click="generate"
          >
            {{ loading ? '正在克隆生成…' : '开始克隆合成' }}
          </el-button>

          <div v-if="loading" class="progress-box">
            <span class="spin" />
            <div class="progress-text">
              <div>正在克隆生成，可能需要十几秒…已等待 {{ (runningMs / 1000).toFixed(1) }}s</div>
              <div class="progress-sub">
                克隆模式没有真流式，音频会在服务端完成后一次性返回，进度条不会提前跳动，这是正常现象。
              </div>
            </div>
          </div>

          <div v-if="error" class="err-box">
            <div class="err-title">生成失败</div>
            <p class="err-msg vc-selectable">{{ error }}</p>
            <p class="vc-hint">
              常见原因：样本超过体积上限、样本不是有效音频、网络中断，或文本为空。
            </p>
          </div>
        </section>

        <section v-if="result" class="vc-card">
          <h3 class="vc-card-title">
            生成结果
            <span class="vc-tag vc-tag-warn">{{ humanElapsed }}</span>
            <span v-if="result.usage" class="vc-tag vc-tag-info">
              {{ result.usage.totalTokens }} tokens
            </span>
          </h3>

          <AudioPlayer
            :file-path="result.filePath"
            :bytes="result.bytes"
            title="克隆音色音频"
            :meta="`样本：${sampleName}`"
          />

          <div class="result-actions">
            <el-button type="primary" :disabled="!!savedName" @click="openSave">
              {{ savedName ? `已存为「${savedName}」` : '存为我的音色' }}
            </el-button>
            <el-button :loading="loading" :disabled="!canGenerate && !loading" @click="generate">
              再生成一版
            </el-button>
          </div>
          <p class="vc-hint">
            保存时会记下样本路径。若之后移动或删除了样本文件，该音色将无法再用于合成，需要重新上传。
          </p>
        </section>
      </div>
    </div>

    <p class="ethics">⚖️ 请确保你有权使用这段音频样本，并已取得声音本人的知情同意。禁止用于冒充他人、伪造身份、电信诈骗或任何违法用途。以他人声音生成内容可能侵犯声音权与人格权，相关法律责任由使用者自行承担。</p>

    <!-- 存为音色弹窗 -->
    <el-dialog v-model="saveDialog" title="存为我的音色" width="460px">
      <p class="vc-hint" style="margin-top: 0">
        保存样本路径与元信息，之后在「语音合成」页可直接选用，无需重复上传。
      </p>
      <label class="vc-label">音色名称</label>
      <el-input
        v-model="voiceName"
        maxlength="40"
        show-word-limit
        placeholder="给这个克隆音色起个名字"
        @keyup.enter="confirmSave"
      />
      <label class="vc-label" style="margin-top: 12px">样本</label>
      <div class="dialog-sample vc-mono">
        {{ sampleName }}（{{ formatBytes(sampleBytes) }}）
      </div>
      <template #footer>
        <el-button @click="saveDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="confirmSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.clone-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ---------- 顶部说明 ---------- */
.notice-bar {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  background: var(--vc-bg-panel);
  border: 1px solid var(--vc-border);
  border-left: 3px solid var(--vc-warning);
  border-radius: var(--vc-radius-md);
  padding: 14px 16px;
}

.notice-mark {
  font-size: 20px;
  line-height: 1.2;
}

.notice-body {
  min-width: 0;
}

.notice-title {
  font-size: 13.5px;
  font-weight: 650;
}

.notice-text {
  font-size: 12.5px;
  color: var(--vc-text-secondary);
  line-height: 1.75;
  margin: 6px 0 0;
}

.notice-text b {
  color: var(--vc-text-primary);
  font-weight: 600;
}

.notice-text code,
.cap-table code {
  font-family: var(--vc-font-mono);
  font-size: 11.5px;
  background: var(--vc-bg-input);
  border: 1px solid var(--vc-border);
  padding: 0 4px;
  border-radius: 3px;
  color: var(--vc-accent);
}

.key-warn {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12.5px;
  color: var(--vc-warning);
  background: var(--vc-bg-panel);
  border: 1px solid var(--vc-border);
  border-left: 3px solid var(--vc-warning);
  border-radius: var(--vc-radius-md);
  padding: 10px 14px;
}

/* ---------- 栅格 ---------- */
.clone-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

@media (max-width: 1180px) {
  .clone-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.req {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: none;
  color: var(--vc-warning);
}

.count {
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--vc-text-muted);
}

/* ---------- 上传区 ---------- */
.drop-zone {
  border: 1.5px dashed var(--vc-border-strong);
  border-radius: var(--vc-radius-md);
  background: var(--vc-bg-input);
  padding: 20px 16px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s,
    box-shadow 0.15s;
}

.drop-zone:hover {
  border-color: var(--vc-accent-dim);
}

.drop-zone.dragging {
  border-color: var(--vc-accent);
  background: var(--vc-accent-soft);
  box-shadow: 0 0 0 3px var(--vc-accent-soft);
}

.drop-zone.filled {
  border-style: solid;
  border-color: var(--vc-border);
}

.drop-empty {
  text-align: center;
}

.drop-icon {
  font-size: 26px;
  line-height: 1.2;
  margin-bottom: 6px;
}

.drop-title {
  font-size: 13px;
  font-weight: 600;
}

.drop-sub {
  font-size: 11.5px;
  color: var(--vc-text-muted);
  margin-top: 3px;
}

.drop-filled {
  display: flex;
  align-items: center;
  gap: 12px;
}

.file-meta {
  min-width: 0;
  flex: 1;
}

.file-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-info {
  font-size: 10.5px;
  color: var(--vc-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.drop-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.sample-err {
  font-size: 12px;
  color: var(--vc-danger);
  line-height: 1.65;
  margin: 10px 0 0;
  background: var(--vc-bg-input);
  border: 1px solid var(--vc-border);
  border-left: 2px solid var(--vc-danger);
  border-radius: var(--vc-radius-sm);
  padding: 8px 10px;
}

.sample-preview {
  margin-top: 14px;
  padding: 12px;
  background: var(--vc-bg-input);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-sm);
}

.sample-tips {
  margin: 14px 0 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--vc-text-secondary);
  line-height: 1.85;
}

.sample-tips b {
  color: var(--vc-text-primary);
}

/* ---------- 能力表 ---------- */
.cap-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.cap-table td {
  padding: 6px 0;
  border-bottom: 1px solid var(--vc-border);
  color: var(--vc-text-secondary);
  vertical-align: top;
}

.cap-table tr:last-child td {
  border-bottom: none;
}

.cap-table td:first-child {
  width: 110px;
  color: var(--vc-text-muted);
  white-space: nowrap;
}

.cap-table td.no {
  color: var(--vc-warning);
}

.cap-table b {
  color: var(--vc-text-primary);
}

/* ---------- 右栏 ---------- */
.field {
  margin-top: 14px;
}

.gen-btn {
  width: 100%;
  margin-top: 16px;
  height: 38px;
}

.progress-box {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--vc-warning);
  background: var(--vc-bg-input);
  border: 1px solid var(--vc-border);
  border-left: 2px solid var(--vc-warning);
  border-radius: var(--vc-radius-sm);
  padding: 9px 12px;
}

.progress-text {
  min-width: 0;
}

.progress-sub {
  font-size: 11px;
  color: var(--vc-text-muted);
  line-height: 1.6;
  margin-top: 3px;
}

.spin {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--vc-warning);
  border-top-color: transparent;
  animation: vc-spin 0.8s linear infinite;
  flex-shrink: 0;
  margin-top: 3px;
}

.err-box {
  margin-top: 12px;
  background: var(--vc-bg-input);
  border: 1px solid var(--vc-border);
  border-left: 3px solid var(--vc-danger);
  border-radius: var(--vc-radius-sm);
  padding: 10px 12px;
}

.err-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--vc-danger);
}

.err-msg {
  font-size: 12px;
  color: var(--vc-text-secondary);
  margin: 4px 0 0;
  line-height: 1.6;
  word-break: break-all;
}

.result-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

/* ---------- 伦理提示 ---------- */
.ethics {
  font-size: 11.5px;
  color: var(--vc-text-muted);
  line-height: 1.8;
  margin: 0;
  padding: 10px 14px;
  background: var(--vc-bg-panel);
  border: 1px solid var(--vc-border);
  border-left: 3px solid var(--vc-text-muted);
  border-radius: var(--vc-radius-sm);
}

.dialog-sample {
  font-size: 11.5px;
  color: var(--vc-text-secondary);
  background: var(--vc-bg-input);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-sm);
  padding: 8px 10px;
  word-break: break-all;
}
</style>
