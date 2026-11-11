<script setup lang="ts">
/**
 * 设置页：API Key、Base URL、模型 ID、输出选项。
 *
 * 这里刻意把模型 ID 和 Base URL 做成可编辑：
 * 官方会改模型版本号（mimo-v2-tts → mimo-v2.5-tts），写死在代码里会一次升级就全废。
 */
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { AppSettings, AudioFormat } from '../../../shared/types'
import { DEFAULT_MODELS } from '../../../shared/constants'

const emit = defineEmits<{ (e: 'saved'): void }>()

const settings = ref<AppSettings | null>(null)
const apiKeyInput = ref('')
const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)
const serverModels = ref<string[]>([])

onMounted(async () => {
  try {
    settings.value = await window.vc.settings.get()
  } finally {
    loading.value = false
  }
})

async function saveKey() {
  const key = apiKeyInput.value.trim()
  if (!key) {
    ElMessage.warning('请先填写 API Key')
    return
  }
  if (!key.startsWith('sk-')) {
    try {
      await ElMessageBox.confirm(
        '这个 Key 看起来不像以 sk- 开头，确认要保存吗？',
        '格式提示',
        { type: 'warning', confirmButtonText: '仍要保存', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
  }
  saving.value = true
  try {
    await window.vc.apiKey.set(key)
    apiKeyInput.value = ''
    settings.value = await window.vc.settings.get()
    ElMessage.success('API Key 已加密保存到本机')
    emit('saved')
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  testing.value = true
  testResult.value = null
  serverModels.value = []
  try {
    const res = await window.vc.apiKey.test(apiKeyInput.value.trim() || undefined)
    if (res.ok) {
      serverModels.value = res.models || []
      testResult.value = {
        ok: true,
        message: `连接正常，服务端可用模型 ${serverModels.value.length} 个`,
      }
    } else {
      testResult.value = { ok: false, message: res.message || '连接失败' }
    }
  } catch (e: any) {
    testResult.value = { ok: false, message: e?.message || '连接失败' }
  } finally {
    testing.value = false
  }
}

async function saveSettings() {
  if (!settings.value) return
  saving.value = true
  try {
    settings.value = await window.vc.settings.update({
      baseUrl: settings.value.baseUrl,
      models: settings.value.models,
      defaultFormat: settings.value.defaultFormat,
      outputDir: settings.value.outputDir,
    })
    ElMessage.success('设置已保存')
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function pickOutputDir() {
  const dir = await window.vc.file.openDialog('output')
  if (dir && settings.value) settings.value.outputDir = dir
}

function resetModels() {
  if (!settings.value) return
  settings.value.models = { ...DEFAULT_MODELS }
  ElMessage.info('已重置为默认模型 ID')
}

const formatOptions: Array<{ value: AudioFormat; label: string }> = [
  { value: 'wav', label: 'WAV（无损，体积大）' },
  { value: 'mp3', label: 'MP3（压缩，体积小）' },
]
</script>

<template>
  <div class="vc-page settings-page">
    <div v-if="loading" class="vc-muted">加载中…</div>

    <template v-else-if="settings">
      <!-- API 凭证 -->
      <section class="vc-card">
        <h3 class="vc-card-title">
          API 凭证
          <span v-if="settings.hasApiKey" class="vc-tag">已配置</span>
          <span v-else class="vc-tag vc-tag-warn">未配置</span>
        </h3>

        <label class="vc-label">API Key</label>
        <div class="key-row">
          <el-input
            v-model="apiKeyInput"
            type="password"
            show-password
            :placeholder="
              settings.hasApiKey
                ? '已保存 Key（出于安全不回显），填写新 Key 可覆盖'
                : '粘贴你的 MiMo API Key，形如 sk-xxxx'
            "
          />
          <el-button type="primary" :loading="saving" @click="saveKey">
            保存
          </el-button>
          <el-button :loading="testing" @click="testConnection">测试连接</el-button>
        </div>

        <p v-if="testResult" class="test-result" :class="{ ok: testResult.ok }">
          {{ testResult.ok ? '✓' : '✗' }} {{ testResult.message }}
        </p>
        <p v-if="serverModels.length" class="model-list vc-mono">
          服务端模型：{{ serverModels.join('、') }}
        </p>

        <p class="vc-hint">
          未注册？
          <a class="link" href="https://platform.xiaomimimo.com" target="_blank">
            platform.xiaomimimo.com
          </a>
          注册后在控制台创建 Key。Key 使用系统级加密（Windows DPAPI）保存，只存在本机。
        </p>
      </section>

      <!-- 接口配置 -->
      <section class="vc-card">
        <h3 class="vc-card-title">接口配置</h3>

        <label class="vc-label">Base URL</label>
        <el-input v-model="settings.baseUrl" placeholder="https://api.xiaomimimo.com/v1" />
        <p class="vc-hint">
          官方换域名时在这里改即可，不用等新版本。
        </p>

        <div class="vc-divider" />

        <div class="model-head">
          <label class="vc-label" style="margin: 0">模型 ID</label>
          <el-button link size="small" @click="resetModels">重置默认</el-button>
        </div>

        <div class="model-grid">
          <div class="model-item">
            <span class="model-key">预置音色</span>
            <el-input v-model="settings.models.preset" size="small" />
          </div>
          <div class="model-item">
            <span class="model-key">音色设计</span>
            <el-input v-model="settings.models.design" size="small" />
          </div>
          <div class="model-item">
            <span class="model-key">音色克隆</span>
            <el-input v-model="settings.models.clone" size="small" />
          </div>
        </div>
        <p class="vc-hint">
          小米会随版本调整模型 ID（如 v2 → v2.5）。留空将回退到内置默认值。
        </p>
      </section>

      <!-- 输出 -->
      <section class="vc-card">
        <h3 class="vc-card-title">输出</h3>

        <label class="vc-label">默认格式</label>
        <el-radio-group v-model="settings.defaultFormat" size="small">
          <el-radio-button
            v-for="f in formatOptions"
            :key="f.value"
            :value="f.value"
          >
            {{ f.label }}
          </el-radio-button>
        </el-radio-group>

        <div class="vc-divider" />

        <label class="vc-label">音频保存目录</label>
        <div class="key-row">
          <el-input v-model="settings.outputDir" readonly />
          <el-button @click="pickOutputDir">选择…</el-button>
        </div>
        <p class="vc-hint">
          生成成功的音频会自动保存到这里，同时记入「生成历史」。
        </p>

        <div class="vc-divider" />
        <el-button type="primary" :loading="saving" @click="saveSettings">
          保存设置
        </el-button>
      </section>

      <!-- 关于 -->
      <section class="vc-card about">
        <h3 class="vc-card-title">关于</h3>
        <p class="about-line"><strong>声绘 VoiceCanvas</strong> v0.1.0</p>
        <p class="about-line vc-muted">
          第三方非官方客户端，与小米公司无隶属关系。MiMo 语音合成服务由小米 MiMo 开放平台提供，
          使用前请遵守其服务条款。
        </p>
        <p class="about-line vc-muted">
          数据存储：设置、音色库、生成历史均为本地 JSON 文件，不上传任何服务器。
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 760px;
}

.key-row {
  display: flex;
  gap: 8px;
}

.key-row :deep(.el-input) {
  flex: 1;
}

.test-result {
  font-size: 12.5px;
  color: var(--vc-danger);
  margin: 8px 0 0;
}

.test-result.ok {
  color: var(--vc-accent);
}

.model-list {
  font-size: 11px;
  color: var(--vc-text-muted);
  margin: 4px 0 0;
  word-break: break-all;
}

.model-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.model-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.model-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-key {
  font-size: 11px;
  color: var(--vc-text-muted);
}

.link {
  color: var(--vc-accent);
  text-decoration: none;
}

.link:hover {
  text-decoration: underline;
}

.about-line {
  font-size: 12.5px;
  color: var(--vc-text-secondary);
  margin: 0 0 6px;
  line-height: 1.7;
}
</style>
