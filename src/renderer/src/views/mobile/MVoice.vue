<script setup lang="ts">
/** 移动端我的音色 */
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { VoiceAsset } from '../../../../shared/types'
import { api } from '../../platform'

const emit = defineEmits<{ (e: 'need-key'): void }>()

const voices = ref<VoiceAsset[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    voices.value = await api.voices.list()
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function remove(v: VoiceAsset) {
  try {
    await ElMessageBox.confirm(`删除音色「${v.name}」？`, '确认', { type: 'warning' })
  } catch {
    return
  }
  await api.voices.remove(v.id)
  await load()
  ElMessage.success('已删除')
}

function sourceLabel(s: VoiceAsset['source']) {
  return s === 'preset' ? '预置' : s === 'design' ? '设计' : '克隆'
}
</script>

<template>
  <div>
    <div v-if="loading" class="m-card">
      <p style="margin: 0; color: var(--vc-text-muted); font-size: 13px">加载中…</p>
    </div>

    <div v-else-if="!voices.length" class="m-card">
      <p style="margin: 0 0 6px; font-size: 14px">还没有保存过音色</p>
      <p style="margin: 0; font-size: 12.5px; color: var(--vc-text-muted)">
        到「音色」页用一段描述造一个新声音，它会出现在这里。
      </p>
    </div>

    <div v-for="v in voices" :key="v.id" class="m-card m-voice">
      <div style="flex: 1; min-width: 0">
        <div class="m-voice-name">{{ v.name }}</div>
        <div class="m-voice-meta">
          <span class="m-badge">{{ sourceLabel(v.source) }}</span>
          <span style="margin-left: 8px">
            {{ new Date(v.createdAt).toLocaleDateString('zh-CN') }}
          </span>
        </div>
      </div>
      <el-button size="small" link @click="remove(v)">删除</el-button>
    </div>
  </div>
</template>

<style scoped>
.m-voice {
  display: flex;
  align-items: center;
  gap: 10px;
}

.m-voice-name {
  font-size: 14.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.m-voice-meta {
  font-size: 12px;
  color: var(--vc-text-muted);
  margin-top: 3px;
}

.m-badge {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--vc-accent-soft);
  color: var(--vc-accent);
}
</style>
