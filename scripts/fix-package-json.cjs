// 修 package.json：中文字段乱码 + 加 tessdata 打包资源 + 升版本
// 用 node 读写（UTF-8），避免 PowerShell 管道写中文文件乱码
const fs = require('fs')
const f = 'package.json'
const p = JSON.parse(fs.readFileSync(f, 'utf8'))

p.version = '0.8.2'
p.description = '声绘 VoiceCanvas —— 桌面端 AI 语音工作台，首发适配小米 MiMo TTS'
p.build.copyright = 'Copyright © 2026 VoiceCanvas contributors'
p.build.nsis.shortcutName = '声绘 VoiceCanvas'

// OCR 语言包打进安装包（离线识别，不依赖 CDN）
const hasExtra = Array.isArray(p.build.extraResources)
if (!hasExtra) p.build.extraResources = []
const exists = p.build.extraResources.some((r) => r.to === 'tessdata')
if (!exists) {
  p.build.extraResources.push({
    from: 'tools/tessdata',
    to: 'tessdata',
    filter: ['*.gz'],
  })
}

fs.writeFileSync(f, JSON.stringify(p, null, 2) + '\n', 'utf8')
console.log('✓ version=' + p.version)
console.log('✓ description=' + p.description)
console.log('✓ shortcutName=' + p.build.nsis.shortcutName)
console.log('✓ extraResources=' + JSON.stringify(p.build.extraResources))
