const { app, BrowserWindow } = require('electron')
const path = require('path')
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 1440, height: 960 })
  await w.loadFile(path.join(__dirname, '../out/renderer/index.html'))
  await new Promise((r) => setTimeout(r, 2000))
  const state = await w.webContents.executeJavaScript(`
    ({
      hasFollow: !!document.querySelector('.follow-page'),
      pageClass: document.querySelector('.vc-page')?.className || 'none',
      appHtmlLen: document.getElementById('app')?.innerHTML?.length || 0,
      navCount: document.querySelectorAll('.nav-item').length,
      errors: window.__errors || []
    })
  `)
  console.log(JSON.stringify(state, null, 2))
  app.quit()
})
