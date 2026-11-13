/**
 * 移动端构建收尾：
 * 1. vite 只产出 mobile.html，Capacitor 和 PWA 都需要 index.html → 复制
 * 2. manifest 的 start_url 指向 index.html
 * 3. 校验关键文件齐全
 */
import fs from 'node:fs'
import path from 'node:path'

const dist = 'dist-mobile'
const mobile = path.join(dist, 'mobile.html')
const index = path.join(dist, 'index.html')

if (!fs.existsSync(mobile)) {
  console.error(`✗ ${mobile} 不存在，vite 构建未成功？`)
  process.exit(1)
}

fs.copyFileSync(mobile, index)

const manifestPath = path.join(dist, 'manifest.webmanifest')
if (fs.existsSync(manifestPath)) {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  m.start_url = './index.html'
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2))
}

// 校验
const checks = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'icon-192.png',
  'icon-512.png',
]
let ok = true
for (const f of checks) {
  const exists = fs.existsSync(path.join(dist, f))
  console.log(`${exists ? '✓' : '✗'} ${f}`)
  if (!exists) ok = false
}
const assets = fs.existsSync(path.join(dist, 'assets'))
  ? fs.readdirSync(path.join(dist, 'assets'))
  : []
const hasJs = assets.some((f) => f.endsWith('.js'))
console.log(`${hasJs ? '✓' : '✗'} assets/*.js (${assets.length} 个文件)`)
if (!hasJs) ok = false

if (!ok) {
  console.error('\n✗ 移动端产物不完整')
  process.exit(1)
}
console.log('\n✓ 移动端产物就绪（dist-mobile/）')
