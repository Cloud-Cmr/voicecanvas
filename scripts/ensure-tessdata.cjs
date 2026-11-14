// 确保 tools/tessdata 语言包就位（缺失则从 tessdata.projectnaptha.com 下载）
// 打包依赖 extraResources: tools/tessdata → tessdata，目录缺失会让 electron-builder 直接失败。
const fs = require('fs')
const path = require('path')
const https = require('https')

const DIR = path.join(__dirname, '..', 'tools', 'tessdata')
const FILES = ['chi_sim.traineddata.gz', 'eng.traineddata.gz']
const BASE = 'https://tessdata.projectnaptha.com/4.0.0/'

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 120000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return resolve(download(res.headers.location, dest))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      const tmp = dest + '.part'
      const ws = fs.createWriteStream(tmp)
      let bytes = 0
      res.on('data', (c) => {
        bytes += c.length
      })
      res.pipe(ws)
      ws.on('finish', () => {
        ws.close()
        fs.renameSync(tmp, dest)
        resolve(bytes)
      })
      ws.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

;(async () => {
  fs.mkdirSync(DIR, { recursive: true })
  let missing = 0
  for (const f of FILES) {
    const p = path.join(DIR, f)
    if (fs.existsSync(p) && fs.statSync(p).size > 1024) {
      console.log(`✓ ${f} 已存在`)
      continue
    }
    missing++
    console.log(`↓ 下载 ${f} …`)
    try {
      const bytes = await download(BASE + f, p)
      console.log(`✓ ${f} ${(bytes / 1024 / 1024).toFixed(1)} MB`)
    } catch (e) {
      console.error(`✗ ${f} 下载失败: ${e.message}`)
      process.exit(1)
    }
  }
  console.log(missing === 0 ? '✓ 语言包齐全' : `✓ 补齐 ${missing} 个语言包`)
})().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
