const { app, BrowserWindow } = require('electron')
const path = require('path')
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { contextIsolation: true } })
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await new Promise((r) => setTimeout(r, 2000))
  const st = await w.webContents.executeJavaScript(`({
    vc: typeof window.vc,
    isWebDeclared: typeof window.__VC_IS_WEB__,
  })`)
  console.log('页面状态:', JSON.stringify(st))
  app.quit()
})
