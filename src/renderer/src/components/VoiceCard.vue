<script setup lang="ts">
/**
 * 音色卡片：「我的音色」页的展示单元。
 *
 * 刻意保持"哑组件"：只渲染 + 上报事件，重命名弹窗、删除确认都交给父页面，
 * 避免卡片里再套一层 el-dialog 造成多实例与焦点混乱。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { VoiceAsset } from '../../../shared/types'
import { MODE_META } from '../composables/useSynth'
import { formatBytes } from '../composables/usePlayer'

const props = defineProps<{ voice: VoiceAsset }>()

const emit = defineEmits<{
  (e: 'use', voice: VoiceAsset): void
  (e: 'rename', voice: VoiceAsset): void
  (e: 'remove', voice: VoiceAsset): void
}>()

/** 名称首字，作为卡片头像占位（不依赖图标库） */
const initial = computed(() => (props.voice.name || '音').slice(0, 1))

const sourceMeta = computed(() => MODE_META[props.voice.source])

/** 预置音色来自内置常量表，不是用户资产，不允许改名/删除 */
const isBuiltin = computed(() => props.voice.source === 'preset')

const createdText = computed(() =>
  props.voice.createdAt ? formatDateTime(props.voice.createdAt) : '内置音色',
)

function formatDateTime(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 卡片正文的一句话说明，按来源给不同信息 */
const descText = computed(() => {
  const v = props.voice
  if (v.source === 'clone') {
    const name = v.sampleName || (v.samplePath ? v.samplePath.split(/[\\/]/).pop() : '')
    const size = v.sampleBytes ? ` · ${formatBytes(v.sampleBytes)}` : ''
    return name ? `样本：${name}${size}` : '样本文件缺失，可能已被移动或删除'
  }
  if (v.source === 'design') {
    const d = (v.description || v.payload || '').trim()
    return d ? `描述：${d}` : '暂无描述'
  }
  return `音色 ID：${v.payload || 'mimo_default'}`
})

/** 只有克隆音色带本地样本，才提供试听 */
const canPreview = computed(() => {
  const v = props.voice
  return v.source === 'clone' && !!v.samplePath
})

const samplePlaying = ref(false)
let sampleAudio: HTMLAudioElement | null = null

async function toggleSample(): Promise<void> {
  const p = props.voice.samplePath
  if (!p) return
  if (!sampleAudio) {
    const el = new Audio(window.vc.file.toMediaUrl(p))
    el.preload = 'auto'
    el.addEventListener('ended', () => {
      samplePlaying.value = false
    })
    el.addEventListener('error', () => {
      samplePlaying.value = false
      ElMessage.error('样本无法播放，文件可能已被移动或删除')
    })
    sampleAudio = el
  }
  if (samplePlaying.value) {
    sampleAudio.pause()
    samplePlaying.value = false
    return
  }
  try {
    await sampleAudio.play()
    samplePlaying.value = true
  } catch {
    samplePlaying.value = false
    ElMessage.error('样本播放失败，请检查文件是否仍然存在')
  }
}

onBeforeUnmount(() => {
  if (sampleAudio) {
    sampleAudio.pause()
    sampleAudio.src = ''
    sampleAudio = null
  }
})
</script>

<template>
  <article
    class="voice-card"
    tabindex="0"
    role="button"
    :aria-label="`使用音色 ${voice.name}`"
    @click="emit('use', voice)"
    @keydown.enter="emit('use', voice)"
  >
    <header class="card-head">
      <div class="avatar" :class="`src-${voice.source}`">{{ initial }}</div>
      <div class="titles">
        <div class="name" :title="voice.name">{{ voice.name }}</div>
        <div class="sub">
          <span :class="sourceMeta.tag">{{ sourceMeta.label }}</span>
          <span class="time vc-muted">{{ createdText }}</span>
        </div>
      </div>
    </header>

    <p class="desc" :title="descText">{{ descText }}</p>

    <footer class="card-foot">
      <el-button size="small" type="primary" plain @click.stop="emit('use', voice)">
        使用
      </el-button>
      <el-button v-if="canPreview" size="small" @click.stop="toggleSample">
        {{ samplePlaying ? '停止试听' : '试听样本' }}
      </el-button>
      <span class="vc-spacer" />
      <el-button
        size="small"
        link
        :disabled="isBuiltin"
        :title="isBuiltin ? '内置音色不可改名' : '重命名'"
        @click.stop="emit('rename', voice)"
      >
        改名
      </el-button>
      <el-button
        size="small"
        link
        type="danger"
        :disabled="isBuiltin"
        :title="isBuiltin ? '内置音色不可删除' : '删除'"
        @click.stop="emit('remove', voice)"
      >
        删除
      </el-button>
    </footer>
  </article>
</template>

<style scoped>
.voice-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  min-height: 172px;
  background: var(--vc-bg-panel);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-md);
  box-shadow: var(--vc-shadow-sm);
  cursor: pointer;
  transition:
    border-color var(--vc-dur-fast) var(--vc-ease),
    box-shadow var(--vc-dur-fast) var(--vc-ease),
    transform var(--vc-dur-fast) var(--vc-ease);
}

.voice-card:hover {
  border-color: var(--vc-border-strong);
  box-shadow: var(--vc-shadow-md);
  transform: translateY(-1px);
}

.voice-card:focus-visible {
  outline: 2px solid var(--vc-accent);
  outline-offset: 2px;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.avatar {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: var(--vc-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
}

.src-preset {
  background: var(--vc-accent-soft);
  color: var(--vc-accent);
}

.src-design {
  background: color-mix(in srgb, var(--vc-info) 14%, transparent);
  color: var(--vc-info);
}

.src-clone {
  background: color-mix(in srgb, var(--vc-warning) 14%, transparent);
  color: var(--vc-warning);
}

.titles {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.name {
  font-size: 13.5px;
  font-weight: 650;
  color: var(--vc-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sub {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.time {
  font-size: 11px;
}

.desc {
  flex: 1;
  margin: 0;
  font-size: 12px;
  line-height: 1.65;
  color: var(--vc-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.card-foot {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
</style>
