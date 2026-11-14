// findFfmpeg 实测：从 src/main/video.ts 抽出实现直接跑
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync('src/main/video.ts', 'utf8')
const m = src.match(/export function findFfmpeg[\s\S]*?\n}/)
if (!m) {
  console.log('✗ 没匹配到 findFfmpeg')
  process.exit(1)
}
const fn = m[0]
  .replace('export function', 'function')
  .replace(/\(c: string\)/g, '(c)')
  .replace(/: string \| null/g, '')
  .replace(/const cand = path\.join\(dir, `ffmpeg\$\{ext\.toLowerCase\(\)\}`\)/, 'const cand = path.join(dir, `ffmpeg${ext.toLowerCase()}`)')
const existsSync = fs.existsSync

const found = eval(`${fn}; findFfmpeg()`)
console.log('findFfmpeg ->', found)

if (found && fs.existsSync(found)) {
  console.log('✓ 找到 ffmpeg 且文件存在')
  process.exit(0)
}
console.log('✗ 未找到 ffmpeg')
process.exit(1)
