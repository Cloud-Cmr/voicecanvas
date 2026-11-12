<script setup lang="ts">
/**
 * 语音合成页（左：正文 / 右：参数）。
 *
 * 关于模式的说明（重要）：
 * 主路径就是「预置音色」——选一个音色、贴正文、点生成。
 * 但音色下拉里也会列出「我的音色」中来源为设计 / 克隆的资产，方便直接复用：
 * 选中这类资产时，模式会自动切到 design / clone，请求参数也随之改变
 * （design 用资产里存的描述当 user 消息，clone 用资产里存的样本路径）。
 * 这样用户不必为了复用一个音色再跑去另一个页面重填一遍。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { AudioFormat, StylePreset, SynthRequest, TtsMode, VoiceAsset } from '../../../shared/types'
import { PRESET_VOICES } from '../../../shared/constants'
import { useSynth, FORMAT_OPTIONS, MODE_META } from '../composables/useSynth'
import { formatBytes } from '../composables/usePlayer'
import AudioPlayer from '../components/AudioPlayer.vue'
import AudioTagPanel from '../components/AudioTagPanel.vue'

const emit = defineEmits<{ (e: 'need-key'): void }>()

const synth = useSynth()
const { loading, error, result, receivedBytes, runningMs, humanElapsed, finalText } = synth

/* ---------------- 正文字段 ---------------- */

const text = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const instruction = ref('')

/* ---------------- 风格方案 ---------------- */

const styles = ref<StylePreset[]>([])
const saveStyleOpen = ref(false)
const styleName = ref('')
const styleNote = ref('')

async function loadStyles() {
  styles.value = await window.vc.styles.list()
}

async function saveStyleNow() {
  const name = styleName.value.trim()
  if (!name) {
    ElMessage.warning('给方案起个名字')
    return
  }
  const voiceLabel =
    voiceGroups.value.flatMap((g) => g.options).find((o) => o.value === selectedVoice.value)?.label ||
    selectedVoice.value
  await window.vc.styles.save({
    name,
    voiceKey: selectedVoice.value,
    voiceLabel,
    instruction: instruction.value.trim() || undefined,
    note: styleNote.value.trim() || undefined,
  })
  styleName.value = ''
  styleNote.value = ''
  saveStyleOpen.value = false
  await loadStyles()
  ElMessage.success(`方案「${name}」已保存`)
}

async function applyStyle(s: StylePreset) {
  // 找到对应音色并选中；找不到（已删）则只套指令
  const exists = voiceGroups.value.flatMap((g) => g.options).some((o) => o.value === s.voiceKey)
  if (exists) {
    selectedVoice.value = s.voiceKey
  } else {
    ElMessage.warning(`方案里的音色「${s.voiceLabel}」已不存在，只套用风格指令`)
  }
  instruction.value = s.instruction || ''
}

async function removeStyleById(id: string) {
  await window.vc.styles.remove(id)
  await loadStyles()
}
const format = ref<AudioFormat>('wav')
const stream = ref(false)

const charCount = computed(() => text.value.length)
/** 中文按字数，英文按词数估算，只作为"大概要念多久"的参考 */
const estSeconds = computed(() => Math.max(0, Math.round(text.value.length / 4.2)))

const singingUsed = computed(() => /[(（]\s*唱歌\s*[)）]/.test(text.value))

async function pasteFromClipboard(): Promise<void> {
  try {
    const t = await navigator.clipboard.readText()
    if (!t.trim()) {
      ElMessage.warning('剪贴板里没有可用的文本')
      return
    }
    insertAtCursor(t)
    ElMessage.success(`已粘贴 ${t.length} 个字符`)
  } catch {
    ElMessage.error('读取剪贴板失败，请用 Ctrl+V 手动粘贴')
  }
}

function clearText(): void {
  text.value = ''
  nextTick(() => textareaRef.value?.focus())
}

/** 在光标处插入文本（标签面板与粘贴共用） */
function insertAtCursor(piece: string): void {
  const el = textareaRef.value
  if (!el) {
    text.value += piece
    return
  }
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  const before = text.value.slice(0, start)
  const after = text.value.slice(end)
  text.value = before + piece + after
  nextTick(() => {
    const caret = start + piece.length
    el.focus()
    el.setSelectionRange(caret, caret)
  })
}

function onTagInsert(tag: string): void {
  insertAtCursor(tag)
}

/* ---------------- 音色选项 ---------------- */

interface VoiceOption {
  value: string
  label: string
  /** 展示在下拉项右侧的补充信息 */
  hint: string
}

interface VoiceGroup {
  label: string
  options: VoiceOption[]
}

const assets = ref<VoiceAsset[]>([])
const selectedVoice = ref<string>('p:mimo_default')

const myAssets = computed(() => assets.value.filter((a) => a.source !== 'preset'))

const voiceGroups = computed<VoiceGroup[]>(() => {
  const groups: VoiceGroup[] = [
    {
      label: '预置音色',
      options: PRESET_VOICES.map((v) => ({
        value: `p:${v.id}`,
        label: v.label,
        hint: v.lang === 'zh' ? '中文' : '英文',
      })),
    },
  ]
  const designs = myAssets.value.filter((a) => a.source === 'design')
  const clones = myAssets.value.filter((a) => a.source === 'clone')
  if (designs.length) {
    groups.push({
      label: '我的音色 · 设计',
      options: designs.map((a) => ({
        value: `a:${a.id}`,
        label: a.name,
        hint: '设计',
      })),
    })
  }
  if (clones.length) {
    groups.push({
      label: '我的音色 · 克隆',
      options: clones.map((a) => ({
        value: `a:${a.id}`,
        label: a.name,
        hint: '克隆',
      })),
    })
  }
  return groups
})

const selectedAsset = computed<VoiceAsset | null>(() => {
  if (!selectedVoice.value.startsWith('a:')) return null
  const id = selectedVoice.value.slice(2)
  return assets.value.find((a) => a.id === id) ?? null
})

/** 当前请求模式：预置 → preset，设计资产 → design，克隆资产 → clone */
const mode = computed<TtsMode>(() => {
  const a = selectedAsset.value
  if (!a) return 'preset'
  return a.source === 'design' ? 'design' : 'clone'
})

const modeMeta = computed(() => MODE_META[mode.value])

/** 流式只有预置音色真流式；设计与克隆在服务端是"跑完一次性吐" */
const canStream = computed(() => mode.value === 'preset')

const streamHint = computed(() =>
  canStream.value
    ? '流式会在音频边生成边播放，首字节更快；生成的仍是一个完整文件。'
    : '流式仅预置音色支持：设计与克隆模式在服务端不能真流式，只能等整段合成完毕。',
)

/** 设计模式下 user 消息被音色描述占用，风格指令不生效 */
const instructionDisabled = computed(() => mode.value === 'design')

const instructionHint = computed(() =>
  instructionDisabled.value
    ? '音色设计模式下，user 消息就是音色描述本身，风格指令不会生效。'
    : '风格指令会作为 user 消息发送，留空则只发正文。',
)

const presetVoiceId = computed(() => {
  const v = selectedVoice.value
  if (!v.startsWith('p:')) return 'mimo_default'
  return v.slice(2) || 'mimo_default'
})

watch(mode, () => {
  if (!canStream.value) stream.value = false
})

/* ---------------- API Key ---------------- */

const hasApiKey = ref(true)

async function refreshKeyState(): Promise<boolean> {
  try {
    const s = await window.vc.settings.get()
    hasApiKey.value = s.hasApiKey
    if (s.defaultFormat === 'mp3' || s.defaultFormat === 'wav') {
      format.value = s.defaultFormat
    }
    return s.hasApiKey
  } catch {
    hasApiKey.value = false
    return false
  }
}

/* ---------------- 生成 ---------------- */

/** 已生成过的参数快照，用于「重新生成」时确认用户确实想重跑 */
const lastRunAt = ref(0)

function buildRequest(): SynthRequest | null {
  const body = text.value.trim()

  if (!body) {
    ElMessage.warning('请先填写要合成的正文')
    return null
  }

  if (mode.value === 'preset') {
    return {
      mode: 'preset',
      text: body,
      instruction: instruction.value.trim() || undefined,
      voiceId: presetVoiceId.value,
      format: format.value,
      stream: canStream.value && stream.value,
    }
  }

  const asset = selectedAsset.value
  if (!asset) {
    ElMessage.warning('音色资产已失效，请重新选择')
    return null
  }

  if (asset.source === 'design') {
    const prompt = (asset.payload || asset.description || '').trim()
    if (!prompt) {
      ElMessage.warning('这个设计音色没有保存描述，无法复用，请到「音色设计」页重新设计')
      return null
    }
    return {
      mode: 'design',
      text: body,
      designPrompt: prompt,
      format: format.value,
    }
  }

  if (!asset.samplePath) {
    ElMessage.warning('这个克隆音色没有样本文件路径，请到「音色克隆」页重新创建')
    return null
  }
  return {
    mode: 'clone',
    text: body,
    instruction: instruction.value.trim() || undefined,
    samplePath: asset.samplePath,
    format: format.value,
  }
}

async function generate(): Promise<void> {
  if (loading.value) return
  const ok = hasApiKey.value ? true : await refreshKeyState()
  if (!ok) {
    ElMessage.warning('尚未配置 API Key，先到设置页填一个')
    emit('need-key')
    return
  }
  const req = buildRequest()
  if (!req) return
  lastRunAt.value = Date.now()

  // 长文本模式：按句切分逐段合成再拼接（仅 wav；mp3 拼接需 ffmpeg，暂不支持）
  const body = text.value.trim()
  if (longMode.value && body.length > 120) {
    if (format.value !== 'wav') {
      ElMessage.warning('长文拼接当前仅支持 WAV 输出，已临时切换')
      format.value = 'wav'
    }
    if (req.mode === 'preset' && req.stream) req.stream = false
    await runLong(req, body)
    return
  }

  await synth.run(req)
  if (result.value) ElMessage.success('合成完成')
}

/* ---------------- 长文本分段合成 ---------------- */

const longMode = ref(false)
const longIndex = ref(0)
const longTotal = ref(0)
let offLongProgress: (() => void) | null = null

/** 按句子切分（。！？；…\n 收口），超长句再按逗号二切，单段目标 ≤ 200 字 */
function splitSentences(body: string): string[] {
  const raw = body
    .replace(/\r\n/g, '\n')
    .split(/(?<=[。！？；…\n])/)
    .map((s) => s.trim())
    .filter(Boolean)
  const out: string[] = []
  for (const s of raw) {
    if (s.length <= 200) {
      out.push(s)
      continue
    }
    // 超长句按逗号/顿号聚合到 ~200 字
    let buf = ''
    for (const piece of s.split(/(?<=[，,、])/)) {
      if ((buf + piece).length > 200 && buf) {
        out.push(buf.trim())
        buf = piece
      } else {
        buf += piece
      }
    }
    if (buf.trim()) out.push(buf.trim())
  }
  return out
}

async function runLong(req: SynthRequest, body: string): Promise<void> {
  const segments = splitSentences(body)
  longTotal.value = segments.length
  longIndex.value = 0
  loading.value = true
  error.value = null
  try {
    const res = await window.vc.synth.runLong(req, segments)
    if (res.ok) {
      result.value = res
      ElMessage.success(`长文合成完成，共 ${res.segments} 段已拼接`)
    } else {
      error.value = res.message
      ElMessage.error(res.message)
    }
  } catch (e: any) {
    error.value = e?.message || String(e)
    ElMessage.error(error.value || '长文合成失败')
  } finally {
    loading.value = false
    longTotal.value = 0
    longIndex.value = 0
  }
}

const resultMeta = computed(() => {
  const r = result.value
  if (!r) return ''
  const parts = [`耗时 ${(r.elapsedMs / 1000).toFixed(1)}s`]
  if (r.firstByteMs) parts.push(`首字节 ${(r.firstByteMs / 1000).toFixed(1)}s`)
  if (r.usage) parts.push(`${r.usage.totalTokens} tokens`)
  return parts.join(' · ')
})

const progressText = computed(() => {
  if (!loading.value) return ''
  const kb = receivedBytes.value > 0 ? ` · 已接收 ${formatBytes(receivedBytes.value)}` : ''
  return `正在生成… 已用 ${(runningMs.value / 1000).toFixed(1)}s${kb}`
})

const showSlowHint = computed(() => canStream.value && stream.value)

/* ---------------- 初始化 ---------------- */

onMounted(async () => {
  await refreshKeyState()
  await loadAssets()
  await loadStyles()
  applyPendingVoice()
})

async function loadAssets(): Promise<void> {
  try {
    assets.value = await window.vc.voices.list()
  } catch {
    assets.value = []
  }
}

/**
 * 「我的音色」页点『使用』时会写下待选音色，这里在挂载后接上，
 * 让跨页跳转后仍然停在用户刚选的那个音色上。
 */
function applyPendingVoice(): void {
  try {
    const raw = localStorage.getItem('vc.pendingVoice')
    if (!raw) return
    localStorage.removeItem('vc.pendingVoice')
    const parsed = JSON.parse(raw) as { kind: 'preset' | 'asset'; id: string }
    const value = parsed.kind === 'preset' ? `p:${parsed.id}` : `a:${parsed.id}`
    const exists = voiceGroups.value.some((g) => g.options.some((o) => o.value === value))
    if (exists) selectedVoice.value = value
  } catch {
    /* 本地缓存被写坏时忽略，回落到默认音色 */
  }
}
</script>

<template>
  <div class="vc-page synth-page">
    <div class="synth-grid">
      <!-- 左栏：正文 -->
      <section class="vc-card editor-card">
        <h3 class="vc-card-title">
          合成正文
          <span class="vc-muted">· 会作为 assistant 消息发送</span>
        </h3>

        <textarea
          ref="textareaRef"
          v-model="text"
          class="synth-textarea"
          spellcheck="false"
          placeholder="在这里输入要念的内容。可用 (唱歌) 这类风格标签放在开头，[叹气] 这类细粒度标签插在任意位置。"
        />

        <div class="editor-foot">
          <span class="counter vc-muted">
            {{ charCount }} 字
            <template v-if="charCount > 0">· 约 {{ estSeconds }} 秒音频</template>
          </span>
          <span class="vc-spacer" />
          <el-button size="small" @click="pasteFromClipboard">粘贴</el-button>
          <el-button size="small" :disabled="!text" @click="clearText">清空</el-button>
        </div>

        <div v-if="singingUsed" class="notice notice-warn">
          检测到 <code>(唱歌)</code> 标签：唱歌模式合成明显更慢（实测 9 秒以上），
          请耐心等待，期间不要离开本页。
        </div>

        <div class="vc-divider" />

        <AudioTagPanel :mode="mode" @insert="onTagInsert" />
      </section>

      <!-- 右栏：参数 -->
      <section class="side-col">
        <div class="vc-card">
          <h3 class="vc-card-title">参数</h3>

          <label class="vc-label">音色</label>
          <el-select v-model="selectedVoice" filterable placeholder="选择音色" class="w-full">
            <el-option-group v-for="g in voiceGroups" :key="g.label" :label="g.label">
              <el-option
                v-for="o in g.options"
                :key="o.value"
                :label="o.label"
                :value="o.value"
              >
                <div class="opt-row">
                  <span>{{ o.label }}</span>
                  <span class="opt-hint">{{ o.hint }}</span>
                </div>
              </el-option>
            </el-option-group>
          </el-select>
          <p class="vc-hint">
            当前模式：<span :class="modeMeta.tag">{{ modeMeta.label }}</span>
          </p>

          <label class="vc-label">
            风格指令（可空）
            <span class="vc-spacer" style="display: inline-flex; flex: 1" />
            <el-button link size="small" @click="saveStyleOpen = true">存为方案</el-button>
          </label>
          <el-input
            v-model="instruction"
            :disabled="instructionDisabled"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="例如：语速稍慢，语气温柔一些"
          />

          <!-- 风格方案快捷条 -->
          <div v-if="styles.length" class="style-strip">
            <button
              v-for="s in styles.slice(0, 6)"
              :key="s.id"
              class="style-chip"
              :title="`${s.voiceLabel}${s.instruction ? '：' + s.instruction : ''}`"
              @click="applyStyle(s)"
            >
              {{ s.name }}
            </button>
          </div>
          <p class="vc-hint">{{ instructionHint }}</p>

          <label class="vc-label">输出格式</label>
          <el-radio-group v-model="format" size="small">
            <el-radio-button v-for="f in FORMAT_OPTIONS" :key="f.value" :value="f.value">
              {{ f.label }}
            </el-radio-button>
          </el-radio-group>
          <p class="vc-hint">
            {{ FORMAT_OPTIONS.find((f) => f.value === format)?.desc }}
          </p>

          <div class="stream-row">
            <div>
              <div class="stream-title">长文模式</div>
              <p class="vc-hint" style="margin: 0">
                超过一屏的文章自动按句切段、逐段合成、无缝拼接成一个 WAV（段间 300ms 停顿），适合有声书、播客长稿。
              </p>
            </div>
            <el-switch v-model="longMode" :disabled="loading" />
          </div>

          <div class="stream-row">
            <div>
              <div class="stream-title">流式生成</div>
              <p class="vc-hint" style="margin: 0">{{ streamHint }}</p>
            </div>
            <el-switch v-model="stream" :disabled="!canStream || loading || longMode" />
          </div>

          <el-button
            class="gen-btn"
            type="primary"
            size="large"
            :loading="loading"
            @click="generate"
          >
            {{ loading ? '生成中…' : '开始生成' }}
          </el-button>

          <p v-if="showSlowHint" class="vc-hint">
            流式下服务端首字节通常在 1 秒内返回，整段仍要等合成结束。
          </p>

          <p v-if="!hasApiKey" class="key-warn">
            还没有配置 API Key。
            <a class="link" @click="emit('need-key')">去设置页配置</a>
          </p>
        </div>

        <!-- 进行中 -->
        <div v-if="loading" class="vc-card state-card">
          <div class="state-title vc-pulsing">正在合成…</div>
          <p class="vc-hint" style="margin: 0">{{ progressText }}</p>
          <div class="bar"><div class="bar-inner" /></div>
        </div>

        <!-- 错误 -->
        <div v-if="error" class="vc-card error-card">
          <div class="state-title">合成失败</div>
          <p class="err-msg">{{ error }}</p>
          <el-button size="small" @click="generate">重试</el-button>
        </div>

        <!-- 结果 -->
        <div v-if="result" class="vc-card result-card">
          <h3 class="vc-card-title">生成结果</h3>
          <AudioPlayer
            :file-path="result.filePath"
            :bytes="result.bytes"
            title="刚刚生成的音频"
            :meta="resultMeta"
          />
          <div class="result-foot">
            <span class="vc-muted vc-mono">耗时 {{ result.elapsedMs }} ms</span>
            <span v-if="result.usage" class="vc-muted vc-mono">
              · {{ result.usage.totalTokens }} tokens（输入
              {{ result.usage.promptTokens }}／输出
              {{ result.usage.completionTokens }}）
            </span>
          </div>
          <p v-if="finalText" class="final-text">
            <span class="vc-muted">服务端实际念的文本：</span>{{ finalText }}
          </p>
          <el-button size="small" :disabled="loading" @click="generate">重新生成</el-button>
          <span v-if="lastRunAt" class="vc-hint" style="margin-left: 8px">
            用同样的参数再跑一次
          </span>
        </div>
      </section>
    </div>

    <!-- 保存风格方案 -->
    <el-dialog v-model="saveStyleOpen" title="保存为风格方案" width="440px">
      <label class="vc-label">方案名</label>
      <el-input v-model="styleName" maxlength="20" placeholder="例如：晚安电台" />
      <label class="vc-label" style="margin-top: 12px">备注（可空）</label>
      <el-input v-model="styleNote" maxlength="60" placeholder="这个方案适合什么场景" />
      <p class="vc-hint" style="margin-top: 10px">
        将保存：音色「{{
          voiceGroups.flatMap((g) => g.options).find((o) => o.value === selectedVoice)?.label ||
          selectedVoice
        }}」+ 当前风格指令。
      </p>
      <template #footer>
        <el-button @click="saveStyleOpen = false">取消</el-button>
        <el-button type="primary" @click="saveStyleNow">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.synth-page {
  /* 页面自身滚动由 .vc-page 负责 */
}

.synth-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: var(--vc-gap-md);
  align-items: start;
}

@media (max-width: 1180px) {
  .synth-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.editor-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 520px;
}

.synth-textarea {
  width: 100%;
  min-height: 300px;
  flex: 1;
  resize: vertical;
  padding: 12px 14px;
  background: var(--vc-bg-input);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-sm);
  color: var(--vc-text-primary);
  font-family: var(--vc-font);
  font-size: 14px;
  line-height: 1.8;
  outline: none;
  transition: border-color 0.15s;
}

.synth-textarea::placeholder {
  color: var(--vc-text-muted);
}

.synth-textarea:hover {
  border-color: var(--vc-border-strong);
}

.synth-textarea:focus {
  border-color: var(--vc-accent);
  box-shadow: 0 0 0 3px var(--vc-accent-soft);
}

.editor-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.counter {
  font-size: 12px;
}

.notice {
  padding: 8px 10px;
  border-radius: var(--vc-radius-sm);
  font-size: 12px;
  line-height: 1.6;
  border: 1px solid transparent;
}

.notice-warn {
  background: color-mix(in srgb, var(--vc-warning) 12%, transparent);
  border-color: color-mix(in srgb, var(--vc-warning) 30%, transparent);
  color: var(--vc-warning);
}

.notice code {
  font-family: var(--vc-font-mono);
  background: var(--vc-bg-input);
  padding: 1px 4px;
  border-radius: 3px;
}

.side-col {
  display: flex;
  flex-direction: column;
  gap: var(--vc-gap-md);
  min-width: 0;
}

.w-full {
  width: 100%;
}

.opt-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.opt-hint {
  font-size: 12px;
  color: var(--vc-text-muted);
}

.stream-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin: var(--vc-gap-md) 0;
  padding: 10px;
  background: var(--vc-bg-input);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-sm);
}

.stream-row > div:first-child {
  flex: 1;
  min-width: 0;
}

.stream-title {
  font-size: 12.5px;
  font-weight: 600;
  margin-bottom: 2px;
}

.gen-btn {
  width: 100%;
}

.key-warn {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--vc-warning);
}

.link {
  color: var(--vc-accent);
  cursor: pointer;
  text-decoration: underline;
}

.state-card {
  border-color: color-mix(in srgb, var(--vc-accent) 30%, var(--vc-border));
}

.state-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}

.bar {
  height: 4px;
  border-radius: 2px;
  background: var(--vc-bg-input);
  overflow: hidden;
  margin-top: 10px;
}

.bar-inner {
  height: 100%;
  width: 40%;
  background: var(--vc-accent);
  border-radius: 2px;
  animation: vc-slide 1.2s ease-in-out infinite;
}

@keyframes vc-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(250%);
  }
}

.error-card {
  border-color: color-mix(in srgb, var(--vc-danger) 45%, var(--vc-border));
  background: color-mix(in srgb, var(--vc-danger) 8%, var(--vc-bg-panel));
}

.error-card .state-title {
  color: var(--vc-danger);
}

.err-msg {
  margin: 0 0 10px;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--vc-text-secondary);
  word-break: break-word;
  user-select: text;
}

.result-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 12px;
  margin-top: 10px;
}

.final-text {
  margin: 10px 0;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.7;
  background: var(--vc-bg-input);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-sm);
  color: var(--vc-text-secondary);
  user-select: text;
}

/* ---------- 风格方案快捷条 ---------- */
.style-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}

.style-chip {
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--vc-border);
  background: var(--vc-bg-elevated);
  color: var(--vc-text-secondary);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  transition:
    border-color var(--vc-dur-fast) var(--vc-ease),
    color var(--vc-dur-fast) var(--vc-ease),
    background-color var(--vc-dur-fast) var(--vc-ease);
}

.style-chip:hover {
  border-color: var(--vc-accent);
  color: var(--vc-accent);
  background: var(--vc-accent-soft);
}</style>
