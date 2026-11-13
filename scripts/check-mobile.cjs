// 验证 mobile 构建产物完整性
const fs = require('fs')
const html = fs.readFileSync('dist-mobile/index.html', 'utf8')
console.log('mobile.html 大小:', html.length)
console.log('含 #app:', html.includes('id="app"'))
console.log('含 manifest:', html.includes('manifest'))
console.log('含 sw 注册 JS:', fs.existsSync('dist-mobile/assets') ? (fs.readdirSync('dist-mobile/assets').some((f) => f.endsWith('.js'))) : false)

// service worker
console.log('sw.js 存在:', fs.existsSync('dist-mobile/sw.js'))

// assets 列表
if (fs.existsSync('dist-mobile/assets')) {
  console.log('assets:', fs.readdirSync('dist-mobile/assets').join(', '))
}
