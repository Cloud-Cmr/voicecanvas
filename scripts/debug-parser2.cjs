// 追踪方括号用例的中间状态
const fs = require('fs')
const code = fs.readFileSync('src/shared/scriptParser.ts', 'utf8')

// 直接在 node 里手写等价流程，观察剥离结果
const line = '[00:11:12] 这是带小时的时间。'

// 模拟 findTimeMatches 的 wrapRe 行为
const wrapRe = /[[【（(]\s*([^\]】）)]{1,20})\s*[\]】）)]/g
let m
const times = []
while ((m = wrapRe.exec(line)) !== null) {
  times.push({ raw: m[1], start: m.index, end: m.index + m[0].length })
}
console.log('wrap 匹配:', JSON.stringify(times))

// 剥离
let stripped = line
for (let i = times.length - 1; i >= 0; i--) {
  stripped = stripped.slice(0, times[i].start) + stripped.slice(times[i].end)
}
console.log('剥离后:', JSON.stringify(stripped))

// 清理
const cleaned = stripped
  .replace(/^[-–—>→:：\s、,，\]】）)]+/, '')
  .replace(/[\[【（(]+$/, '')
  .replace(/^[\[【（(]+/, '')
  .replace(/[-–—>→\s、,，]+$/, '')
  .trim()
console.log('清理后:', JSON.stringify(cleaned))

// findRole 检查
const bracket = cleaned.match(/^\s*[\[【（(]\s*([^\]】）)]{1,12})\s*[\]】）)]\s*/)
console.log('findRole bracket:', bracket ? JSON.stringify(bracket[1]) : 'null')
