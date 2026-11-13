// 检查 asar 中 out/ 结构与 package.json 的 main 字段
const fs = require('fs')
const b = fs.readFileSync('release/win-unpacked/resources/app.asar')
const jsonSize = b.readUInt32LE(12)
const headerBase = 8 // pickle 头
const str = b.slice(16, 16 + jsonSize).toString('utf8')
const root = JSON.parse(str).files

// 递归找 out/main/index.js
function walk(node, prefix) {
  for (const [name, item] of Object.entries(node)) {
    if (name === 'files') continue
    const p = prefix + '/' + name
    if (p === 'out/main/index.js') console.log('FOUND:', p, 'size:', item.size)
    if (item.files) walk(item.files, p)
  }
}
// asar 的 JSON 根是 { files: {...} }，walk 顶层
function walk2(node, prefix) {
  for (const [name, item] of Object.entries(node)) {
    const p = prefix ? prefix + '/' + name : name
    if (p === 'out/main/index.js') console.log('FOUND:', p, 'size:', item.size)
    if (item.files) walk2(item.files, p)
  }
}
walk2(root, '')

// package.json 内容在文件数据区，读出 main 字段
const pkg = root['package.json'] || (root.files && root.files['package.json'])
if (pkg && pkg.offset) {
  const baseOffset = 8 + jsonSize // 文件数据区起点（大约）
  const off = parseInt(pkg.offset, 10)
  const content = b.slice(16 + jsonSize + off - jsonSize, 16 + jsonSize + off - jsonSize + pkg.size)
  // 更稳妥：文件区从 8+8+jsonSize 对齐后开始，asar base 是 8 字节头 + 4+4 pickle
  // 实际公式：文件 i 的数据位于 headerSize + offset，headerSize = 8 + jsonSize(对齐)
  const headerSize = 8 + jsonSize
  const data = b.slice(headerSize + parseInt(pkg.offset, 10), headerSize + parseInt(pkg.offset, 10) + pkg.size)
  try {
    const pj = JSON.parse(data.toString('utf8'))
    console.log('package.json main =', pj.main)
    console.log('package.json version =', pj.version)
  } catch {
    console.log('package.json 内容解析失败，前 200 字节:', data.toString('utf8').slice(0, 200))
  }
} else {
  console.log('package.json 不在 asar 根目录')
}
