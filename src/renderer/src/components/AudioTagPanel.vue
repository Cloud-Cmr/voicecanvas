<script setup lang="ts">
/**
 * 音频标签快捷面板：点一下把标签插入文本框光标处。
 * 用户不用背语法，这是相对官方网页 Studio 的一个体验差异点。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 当前模式，决定哪些标签可用 */
    mode: 'preset' | 'design' | 'clone'
  }>(),
  { mode: 'preset' },
)

const emit = defineEmits<{ (e: 'insert', text: string): void }>()

interface TagGroup {
  title: string
  tags: string[]
  /** 是否仅预置音色可用 */
  presetOnly?: boolean
}

const groups = computed<TagGroup[]>(() => [
  {
    title: '整体风格',
    tags: ['温柔', '高冷', '活泼', '严肃', '慵懒', '俏皮', '磁性', '清亮'],
  },
  {
    title: '情绪',
    tags: ['开心', '悲伤', '愤怒', '惊讶', '无奈', '怅然', '欣慰', '疲惫'],
  },
  {
    title: '方言',
    tags: ['东北话', '四川话', '河南话', '粤语'],
  },
  {
    title: '细粒度',
    tags: ['叹气', '轻笑', '大笑', '抽泣', '哽咽', '气声', '颤抖', '停顿'],
  },
  {
    title: '唱歌',
    tags: ['唱歌'],
    presetOnly: true,
  },
])

const disabledHint = computed(() =>
  props.mode === 'preset'
    ? ''
    : '唱歌标签仅支持「预置音色」模式，官方暂不支持设计与克隆模式',
)
</script>

<template>
  <div class="tag-panel">
    <div v-for="g in groups" :key="g.title" class="tag-group">
      <div class="tag-group-title">
        {{ g.title }}
        <span v-if="g.presetOnly" class="tag-badge">仅预置</span>
      </div>
      <div class="tag-list">
        <button
          v-for="t in g.tags"
          :key="t"
          class="tag-chip"
          :disabled="g.presetOnly && mode !== 'preset'"
          :title="
            g.presetOnly && mode !== 'preset'
              ? '该标签仅在预置音色模式可用'
              : `插入 ${t}`
          "
          @click="emit('insert', g.presetOnly ? `(${t})` : `[${t}]`)"
        >
          {{ t }}
        </button>
      </div>
    </div>
    <p v-if="disabledHint" class="tag-hint">{{ disabledHint }}</p>
    <p class="tag-hint">
      风格标签写作 <code>(标签)</code> 放在文本开头；细粒度标签写作
      <code>[标签]</code> 插在任意位置。
    </p>
  </div>
</template>

<style scoped>
.tag-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tag-group-title {
  font-size: 12px;
  color: var(--vc-text-muted);
  margin-bottom: 5px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.tag-badge {
  font-size: 12px;
  padding: 0 5px;
  border-radius: 3px;
  background: rgba(255, 180, 84, 0.15);
  color: var(--vc-warning);
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.tag-chip {
  padding: 3px 9px;
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

.tag-chip:hover:not(:disabled) {
  border-color: var(--vc-accent);
  color: var(--vc-accent);
  background: var(--vc-accent-soft);
}

.tag-chip:active:not(:disabled) {
  transform: scale(0.96);
}

.tag-chip:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.tag-hint {
  font-size: 12px;
  color: var(--vc-text-muted);
  margin: 0;
  line-height: 1.6;
}

.tag-hint code {
  font-family: var(--vc-font-mono);
  background: var(--vc-bg-input);
  padding: 1px 4px;
  border-radius: 3px;
  color: var(--vc-accent);
}
</style>
