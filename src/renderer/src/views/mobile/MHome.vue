<script setup lang="ts">
/** 移动端合成页：选音色 + 输入文本 + 生成播放 */
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { PRESET_VOICES } from '../../../../shared/constants'
import type { VoiceAsset, AudioFormat } from '../../../../shared/types'
import { api, downloadBlob } from '../../platform'

const emit = defineEmits<{ (e: 'need-key'): void; (e: 'to-design'): void }>()

const text = ref('')
const instruction = ref('')
const voiceKey = ref('p:mimo_default')
const format = ref<AudioFormat>('wav')
const assets = ref<VoiceAsset[]>([])
const loading = ref(false)
const error = ref('')
const resultUrl = ref('')
const resultBytes = ref(0)
const elapsed = ref(0)
let audioEl: HTMLAudioElement | null = null
const playing = ref(false)

onMounted(async () => {
  const s = await api.settings.get()
  format.value = s.defaultFormat
  if (!s.hasApiKey) emit('need-key')
  assets.value = await api.voices.list()
})

const voiceOptions = computed(() => {
  const opts = PRESET_VOICES.map((v) => ({ key: `p:${v.id}`, label: v.label, group: '预置音色' }))
  for (const a of assets.value) {
    if (a.source === 'preset') continue
    opts.push({
      key: `a:${a.id}`,
      label: a.name,
      group: a.source === 'design' ? '设计音色' : '克隆音色',
    })
  }
  return opts
})

const groups = computed(() => {
  const g: Record<string, typeof voiceOptions.value> = {}
  for (const o of voiceOptions.value) (g[o.group] ||= []).push(o)
  return g
})

async function generate() {
  const body = text.value.trim()
  if (!body) {
    ElMessage.warning('请输入要合成的文字')
    return
  }
  loading.value = true
  error.value = ''
  resultUrl.value = ''
  const started = Date.now()
  try {
    const key = voiceKey.value
    let req: any
    if (key.startsWith('p:')) {
      req = {
        mode: 'preset',
        text: body,
        instruction: instruction.value.trim() || undefined,
        voiceId: key.slice(2),
        format: format.value,
      }
    } else {
      const asset = assets.value.find((a) => a.id === key.slice(2))
      if (!asset) throw new Error('音色不存在')
      if (asset.source === 'design') {
        req = {
          mode: 'design',
          text: body,
          designPrompt: asset.payload || asset.description,
          format: format.value,
        }
      } else {
        // 移动端没有本地文件路径，克隆需要把样本转成 data URI
        req = {
          mode: 'clone',
          text: body,
          instruction: instruction.value.trim() || undefined,
          format: format.value,
          cloneVoiceDataUri: asset.payload,
        }
      }
    }
    const res: any = await api.synth.run(req)
    if (res.ok) {
      resultUrl.value = res.blobUrl || res.filePath
      resultBytes.value = res.bytes || 0
      elapsed.value = Date.now() - started
      ElMessage.success('生成完成')
    } else {
      error.value = res.message || '生成失败'
    }
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

function togglePlay() {
  if (!resultUrl.value) return
  if (!audioEl) {
    audioEl = new Audio(resultUrl.value)
    audioEl.onended = () => (playing.value = false)
  }
  if (playing.value) {
    audioEl.pause()
    playing.value = false
  } else {
    audioEl.play()
    playing.value = true
  }
}

function saveFile() {
  if (!resultUrl.value) return
  downloadBlob(resultUrl.value, `voicecanvas-${Date.now()}.${format.value}`)
}
</script>

<template>
  <div>
    <div class="m-card">
      <h3 class="m-card-title">音色</h3>
      <el-select v-model="voiceKey" style="width: 100%">
        <el-option-group v-for="(opts, g) in groups" :key="g" :label="g">
          <el-option v-for="o in opts" :key="o.key" :value="o.key" :label="o.label" />
        </el-option-group>
      </el-select>
      <p style="font-size: 12px; color: var(--vc-text-muted); margin: 8px 0 0">
        没有合适的？<a style="color: var(--vc-accent)" @click="emit('to-design')">去设计一个</a>
      </p>
    </div>

    <div class="m-card">
      <h3 class="m-card-title">文本</h3>
      <el-input
        v-model="text"
        type="textarea"
        :rows="7"
        maxlength="800"
        show-word-limit
        placeholder="输入要合成的内容。可用 (温柔) 这类风格标签放在开头。"
      />
      <el-input
        v-model="instruction"
        placeholder="风格指令（可选）：语速稍慢，温柔一些"
        style="margin-top: 10px"
      />
    </div>

    <div class="m-card">
      <div style="display: flex; gap: 8px; align-items: center">
        <el-radio-group v-model="format" size="small">
          <el-radio-button value="wav">WAV</el-radio-button>
          <el-radio-button value="mp3">MP3</el-radio-button>
        </el-radio-group>
        <span v-if="resultBytes" style="font-size: 12px; color: var(--vc-text-muted)">
          {{ (resultBytes / 1024).toFixed(0) }} KB · {{ (elapsed / 1000).toFixed(1) }}s
        </span>
      </div>
      <el-button
        type="primary"
        size="large"
        style="width: 100%; margin-top: 12px"
        :loading="loading"
        @click="generate"
      >
        {{ loading ? '生成中…' : '生成语音' }}
      </el-button>
    </div>

    <div v-if="error" class="m-card" style="border-color: var(--vc-danger)">
      <p style="margin: 0; color: var(--vc-danger); font-size: 13px">{{ error }}</p>
    </div>

    <div v-if="resultUrl" class="m-card">
      <h3 class="m-card-title">结果</h3>
      <div style="display: flex; gap: 10px">
        <el-button type="primary" style="flex: 1" @click="togglePlay">
          {{ playing ? '暂停' : '播放' }}
        </el-button>
        <el-button style="flex: 1" @click="saveFile">保存</el-button>
      </div>
    </div>
  </div>
</template>
