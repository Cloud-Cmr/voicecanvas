const { app, BrowserWindow } = require('electron')
const path = require('path')
require(path.join(__dirname, '../out/main/index.js'))
app.whenReady().then(async () => {
  await new Promise(r => setTimeout(r, 2500))
  const wins = BrowserWindow.getAllWindows()
  if (!wins.length) { console.log('NO_WINDOW'); app.quit(); return }
  const w = wins[0]
  const r = await w.webContents.executeJavaScript(`
    (async () => {
      try { return { ok: true, res: await window.vc.apiKey.set('sk-test-12345') } }
      catch (e) { return { ok: false, error: String(e).slice(0, 150) } }
    })()
  `)
  console.log('TEST apiKey.set:', JSON.stringify(r))
  const r2 = await w.webContents.executeJavaScript(`(async () => (await window.vc.settings.get()).hasApiKey)()`)
  console.log('TEST hasApiKey:', r2)
  app.quit()
})