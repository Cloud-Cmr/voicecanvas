<script setup lang="ts">
/**
 * 音频播放器：波形 + 播放控制 + 保存/定位。
 * 三个合成页与历史页共用，保证交互一致。
 */
import { computed, watch } from 'vue'
import { usePlayer, formatTime, formatBytes } from '../composables/usePlayer'
import Waveform from './Waveform.vue'

const props = withDefaults(
  defineProps<{
    filePath: string
    bytes?: number
    title?: string
    meta?: string
  }>(),
  { bytes: 0, title: '', meta: '' },
)

const player = usePlayer()

// 路径变化时重新加载（父组件传入新文件即自动接续）
watch(
  () => props.filePath,
  (p) => { if (p) player.load(p) },
  { immediate: true },
)

const progressText = computed(
  () => `${formatTime(player.currentTime.value)} / ${formatTime(player.duration.value)}`,
)

function redraw() {
  /* 供父组件在布局变化后调用 */
}

async function reveal() {
  await window.vc.file.reveal(props.filePath)
}

async function saveAs() {
  const target = await window.vc.file.openDialog('output')
  if (!target) return
  const name = props.filePath.split(/[\\/]/).pop() || 'audio.wav'
  const sep = target.includes('\\') ? '\\' : '/'
  await window.vc.file.save(props.filePath, `${target}${sep}${name}`)
}
</script>

<template>
  <div class="player">
    <div class="player-head">
      <slot name="head">
        <div class="player-title">{{ title || '生成结果' }}</div>
        <div v-if="meta" class="player-meta">{{ meta }}</div>
      </slot>
    </div>

    <Waveform
      :file-path="filePath"
      :current-time="player.currentTime.value"
      :duration="player.duration.value"
      :height="72"
    />

    <div class="player-controls">
      <button class="play-btn" :disabled="player.loading.value" @click="player.toggle()">
        <span v-if="player.playing.value">❚❚</span>
        <span v-else>▶</span>
      </button>

      <span class="time vc-mono">{{ progressText }}</span>

      <input
        class="vol"
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="player.volume.value"
        @input="player.volume.value = Number(($event.target as HTMLInputElement).value)"
      />

      <span class="vc-spacer" />

      <span v-if="bytes" class="file-size vc-muted">{{ formatBytes(bytes) }}</span>
      <el-button size="small" @click="reveal">打开位置</el-button>
      <el-button size="small" type="primary" plain @click="saveAs">
        另存为
      </el-button>
    </div>

    <div v-if="player.failed.value" class="player-err">
      {{ player.failed.value }}
    </div>
  </div>
</template>

<style scoped>
.player {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.player-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.player-title {
  font-size: 13px;
  font-weight: 600;
}

.player-meta {
  font-size: 12px;
  color: var(--vc-text-muted);
}

.player-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.play-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: var(--vc-accent);
  color: var(--vc-text-inverse);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform var(--vc-dur-fast) var(--vc-ease);
}

.play-btn:hover:not(:disabled) {
  transform: scale(1.06);
}

.play-btn:active:not(:disabled) {
  transform: scale(0.96);
}

.play-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.time {
  color: var(--vc-text-secondary);
  font-size: 12px;
  min-width: 82px;
}

.vol {
  width: 70px;
  accent-color: var(--vc-accent);
}

.file-size {
  font-size: 12px;
}

.player-err {
  color: var(--vc-danger);
  font-size: 12px;
}
</style>
