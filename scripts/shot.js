/**
 * 开发用截图工具：Electron 自己截自己的窗口，避免被其他窗口遮挡
 * 用法: electron scripts/shot.js <页面key> [输出名]
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const page = process.argv[2] || 'synth'
const outName = process.argv[3] || `shot-${page}`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    show: false,
    backgroundColor: '#0f1013',
    webPreferences: {
      preload: path.join(__dirname, '../out/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  await win.loadFile(path.join(__dirname, '../out/renderer/index.html'))
  await new Promise((r) => setTimeout(r, 1500))

  // 通过点击侧边栏切页（导航是纯 Vue 状态）
  await win.webContents.executeJavaScript(`
    (async () => {
      const target = ${JSON.stringify(page)};
      const btns = Array.from(document.querySelectorAll('.nav-item'));
      const idx = ['synth','design','clone','batch','timeline','transcript','voices','history','settings'].indexOf(target);
      if (idx >= 0 && btns[idx]) { btns[idx].click(); }
      await new Promise(r => setTimeout(r, 700));
      return document.title;
    })()
  `)
  await new Promise((r) => setTimeout(r, 900))

  const img = await win.webContents.capturePage()
  const dir = path.join(__dirname, '../screenshots')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${outName}.png`)
  fs.writeFileSync(file, img.toPNG())
  console.log(`saved: ${file}`)
  win.destroy()
  app.quit()
})
