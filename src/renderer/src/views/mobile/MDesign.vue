<script setup lang="ts">
/** 移动端音色设计页 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { BUILTIN_TEMPLATES, groupTemplates } from '../../../../shared/templates'
import { api, downloadBlob } from '../../platform'

const emit = defineEmits<{ (e: 'need-key'): void }>()

const description = ref('')
const text = ref('')
const loading = ref(false)
const error = ref('')
const resultUrl = ref('')
const libOpen = ref(false)
const grouped = groupTemplates()

function useTemplate(t: (typeof BUILTIN_TEMPLATES)[number]) {
  description.value = t.prompt
  text.value = t.sample
  libOpen.value = false
  ElMessage.success(`已填入「${t.name}」`)
}

async function generate() {
  if (!description.value.trim()) {
    ElMessage.warning('请先写一段音色描述')
    return
  }
  loading.value = true
  error.value = ''
  resultUrl.value = ''
  try {
    const res: any = await api.synth.run({
      mode: 'design',
      text: text.value.trim(),
      designPrompt: description.value.trim(),
      format: 'wav',
      optimizeTextPreview: !text.value.trim(),
    })
    if (res.ok) {
      resultUrl.value = res.blobUrl || res.filePath
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

async function saveVoice() {
  if (!description.value.trim()) return
  const name = prompt('给这个音色起个名字', '我的设计音色')
  if (!name) return
  await api.voices.upsert({
    name,
    source: 'design',
    payload: description.value.trim(),
    description: description.value.trim(),
  } as any)
  ElMessage.success('已存入我的音色')
}
</script>

<template>
  <div>
    <div class="m-card">
      <h3 class="m-card-title">音色描述</h3>
      <el-input
        v-model="description"
        type="textarea"
        :rows="6"
        maxlength="800"
        placeholder="例：二十八岁左右的女性，音色柔润低沉，语速偏慢，像在深夜轻声说话。"
      />
      <el-button
        size="small"
        style="margin-top: 10px"
        @click="libOpen = !libOpen"
      >
        {{ libOpen ? '收起声音图鉴' : `从声音图鉴选（${BUILTIN_TEMPLATES.length} 种）` }}
      </el-button>

      <div v-if="libOpen" style="margin-top: 12px">
        <div v-for="g in grouped" :key="g.category" style="margin-bottom: 14px">
          <div style="font-size: 12px; color: var(--vc-text-muted); margin-bottom: 6px">
            {{ g.category }}
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px">
            <button
              v-for="t in g.items"
              :key="t.id"
              class="m-tpl"
              @click="useTemplate(t)"
            >
              <span class="m-tpl-name">{{ t.name }}</span>
              <span class="m-tpl-line">{{ t.tagline }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="m-card">
      <h3 class="m-card-title">要念的文本</h3>
      <el-input
        v-model="text"
        type="textarea"
        :rows="4"
        maxlength="800"
        placeholder="可留空，让模型自动生成适配的播报文本"
      />
    </div>

    <div class="m-card">
      <el-button
        type="primary"
        size="large"
        style="width: 100%"
        :loading="loading"
        @click="generate"
      >
        {{ loading ? '生成中…' : '生成试听' }}
      </el-button>
      <el-button
        size="small"
        style="width: 100%; margin: 10px 0 0"
        :disabled="!description.trim()"
        @click="saveVoice"
      >
        存为我的音色
      </el-button>
    </div>

    <div v-if="error" class="m-card" style="border-color: var(--vc-danger)">
      <p style="margin: 0; color: var(--vc-danger); font-size: 13px">{{ error }}</p>
    </div>

    <div v-if="resultUrl" class="m-card">
      <h3 class="m-card-title">结果</h3>
      <audio :src="resultUrl" controls style="width: 100%" />
      <el-button
        size="small"
        style="width: 100%; margin-top: 10px"
        @click="downloadBlob(resultUrl, `design-${Date.now()}.wav`)"
      >
        保存音频
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.m-tpl {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  padding: 10px 12px;
  border-radius: var(--vc-radius-sm);
  border: 1px solid var(--vc-border);
  background: var(--vc-bg-input);
  color: var(--vc-text-primary);
  font-family: inherit;
  cursor: pointer;
}

.m-tpl:active {
  transform: scale(0.985);
}

.m-tpl-name {
  font-size: 14px;
  font-weight: 600;
}

.m-tpl-line {
  font-size: 12px;
  color: var(--vc-text-muted);
}
</style>
