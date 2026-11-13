// 验证 parseScriptWithAI：真实 API 解析混合格式剧本
import fs from 'node:fs'

const KEY = process.env.MIMO_API_KEY
const BASE = 'https://api.xiaomimimo.com/v1'

const raw = `【旁白】0分0秒 夜色渐深，城市的灯一盏盏亮起来。
【小明】12秒 妈，我回来了。
【妈妈】11分12秒 饭在锅里，自己热一下。
张三：00:15 你好啊。
李四 0:45 最后一句。`

const SYS = `你是剧本解析器。把用户给的任意格式剧本，解析成结构化 JSON。

输入可能是任意写法，例如：
- 【旁白】0分0秒 夜色渐深。
- 张三：00:12 你好啊。
- [00:11:12] 这是十一分十二秒。
- 李四 11.22 这句在十一分二十二秒。
- SRT 块

规则：
1. 时间统一换算成毫秒。支持 时/分/秒 中文单位、冒号格式（含毫秒）、点分格式（11.22=11分22秒）。
2. 角色名从【】[]（）()括号或「角色：」冒号前缀提取；没有就省略 role 字段。
3. text 只保留真正要朗读的台词，绝不能包含时间或角色标记。
4. 没有写时间的行，startMs 沿用上一条。
5. 时间必须单调不减。
6. roles 数组按角色首次出现顺序列出全部角色名。
7. 忽略纯序号行。

只输出 JSON，不要 markdown 代码块，不要解释。格式：
{"cues":[{"startMs":0,"endMs":3000,"role":"旁白","text":"..."}],"roles":["旁白"],"note":"可选说明"}`

const t0 = Date.now()
const res = await fetch(`${BASE}/chat/completions`, {
  method: 'POST',
  headers: { 'api-key': KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'mimo-v2.6-flash',
    messages: [
      { role: 'system', content: SYS },
      { role: 'user', content: raw },
    ],
    temperature: 0.1,
    stream: false,
  }),
  signal: AbortSignal.timeout(120000),
})
if (!res.ok) {
  console.log('FAIL', res.status, (await res.text()).slice(0, 300))
  process.exit(1)
}
const j = await res.json()
const content = j?.choices?.[0]?.message?.content?.trim()
console.log(`耗时 ${Date.now() - t0}ms`)
console.log('AI 原始输出:')
console.log(content)
try {
  const parsed = JSON.parse(content.replace(/```json?\s*|```/g, '').trim())
  console.log('\n解析后:')
  parsed.cues.forEach((c, i) =>
    console.log(`  ${i + 1}. [${c.startMs}ms] ${c.role || '（无角色）'} → ${c.text}`),
  )
  console.log('roles:', parsed.roles)
  // 校验时间单调
  const ms = parsed.cues.map((c) => c.startMs)
  const monotonic = ms.every((v, i) => i === 0 || v >= ms[i - 1])
  console.log('时间单调:', monotonic ? '✓' : '✗')
} catch (e) {
  console.log('JSON 解析失败:', e.message)
}
