<script setup lang="ts">
/** 移动端听写转写：选音频文件（浏览器 input）→ 转写 → 显示/复制结果 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const emit = defineEmits<{ (e: 'need-key'): void }>()

const transcribing = ref(false)
const resultText = ref('')
const fileName = ref('')
const failMsg = ref('')
const elapsed = ref(0)

/** 浏览器模式：文件 → ArrayBuffer → base64 → 直接调 MiMo ASR */
async function pickAndTranscribe() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'audio/wav,audio/mpeg'
  input.onchange = async () => {
    const f = input.files?.[0]
    if (!f) return
    if (f.size > 10 * 1024 * 1024) {
      ElMessage.warning('音频超过 10MB')
      return
    }
    fileName.value = f.name
    transcribing.value = true
    resultText.value = ''
    failMsg.value = ''
    const t0 = Date.now()
    try {
      // Electron 模式优先（如果 window.vc 存在且有本地路径能力）
      // 浏览器模式：直接 fetch MiMo ASR
      const buf = await f.arrayBuffer()
      const b64 = arrayBufferToBase64(buf)
      const mime = f.name.toLowerCase().endsWith('.mp3') ? 'mp3' : 'wav'

      // 从 localStorage 拿 Key（与 platform.ts 同源）
      const settings = JSON.parse(localStorage.getItem('vc.settings') || '{}')
      const base = (settings.baseUrl || 'https://api.xiaomimimo.com/v1').replace(/\/+$/, '')
      const key = localStorage.getItem('vc.apiKey') || ''

      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mimo-v2.5-asr',
          messages: [
            {
              role: 'user',
              content: [{ type: 'input_audio', input_audio: { data: b64, format: mime } }],
            },
          ],
          stream: false,
        }),
      })
      if (!res.ok) {
        const t = await res.text()
        let msg = t.slice(0, 200)
        try {
          msg = JSON.parse(t)?.error?.message ?? msg
        } catch {
          /* keep */
        }
        throw new Error(`接口 ${res.status}：${msg}`)
      }
      const j = await res.json()
      resultText.value = (j?.choices?.[0]?.message?.content || '').trim()
      elapsed.value = Date.now() - t0
      if (!resultText.value) throw new Error('没有返回转写文本')
      ElMessage.success('转写完成')
    } catch (e: any) {
      failMsg.value = e?.message || String(e)
      ElMessage.error(failMsg.value)
    } finally {
      transcribing.value = false
    }
  }
  input.click()
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

async function copyText() {
  if (!resultText.value) return
  await navigator.clipboard.writeText(resultText.value)
  ElMessage.success('已复制')
}
</script>

<template>
  <div>
    <div class="m-card">
      <h3 class="m-card-title">音频转文字</h3>
      <p class="m-sub">选一段 wav / mp3（≤10MB），转成文字。适合录音出稿。</p>
      <el-button
        type="primary"
        size="large"
        style="width: 100%"
        :loading="transcribing"
        @click="pickAndTranscribe"
      >
        {{ transcribing ? '转写中…' : '选择音频并转写' }}
      </el-button>
      <p v-if="fileName" class="m-file">
        {{ fileName }}
        <span v-if="elapsed" class="vc-num"> · {{ (elapsed / 1000).toFixed(1) }}s</span>
      </p>
    </div>

    <div v-if="failMsg" class="m-card" style="border-color: var(--vc-danger)">
      <p style="margin: 0; color: var(--vc-danger); font-size: 13px">{{ failMsg }}</p>
    </div>

    <div v-if="resultText" class="m-card">
      <h3 class="m-card-title">
        转写结果
        <span class="vc-spacer" />
        <el-button size="small" @click="copyText">复制</el-button>
      </h3>
      <p class="m-result">{{ resultText }}</p>
    </div>
  </div>
</template>

<style scoped>
.m-sub {
  font-size: 12.5px;
  color: var(--vc-text-muted);
  margin: 0 0 12px;
}

.m-file {
  font-size: 12px;
  color: var(--vc-text-secondary);
  margin: 10px 0 0;
  text-align: center;
}

.m-result {
  font-size: 14px;
  line-height: 1.8;
  color: var(--vc-text-primary);
  white-space: pre-wrap;
  margin: 0;
  user-select: text;
}
</style>
