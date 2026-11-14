// normalizeCjk 单测（与 src/main/ocr.ts 实现保持一致）
const CJK = '\\u4e00-\\u9fff\\u3400-\\u4dbf\\u3000-\\u303f\\uff00-\\uffef'

function normalizeCjk(s) {
  return s
    .replace(new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, 'g'), '$1')
    .replace(new RegExp(`([${CJK}])\\s+(?=[，。！？、；：「」『』（）])`, 'g'), '$1')
    .replace(new RegExp(`([，。！？、；：「」『』（）])\\s+(?=[${CJK}])`, 'g'), '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const cases = [
  ['第 一 句 字 幕 你 好 世 界', '第一句字幕你好世界'],
  ['今 天 天 气 真 不 错 我 们 出 去 玩 吧', '今天天气真不错我们出去玩吧'],
  ['你好， 世界 Hello World', '你好，世界 Hello World'],
  ['小 米 MiMo TTS', '小米 MiMo TTS'],
  ['  多  个   空格  ', '多个空格'],
  ['你好 世界', '你好世界'],
]

let pass = 0
for (const [inp, exp] of cases) {
  const got = normalizeCjk(inp)
  const ok = got === exp
  if (ok) pass++
  console.log(
    (ok ? '✓' : '✗') + ' ' + JSON.stringify(inp) + ' -> ' + JSON.stringify(got) +
      (ok ? '' : '  (期望 ' + JSON.stringify(exp) + ')'),
  )
}
console.log(pass + '/' + cases.length + ' 通过')
process.exit(pass === cases.length ? 0 : 1)
