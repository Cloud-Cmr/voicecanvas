// 校验 asar 里打包的 main/index.js 是否包含最新代码（简化版：暴力扫路径）
const fs = require('fs')
const appPath = process.argv[2] || 'release/win-unpacked/resources/app.asar'
const b = fs.readFileSync(appPath)
const jsonSize = b.readUInt32LE(12)
const headerSize = 8 + jsonSize
const str = b.slice(16, 16 + jsonSize).toString('utf8')
const root = JSON.parse(str)

// 递归收集所有文件路径
const paths = []
function walk(node, prefix) {
  if (node.files) {
    for (const [name, item] of Object.entries(node.files)) {
      const p = prefix ? prefix + '/' + name : name
      if (item.files) walk(item, p)
      else paths.push({ path: p, size: item.size, offset: item.offset })
    }
  }
}
walk(root, '')

const target = paths.find((f) => f.path === 'out/main/index.js')
if (!target) {
  console.log('可用 out/ 路径示例:', paths.filter((f) => f.path.startsWith('out/')).slice(0, 5).map((f) => f.path))
  process.exit(1)
}
const content = b
  .slice(headerSize + parseInt(target.offset, 10), headerSize + parseInt(target.offset, 10) + target.size)
  .toString('utf8')

console.log('asar 内 out/main/index.js 大小:', target.size)
const hasSafeWrapper = content.includes('registered.has')
const styleListCount = (content.match(/style:list/g) || []).length
console.log('安全包装器存在:', hasSafeWrapper ? '✓' : '✗')
console.log('style:list 出现次数:', styleListCount, styleListCount <= 3 ? '✓ 无双注册' : '✗ 疑似双注册')
console.log('VC_SHOT 截图:', content.includes('VC_SHOT') ? '✓' : '✗')
console.log('projectList 通道:', content.includes('project:list') ? '✓' : '✗')

const local = fs.readFileSync('out/main/index.js')
console.log('本地 out/main/index.js:', local.length, 'bytes | asar 内:', target.size)
console.log(local.length === target.size ? '✓ 一致（asar 是最新构建）' : '✗ 不一致（asar 是旧产物！）')
