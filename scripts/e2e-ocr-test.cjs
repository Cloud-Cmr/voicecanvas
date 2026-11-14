// 端到端实测：抽帧 → OCR → 合并时间轴字幕（等价主进程链路）
const { spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const FF = 'D:\\qqbot\\bin\\ffmpeg.exe'
const VIDEO = 'tools/sub-video.mp4'
const OUT = 'tools/e2e-frames'

// 1. 抽帧（每秒 1 帧）
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
const ext = spawnSync(FF, ['-i', VIDEO, '-vf', 'fps=1', '-q:v', '2', path.join(OUT, 'frame_%05d.jpg'), '-y'], { encoding: 'utf8' })
if (ext.status !== 0) {
  console.log('抽帧失败:', (ext.stderr || '').slice(-300))
  process.exit(1)
}
const frames = fs.readdirSync(OUT).filter((f) => f.endsWith('.jpg')).sort()
console.log(`✓ 抽帧 ${frames.length} 帧`)

// 2. OCR（本地 langPath，与 ocr.ts 一致）
const { createWorker } = require('tesseract.js')

// 与 src/main/ocr.ts 的 normalizeCjk 同款规则
const CJK = '\\u4e00-\\u9fff\\u3400-\\u4dbf\\u3000-\\u303f\\uff00-\\uffef'
function normalizeCjk(s) {
  return s
    .replace(new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, 'g'), '$1')
    .replace(new RegExp(`([${CJK}])\\s+(?=[，。！？、；：「」『』（）])`, 'g'), '$1')
    .replace(new RegExp(`([，。！？、；：「」『』（）])\\s+(?=[${CJK}])`, 'g'), '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

;(async () => {
  const langPath = path.resolve('tools/tessdata')
  const worker = await createWorker('chi_sim+eng', 1, {
    langPath,
    gzip: true,
    cachePath: langPath,
  })
  const results = []
  for (let i = 0; i < frames.length; i++) {
    const p = path.join(OUT, frames[i])
    const { data } = await worker.recognize(p, {}, { blocks: false })
    const text = normalizeCjk(
      (data.text || '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 1)
        .join(' ')
        .trim(),
    )
    results.push({ timeMs: i * 1000, text, conf: data.confidence })
    console.log(`  [${i}s] conf=${data.confidence} ${JSON.stringify(text)}`)
  }
  await worker.terminate()

  // 3. 合并（与 DubView 逻辑一致）
  const interval = 1000
  const merged = []
  let current = null
  for (const r of results) {
    const t = r.text.replace(/\s+/g, ' ').trim()
    if (!t) {
      if (current) { merged.push(current); current = null }
      continue
    }
    if (current && (t.includes(current.text.slice(0, 10)) || current.text.includes(t.slice(0, 10)))) {
      current.endMs = r.timeMs + interval
      if (t.length > current.text.length) current.text = t
    } else {
      if (current) merged.push(current)
      current = { startMs: r.timeMs, endMs: r.timeMs + interval, text: t }
    }
  }
  if (current) merged.push(current)
  const subs = merged.filter((s) => s.text.length >= 2)

  console.log(`\n✓ 合并出 ${subs.length} 条字幕：`)
  subs.forEach((s, i) => {
    const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
    console.log(`  ${i + 1}. [${mmss(s.startMs)}-${mmss(s.endMs)}] ${s.text}`)
  })

  const expect = ['第一句', '第二句', '第三句']
  const hit = expect.filter((e) => subs.some((s) => s.text.includes(e)))
  console.log(`\n${hit.length === expect.length ? '✓ E2E PASS' : '✗ E2E 部分失败'}：命中 ${hit.length}/${expect.length}`)
})().catch((e) => {
  console.log('FAIL:', e.message)
  process.exit(1)
})
