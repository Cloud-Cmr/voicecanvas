<script setup lang="ts">
/**
 * 我的音色：把「预置」「设计」「克隆」三类音色汇到一处管理。
 *
 * 预置音色来自内置常量（PRESET_VOICES），是只读的；
 * 设计与克隆音色是用户资产（voices.json），可以改名、删除。
 * 两类在同一个网格里展示，用来源标签区分，避免用户在两处找音色。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { VoiceAsset, VoiceSource } from '../../../shared/types'
import { PRESET_VOICES } from '../../../shared/constants'
import VoiceCard from '../components/VoiceCard.vue'

const emit = defineEmits<{ (e: 'use-voice', voice: VoiceAsset): void }>()

/** 来源筛选项，内置音色也纳进筛选，避免出现"切到设计就看不到预置"的困惑 */
interface SourceFilter {
  value: 'all' | VoiceSource
  label: string
}

const filters: SourceFilter[] = [
  { value: 'all', label: '全部' },
  { value: 'preset', label: '预置' },
  { value: 'design', label: '设计' },
  { value: 'clone', label: '克隆' },
]

const assets = ref<VoiceAsset[]>([])
const loading = ref(true)
const keyword = ref('')
const activeFilter = ref<'all' | VoiceSource>('all')

/**
 * 把内置预置音色包装成 VoiceAsset，好让同一张卡片组件统一渲染。
 * id 用 `preset:<voiceId>` 前缀，避免和用户资产的 uuid 撞车。
 */
const presetAssets = computed<VoiceAsset[]>(() =>
  PRESET_VOICES.map((v) => ({
    id: `preset:${v.id}`,
    name: v.label,
    source: 'preset' as VoiceSource,
    payload: v.id,
    note: v.lang === 'zh' ? '内置中文音色' : '内置英文音色',
    createdAt: 0,
    updatedAt: 0,
  })),
)

const allVoices = computed<VoiceAsset[]>(() => [...presetAssets.value, ...assets.value])

const filtered = computed<VoiceAsset[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  return allVoices.value.filter((v) => {
    if (activeFilter.value !== 'all' && v.source !== activeFilter.value) return false
    if (!kw) return true
    const haystack = [
      v.name,
      v.payload,
      v.description ?? '',
      v.note ?? '',
      v.sampleName ?? '',
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(kw)
  })
})

const counts = computed(() => {
  const base = { all: allVoices.value.length, preset: 0, design: 0, clone: 0 }
  for (const v of allVoices.value) base[v.source] += 1
  return base
})

const myAssetCount = computed(() => assets.value.length)

/** IPC 抛出的错误不保证是 Error 实例，统一转成可读文案 */
function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

async function load(): Promise<void> {
  loading.value = true
  try {
    assets.value = await window.vc.voices.list()
  } catch (e) {
    ElMessage.error(`读取音色库失败：${errText(e)}`)
  } finally {
    loading.value = false
  }
}

function isPresetAsset(voice: VoiceAsset): boolean {
  return voice.source === 'preset' || voice.id.startsWith('preset:')
}

function onUse(voice: VoiceAsset): void {
  // 把选中的音色写给合成页，那边挂载后会读出来并自动选中
  try {
    if (isPresetAsset(voice)) {
      localStorage.setItem(
        'vc.pendingVoice',
        JSON.stringify({ kind: 'preset', id: voice.payload }),
      )
    } else {
      localStorage.setItem('vc.pendingVoice', JSON.stringify({ kind: 'asset', id: voice.id }))
    }
  } catch {
    /* localStorage 不可用时忽略，合成页会回落到默认音色 */
  }
  emit('use-voice', voice)
}

/* ---------------- 重命名 ---------------- */

const renameVisible = ref(false)
const renameTarget = ref<VoiceAsset | null>(null)
const renameInput = ref('')
const renaming = ref(false)

function onRename(voice: VoiceAsset): void {
  if (isPresetAsset(voice)) {
    ElMessage.info('内置音色不支持改名')
    return
  }
  renameTarget.value = voice
  renameInput.value = voice.name
  renameVisible.value = true
}

async function submitRename(): Promise<void> {
  const target = renameTarget.value
  const name = renameInput.value.trim()
  if (!target) return
  if (!name) {
    ElMessage.warning('名称不能为空')
    return
  }
  if (name === target.name) {
    renameVisible.value = false
    return
  }
  renaming.value = true
  try {
    await window.vc.voices.upsert({ ...target, name })
    ElMessage.success(`已改名为「${name}」`)
    renameVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error(`改名失败：${errText(e)}`)
  } finally {
    renaming.value = false
  }
}

/* ---------------- 删除 ---------------- */

async function onRemove(voice: VoiceAsset): Promise<void> {
  if (isPresetAsset(voice)) {
    ElMessage.info('内置音色不支持删除')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定要删除音色「${voice.name}」吗？删除后无法恢复，但已生成的音频不受影响。`,
      '删除音色',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      },
    )
  } catch {
    return
  }
  try {
    await window.vc.voices.remove(voice.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(`删除失败：${errText(e)}`)
  }
}

function resetFilters(): void {
  keyword.value = ''
  activeFilter.value = 'all'
}

const emptyDescription = computed(() => {
  if (!myAssetCount.value) {
    return '还没有保存过音色。去「音色设计」用一句话造一个新声音，或用「音色克隆」复刻一段样本。'
  }
  if (keyword.value.trim()) {
    return `没有匹配「${keyword.value.trim()}」的音色，换个关键词试试。`
  }
  return '这个来源下暂时没有音色。'
})

onMounted(load)
</script>

<template>
  <div class="vc-page library-page">
    <!-- 顶部工具条 -->
    <div class="toolbar">
      <el-input
        v-model="keyword"
        class="search"
        placeholder="搜索音色名称、描述或样本文件名"
        clearable
      />
      <el-radio-group v-model="activeFilter" size="small">
        <el-radio-button v-for="f in filters" :key="f.value" :value="f.value">
          {{ f.label }}（{{ counts[f.value] }}）
        </el-radio-button>
      </el-radio-group>
      <span class="vc-spacer" />
      <el-button size="small" :loading="loading" @click="load">刷新</el-button>
    </div>

    <p class="vc-hint summary">
      共 {{ allVoices.length }} 个音色，其中内置预置 {{ counts.preset }} 个、已保存
      {{ myAssetCount }} 个。内置音色只读，设计与克隆音色可改名或删除。
    </p>

    <div v-if="loading" class="vc-muted loading">加载音色库…</div>

    <el-empty v-else-if="!filtered.length" :description="emptyDescription">
      <div class="empty-actions">
        <el-button v-if="myAssetCount" size="small" @click="resetFilters">
          清除筛选条件
        </el-button>
        <p v-else class="vc-hint">
          音色设计与音色克隆都在左侧导航里，做好的音色会自动出现在这里。
        </p>
      </div>
    </el-empty>

    <div v-else class="voice-grid">
      <VoiceCard
        v-for="v in filtered"
        :key="v.id"
        :voice="v"
        @use="onUse"
        @rename="onRename"
        @remove="onRemove"
      />
    </div>

    <!-- 重命名弹窗 -->
    <el-dialog v-model="renameVisible" title="重命名音色" width="420px">
      <label class="vc-label">音色名称</label>
      <el-input
        v-model="renameInput"
        maxlength="30"
        show-word-limit
        placeholder="给这个音色起个好记的名字"
        @keyup.enter="submitRename"
      />
      <p class="vc-hint">
        原始信息（描述或样本文件）不会改变，只改展示名称。
      </p>
      <template #footer>
        <el-button @click="renameVisible = false">取消</el-button>
        <el-button type="primary" :loading="renaming" @click="submitRename">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.library-page {
  display: flex;
  flex-direction: column;
  gap: var(--vc-gap-md);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.search {
  width: 300px;
}

.summary {
  margin: 0;
}

.loading {
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
}

.voice-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
  gap: var(--vc-gap-md);
  padding-bottom: var(--vc-gap-lg);
}

.empty-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: 420px;
  text-align: center;
}

.empty-actions .vc-hint {
  margin: 0;
}
</style>
