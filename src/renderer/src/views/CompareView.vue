<script setup lang="ts">
/**
 * 音色对比页：同一段文本 × 多个音色，一次跑完并排试听。
 *
 * 场景：拿到一段台词，想听 5 个音色哪个最合适——不用来回切页面。
 */
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { PRESET_VOICES } from '../../../shared/constants'
import type { VoiceAsset, SynthResponse } from '../../../shared/types'
import { useSynth } from '../composables/useSynth'

const emit = defineEmits<{ (e: 'need-key'): void }>()

interface CompareItem {
  key: string
  label: string
  status: 'pending' | 'running' | 'done' | 'failed'
  filePath?: string
  bytes?: number
  elapsedMs?: number
  error?: string
}

const text = ref('')
const instruction = ref('')
const assets = ref<VoiceAsset[]>([])
const items = ref<CompareItem[]>([])
const running = ref(false)
const currentIdx = ref(0)

const voiceOptions = computed(() => {
  const opts: Array<{ key: string; label: string; group: string }> = PRESET_VOICES.map((v) => ({
    key: `p:${v.id}`,
    label: v.label,
    group: '预置音色',
  }))
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

/** 已勾选要对比的音色 */
const selected = ref<string[]>(['p:mimo_default'])

onMounted(async () => {
  const s = await window.vc.settings.get()
  if (!s.hasApiKey) emit('need-key')
  assets.value = await window.vc.voices.list()
})

function labelOf(key: string): string {
  return voiceOptions.value.find((o) => o.key === key)?.label || key
}

/** 模板里不能直接访问 window，包一层 */
function mediaUrl(p: string): string {
  return window.vc.file.toMediaUrl(p)
}

async function runCompare() {
  if (!text.value.trim()) {
    ElMessage.warning('请先输入要比对的文本')
    return
  }
  if (selected.value.length < 2) {
    ElMessage.warning('至少选两个音色才有对比意义')
    return
  }
  running.value = true
  items.value = selected.value.map((k) => ({
    key: k,
    label: labelOf(k),
    status: 'pending' as const,
  }))

  // 串行跑，避免并发限流
  for (let i = 0; i < items.value.length; i++) {
    currentIdx.value = i
    const it = items.value[i]
    it.status = 'running'
    try {
      let req: any
      if (it.key.startsWith('p:')) {
        req = {
          mode: 'preset',
          text: text.value.trim(),
          instruction: instruction.value.trim() || undefined,
          voiceId: it.key.slice(2),
          format: 'wav',
        }
      } else {
        const asset = assets.value.find((a) => a.id === it.key.slice(2))
        if (!asset) throw new Error('音色不存在')
        if (asset.source === 'design') {
          req = {
            mode: 'design',
            text: text.value.trim(),
            designPrompt: asset.payload || asset.description,
            format: 'wav',
          }
        } else {
          req = {
            mode: 'clone',
            text: text.value.trim(),
            instruction: instruction.value.trim() || undefined,
            samplePath: asset.samplePath,
            format: 'wav',
          }
        }
      }
      const res: SynthResponse = await window.vc.synth.run(req)
      if (res.ok) {
        it.status = 'done'
        it.filePath = res.filePath
        it.bytes = res.bytes
        it.elapsedMs = res.elapsedMs
      } else {
        it.status = 'failed'
        it.error = res.message
      }
    } catch (e: any) {
      it.status = 'failed'
      it.error = e?.message || String(e)
    }
  }

  running.value = false
  const ok = items.value.filter((i) => i.status === 'done').length
  ElMessage.success(`对比完成：${ok}/${items.value.length} 个音色成功`)
}

const doneCount = computed(() => items.value.filter((i) => i.status === 'done').length)
</script>

<template>
  <div class="vc-page compare-page">
    <div class="cmp-grid">
      <section class="vc-card">
        <h3 class="vc-card-title">比对文本</h3>
        <el-input
          v-model="text"
          type="textarea"
          :autosize="{ minRows: 8, maxRows: 16 }"
          maxlength="500"
          show-word-limit
          placeholder="用同一段文本听不同音色的差别。建议用你实际要配的台词。"
        />
        <label class="vc-label" style="margin-top: 12px">风格指令（可选，对所有音色生效）</label>
        <el-input v-model="instruction" placeholder="例：语速稍慢，温柔一些" />
      </section>

      <section class="vc-card">
        <h3 class="vc-card-title">选择要对比的音色</h3>
        <el-checkbox-group v-model="selected" class="voice-picker">
          <div v-for="(opts, g) in groups" :key="g" class="pick-group">
            <div class="pick-group-label">{{ g }}</div>
            <el-checkbox v-for="o in opts" :key="o.key" :value="o.key" :label="o.label" />
          </div>
        </el-checkbox-group>

        <p class="vc-hint">已选 {{ selected.length }} 个，至少 2 个才能对比。</p>

        <el-button
          type="primary"
          size="large"
          class="go-btn"
          :loading="running"
          :disabled="!text.trim() || selected.length < 2"
          @click="runCompare"
        >
          {{
            running
              ? `生成中 ${currentIdx + 1}/${items.length}`
              : `开始对比（${selected.length} 个音色）`
          }}
        </el-button>
      </section>
    </div>

    <section v-if="items.length" class="vc-card">
      <h3 class="vc-card-title">
        对比结果
        <span class="vc-num vc-muted">{{ doneCount }}/{{ items.length }}</span>
      </h3>
      <div class="result-list">
        <div v-for="it in items" :key="it.key" class="result-row" :class="it.status">
          <div class="result-head">
            <span class="result-name">{{ it.label }}</span>
            <span class="result-meta vc-mono vc-num">
              <template v-if="it.status === 'done'">
                {{ ((it.bytes || 0) / 1024).toFixed(0) }} KB · {{ ((it.elapsedMs || 0) / 1000).toFixed(1) }}s
              </template>
              <template v-else-if="it.status === 'running'">生成中…</template>
              <template v-else-if="it.status === 'failed'">
                <span class="err">{{ it.error }}</span>
              </template>
            </span>
          </div>
          <audio v-if="it.filePath" :src="mediaUrl(it.filePath)" controls class="result-audio" />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.cmp-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 16px;
  align-items: start;
  margin-bottom: 16px;
}

.voice-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 340px;
  overflow-y: auto;
  padding-right: 4px;
}

.pick-group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  align-items: center;
}

.pick-group-label {
  width: 100%;
  font-size: 11.5px;
  color: var(--vc-text-muted);
  margin-bottom: 4px;
  line-height: 1.4;
}

.go-btn {
  width: 100%;
  margin-top: 12px;
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.result-row {
  padding: 10px 12px;
  border-radius: var(--vc-radius-sm);
  border: 1px solid var(--vc-border);
  background: var(--vc-bg-input);
}

.result-row.failed {
  border-color: rgba(240, 115, 110, 0.3);
}

.result-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.result-name {
  font-size: 13.5px;
  font-weight: 600;
}

.result-meta {
  font-size: 11.5px;
  color: var(--vc-text-muted);
}

.result-meta .err {
  color: var(--vc-danger);
}

.result-audio {
  width: 100%;
  height: 34px;
}
</style>
