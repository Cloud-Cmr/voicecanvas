/**
 * APK 构建前置准备：补齐 Capacitor 需要的 index.html、同步资源、生成图标
 * 在 gradlew 之前跑，保证 android/ 里的 web 资源是最新的。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const dist = 'dist-mobile'
const index = path.join(dist, 'index.html')
const mobile = path.join(dist, 'mobile.html')

if (!fs.existsSync(mobile)) {
  console.error(`✗ 找不到 ${mobile}，请先跑 npm run build:mobile`)
  process.exit(1)
}

// Capacitor 要求入口是 index.html
if (!fs.existsSync(index)) {
  fs.copyFileSync(mobile, index)
  console.log('✓ 已创建 index.html 入口')
}

// 修正 manifest 的 start_url
const manifestPath = path.join(dist, 'manifest.webmanifest')
if (fs.existsSync(manifestPath)) {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  m.start_url = './index.html'
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2))
  console.log('✓ manifest start_url 已修正')
}

console.log('→ 同步到 android 工程…')
execSync('npx cap sync android', { stdio: 'inherit' })
console.log('\n✓ 准备完成。现在可以构建 APK：')
console.log('  cd android && gradlew.bat assembleDebug')
console.log('  产物: android/app/build/outputs/apk/debug/app-debug.apk')
