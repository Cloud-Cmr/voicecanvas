// 调试方括号用例
const mod = await import('file:///D:/备份/Users/郁伟/Desktop/dsh/软件/voicecanvas/out-test/scriptParser.mjs')
const { parseScript } = mod

const line = '[00:11:12] 这是带小时的时间。'
// 手工验证角色正则
const bracket = line.match(/^\s*[\[【（(]\s*([^\]】）)]{1,12})\s*[\]】）)]\s*/)
console.log('bracket match:', bracket ? JSON.stringify(bracket[1]) : 'null')
console.log('looksLikeTime:', bracket ? /^[\d:.,\s]+$/.test(bracket[1].trim()) : 'n/a')
// 时间匹配
const wrapRe = /[[【（(]\s*([^\]】）)]{1,20})\s*[\]】）)]/g
let m
console.log('\nwrap matches:')
const re = /[[【（(]\s*([^\]】）)]{1,20})\s*[\]】）)]/g
while ((m = re.exec(line)) !== null) {
  console.log('  raw:', JSON.stringify(m[1]), 'at', m.index)
}
console.log('\n解析结果:')
const r = parseScript(line)
console.log(JSON.stringify(r.cues, null, 2))
