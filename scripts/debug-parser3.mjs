// 用编译后的模块单行测试，逐步打印
const mod = await import('file:///D:/备份/Users/郁伟/Desktop/dsh/软件/voicecanvas/out-test/scriptParser.mjs')

// 测单行
for (const line of ['[00:11:12] 这是带小时的时间。', '[11:12] 转写 11分12秒。', '[12.5] 十二秒半。']) {
  const r = mod.parseScript(line)
  console.log(`输入: ${line}`)
  console.log(`  解析: ${JSON.stringify(r.cues[0])}`)
  console.log('')
}

// 检查 findRole 对原始行的行为（通过解析结果的 role 反推）
console.log('=== 检查 [00:11:12] 是否被判为时间 ===')
const t1 = '[00:11:12] 这是带小时的时间。'
// 用 parseScript 内部逻辑不可能直接看，改为验证另一种写法
const r2 = mod.parseScript('[00:11:12]\n这是带小时的时间。')
console.log('分两行:', JSON.stringify(r2.cues, null, 2))
