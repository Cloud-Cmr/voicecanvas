<script setup lang="ts">
/** 移动端设置页 */
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import type { AppSettings } from '../../../../shared/types'
import { api, isWeb } from '../../platform'

const settings = ref<AppSettings | null>(null)
const keyInput = ref('')
const testing = ref(false)
const testMsg = ref('')
const testOk = ref(false)

const emit = defineEmits<{ (e: 'saved'): void }>()

onMounted(async () => {
  settings.value = await api.settings.get()
})

async function saveKey() {
  const k = keyInput.value.trim()
  if (!k) return
  await api.apiKey.set(k)
  keyInput.value = ''
  settings.value = await api.settings.get()
  ElMessage.success('API Key 已保存')
  emit('saved')
}

async function test() {
  testing.value = true
  testMsg.value = ''
  try {
    const r = await api.apiKey.test(keyInput.value.trim() || undefined)
    testOk.value = r.ok
    testMsg.value = r.ok
      ? `连接正常，可用模型 ${r.models?.length ?? 0} 个`
      : r.message || '连接失败'
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div>
    <div class="m-card">
      <h3 class="m-card-title">API Key</h3>
      <el-input
        v-model="keyInput"
        type="password"
        show-password
        :placeholder="settings?.hasApiKey ? '已保存，填写新 Key 可覆盖' : '粘贴小米 MiMo API Key'"
      />
      <div style="display: flex; gap: 8px; margin-top: 10px">
        <el-button type="primary" style="flex: 1" @click="saveKey">保存</el-button>
        <el-button style="flex: 1" :loading="testing" @click="test">测试</el-button>
      </div>
      <p
        v-if="testMsg"
        :style="{ color: testOk ? 'var(--vc-accent)' : 'var(--vc-danger)' }"
        style="font-size: 12.5px; margin: 10px 0 0"
      >
        {{ testMsg }}
      </p>
      <p v-if="isWeb" style="font-size: 12px; color: var(--vc-warning); margin: 10px 0 0">
        浏览器模式：Key 保存在本机 localStorage，仅个人设备使用。
      </p>
    </div>

    <div class="m-card">
      <h3 class="m-card-title">关于</h3>
      <p style="margin: 0 0 8px; font-size: 13.5px">声绘 VoiceCanvas v0.5.0</p>
      <p style="margin: 0; font-size: 12px; color: var(--vc-text-muted); line-height: 1.7">
        第三方非官方客户端，与小米公司无隶属关系。语音服务由小米 MiMo 开放平台提供。
      </p>
    </div>
  </div>
</template>
