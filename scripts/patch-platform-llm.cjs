// 重写 platform.ts 的 llm/asr web 实现：直连 MiMo（CORS 已确认可用）
const fs = require('fs')
const f = 'src/renderer/src/platform.ts'
let c = fs.readFileSync(f, 'utf8')

// 1. 删除重复的 asr 块（第一个）
const dupAsr = /  asr: \{\r?\n    transcribe: async \(\): Promise<AsrResponse> => \(\{ ok: false, message: '浏览器模式暂不支持' \}\),\r?\n  \},\r?\n/
const firstAsr = c.match(dupAsr)
if (firstAsr) {
  // 只删第一处
  c = c.replace(dupAsr, '')
  console.log('✓ 删除重复 asr 桩')
}

// 2. llm web 实现直连
c = c.replace(
  /    polishDescription: async \(idea: string\): Promise<string> => \{\r?\n      if \(isElectron\) return window\.vc\.llm\.polishDescription\(idea\)\r?\n      throw new Error\('浏览器模式暂不支持 AI 写手'\)\r?\n    \},\r?\n    generateSampleText: async \(description: string\): Promise<string> => \{\r?\n      if \(isElectron\) return window\.vc\.llm\.generateSampleText\(description\)\r?\n      throw new Error\('浏览器模式暂不支持 AI 写手'\)\r?\n    \},/,
`    polishDescription: async (idea: string): Promise<string> => {
      if (isElectron) return window.vc.llm.polishDescription(idea)
      const key = localStorage.getItem(LS_KEY) || ''
      if (!key) throw new Error('尚未配置 API Key')
      const s = webGetSettings()
      const res = await fetch(\`\${s.baseUrl.replace(/\\/+$/, '')}/chat/completions\`, {
        method: 'POST',
        headers: { 'api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mimo-v2.6-flash',
          messages: [
            { role: 'system', content: '你是顶级的配音导演。把用户粗糙的声音想法扩写成专业的音色描述。输出只有描述本身，1-4 句中文，覆盖性别年龄/音色质感/情绪语气/语速节奏，禁止后期处理词与矛盾特征。' },
            { role: 'user', content: \`我的声音想法：\${idea}\` },
          ],
          temperature: 0.85,
        }),
      })
      if (!res.ok) throw new Error(\`接口 \${res.status}\`)
      const j = await res.json()
      return (j?.choices?.[0]?.message?.content || '').trim()
    },
    generateSampleText: async (description: string): Promise<string> => {
      if (isElectron) return window.vc.llm.generateSampleText(description)
      const key = localStorage.getItem(LS_KEY) || ''
      if (!key) throw new Error('尚未配置 API Key')
      const s = webGetSettings()
      const res = await fetch(\`\${s.baseUrl.replace(/\\/+$/, '')}/chat/completions\`, {
        method: 'POST',
        headers: { 'api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mimo-v2.6-flash',
          messages: [
            { role: 'system', content: '你是配音导演。给定音色描述，写一段最适合它念的中文文本，30-80字，输出只有文本本身，内容场景贴合音色人设。' },
            { role: 'user', content: \`音色描述：\${description}\` },
          ],
          temperature: 0.9,
        }),
      })
      if (!res.ok) throw new Error(\`接口 \${res.status}\`)
      const j = await res.json()
      return (j?.choices?.[0]?.message?.content || '').trim()
    },
    parseScript: async (raw: string): Promise<any> => {
      if (isElectron) return window.vc.llm.parseScript(raw)
      const key = localStorage.getItem(LS_KEY) || ''
      if (!key) throw new Error('尚未配置 API Key')
      const s = webGetSettings()
      const res = await fetch(\`\${s.baseUrl.replace(/\\/+$/, '')}/chat/completions\`, {
        method: 'POST',
        headers: { 'api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mimo-v2.6-flash',
          messages: [
            { role: 'system', content: '你是剧本解析器。把用户给的任意格式剧本解析成结构化 JSON。时间统一毫秒（支持时分秒中文单位、冒号、点分）。角色从【】[]（）()或冒号前缀提取。text 只保留台词。没有时间的行沿用上一条 startMs。时间单调不减。只输出 JSON：{"cues":[{"startMs":0,"role":"旁白","text":"..."}],"roles":["旁白"]}' },
            { role: 'user', content: raw.slice(0, 12000) },
          ],
          temperature: 0.1,
        }),
      })
      if (!res.ok) throw new Error(\`接口 \${res.status}\`)
      const j = await res.json()
      let txt = (j?.choices?.[0]?.message?.content || '').trim()
      const fence = txt.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/)
      if (fence) txt = fence[1].trim()
      const fb = txt.indexOf('{')
      const lb = txt.lastIndexOf('}')
      if (fb >= 0 && lb > fb) txt = txt.slice(fb, lb + 1)
      const parsed = JSON.parse(txt)
      let lastMs = 0
      const cues = (Array.isArray(parsed?.cues) ? parsed.cues : [])
        .filter((x: any) => x && typeof x.text === 'string' && x.text.trim())
        .map((x: any) => ({ startMs: Math.max(0, Math.round(Number(x.startMs) || 0)), role: typeof x.role === 'string' ? x.role.trim() : undefined, text: String(x.text).trim() }))
        .sort((a: any, b: any) => a.startMs - b.startMs)
      for (const x of cues) { if (x.startMs < lastMs) x.startMs = lastMs; lastMs = x.startMs }
      const roles: string[] = []
      for (const x of cues) if (x.role && !roles.includes(x.role)) roles.push(x.role)
      return { cues, roles }
    },`,
)
fs.writeFileSync(f, c)
console.log('✓ llm web 实现已直连')
console.log('parseScript 出现:', c.includes('parseScript'))
