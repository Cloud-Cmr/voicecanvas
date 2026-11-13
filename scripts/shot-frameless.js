const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
app.whenReady().then(async () => {
  await new Promise(r => setTimeout(r, 2500))
  const wins = BrowserWindow.getAllWindows()
  if (!wins.length) { console.log('NO_WINDOW'); app.quit(); return }
  await new Promise(r => setTimeout(r, 800))
  const img = await wins[0].webContents.capturePage()
  fs.writeFileSync(path.join(__dirname, '../screenshots/frameless.png'), img.toPNG())
  console.log('saved frameless')
  app.quit()
})
