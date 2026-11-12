/**
 * 移动端截图：用 Electron 以手机视口打开构建好的 PWA
 * 用法: electron scripts/shot-mobile.js
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const file = path.join(__dirname, '../dist-mobile/mobile.html')
const targets = [
  { name: 'm-home', click: 0 },
  { name: 'm-design', click: 1 },
  { name: 'm-voice', click: 2 },
  { name: 'm-settings', click: 3 },
]

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 390,
    height: 844,
    show: false,
    backgroundColor: '#0f1013',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })

  await win.loadFile(file)
  await new Promise((r) => setTimeout(r, 1800))

  const dir = path.join(__dirname, '../screenshots')
  fs.mkdirSync(dir, { recursive: true })

  for (const t of targets) {
    await win.webContents.executeJavaScript(`
      (async () => {
        const tabs = Array.from(document.querySelectorAll('.m-tab'));
        if (tabs[${t.click}]) tabs[${t.click}].click();
        await new Promise(r => setTimeout(r, 500));
      })()
    `)
    await new Promise((r) => setTimeout(r, 600))
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(dir, `${t.name}.png`), img.toPNG())
    console.log(`saved ${t.name}`)
  }

  win.destroy()
  app.quit()
})
