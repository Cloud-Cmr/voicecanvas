// 找 MHome 的 generate：用它独有的 placeholder 定位
const fs = require('fs')
const js = fs.readFileSync('dist-mobile/assets/mobile-DXrDq9E0.js', 'utf8')

// MHome 独有的 placeholder
const anchor = js.indexOf('输入要合成的内容。可用 (温柔)')
console.log('MHome placeholder at:', anchor)

// setup 函数的生成代码在 placeholder 之前（编译时 setup 体在前，模板渲染在后）
// 找它前面最近的 generate 相关代码：搜 '请先输入要合成的文字'（MHome 的 warning）
const warn = js.indexOf('请先输入要合成的文字')
console.log('MHome warning at:', warn)
if (warn >= 0) {
  // generate 函数包含这个 warning，往后找返回
  console.log('\n=== generate 函数体（warning 前后 1200 字符）===')
  console.log(js.slice(Math.max(0, warn - 500), warn + 700))
}
