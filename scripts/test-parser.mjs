/**
 * 脚本解析器测试：覆盖用户提到的所有格式
 */
const { parseScript, formatMs, toLrc } = await import('../out-test/scriptParser.mjs').catch(() => ({}))

// 如果 TS 没编译，用内联兜底测试
async function main() {
  let mod = null
  try {
    mod = await import('file:///D:/备份/Users/郁伟/Desktop/dsh/软件/voicecanvas/out-test/scriptParser.mjs')
  } catch {
    console.log('需要先编译 scriptParser.ts')
    return
  }
  const { parseScript, formatMs } = mod

  const samples = [
    {
      name: '中文时间 + 角色括号',
      text: `【旁白】0分0秒 夜色渐深，城市的灯一盏盏亮起来。
【小明】12秒 妈，我回来了。
【妈妈】11分12秒 饭在锅里，自己热一下。`,
    },
    {
      name: '冒号时间 + 冒号角色',
      text: `旁白：00:00 这是一个测试。
张三：0:05 你好啊。
李四：0:12 你好。`,
    },
    {
      name: '点分时间 + 无角色',
      text: `0.00 第一句话。
11.22 第二句话，时间是十一分二十二秒。
1.02.03 一小时零两分三秒的第三句。`,
    },
    {
      name: '方括号时间',
      text: `[00:11:12] 这是带小时的时间。
[11:12] 转写 11分12秒。
[12.5] 十二秒半。`,
    },
    {
      name: '混合 + 无时间行',
      text: `张三：0:00 开场白第一句。
紧接着这一句没写时间。
【旁白】30 三十秒处旁白。
李四 0:45 最后一句。`,
    },
  ]

  for (const s of samples) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`用例: ${s.name}`)
    console.log('输入:')
    console.log(s.text.split('\n').map((l) => '  ' + l).join('\n'))
    const r = parseScript(s.text)
    console.log(`\n结果（${r.cues.length} 条，角色: ${r.roles.join(', ') || '无'}）:`)
    for (const c of r.cues) {
      console.log(`  [${formatMs(c.startMs)}] ${c.role ? c.role + ' → ' : ''}${c.text}`)
    }
    if (r.warnings.length) console.log('  警告:', r.warnings.join(' | '))
  }
}

main()
