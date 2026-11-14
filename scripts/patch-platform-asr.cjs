// 重写 platform 的 asr web 实现（浏览器直连 MiMo ASR）
const fs = require('fs')
const f = 'src/renderer/src/platform.ts'
let c = fs.readFileSync(f, 'utf8')

const oldStub = /  asr: \{\r?\n    transcribe: async \(\): Promise<AsrResponse> => \(\{ ok: false, message: '浏览器模式暂不支持' \}\),\r?\n  \},/
const impl = `  asr: {
    /** 浏览器直连 MiMo ASR：音频文件 → base64 → 转写 */
    transcribe: async (payload?: { filePath?: string; file?: File }): Promise<AsrResponse> => {
      let fileObj: File | null = null
      if (isElectron && payload?.filePath) {
        // Electron 模式理论上不走这里（走 window.vc.asr），仅兜底
        return { ok: false, message: '请在桌面端使用本地转写' }
      }
      if (payload?.file) fileObj = payload.file
      if (!fileObj) return { ok: false, message: '未提供音频文件' }

      const key = localStorage.getItem(LS_KEY) || ''
      if (!key) return { ok: false, message: '尚未配置 API Key' }
      const s = webGetSettings()
      const t0 = Date.now()

      const buf = await fileObj.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let bin = ''
      const CHUNK = 0x8000
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
      }
      const b64 = btoa(bin)
      const mime = fileObj.name.toLowerCase().endsWith('.mp3') ? 'mp3' : 'wav'

      const res = await fetch(\`\${s.baseUrl.replace(/\\/+$/, '')}/chat/completions\`, {
        method: 'POST',
        headers: { 'api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mimo-v2.5-asr',
          messages: [
            { role: 'user', content: [{ type: 'input_audio', input_audio: { data: b64, format: mime } }] },
          ],
          stream: false,
        }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        let msg = t.slice(0, 200)
        try { msg = JSON.parse(t)?.error?.message ?? msg } catch {}
        return { ok: false, message: \`接口 \${res.status}：\${msg}\` }
      }
      const j = await res.json()
      const text = (j?.choices?.[0]?.message?.content || '').trim()
      if (!text) return { ok: false, message: '未识别到语音内容' }
      return {
        ok: true,
        text,
        seconds: j?.usage?.seconds,
        audioTokens: j?.usage?.prompt_tokens_details?.audio_tokens,
        totalTokens: j?.usage?.total_tokens,
        elapsedMs: Date.now() - t0,
      }
    },
  },`

if (oldStub.test(c)) {
  c = c.replace(oldStub, impl)
  fs.writeFileSync(f, c)
  console.log('✓ asr web 实现已直连')
} else {
  console.log('✗ 未找到 asr 桩（可能已改过）')
}
