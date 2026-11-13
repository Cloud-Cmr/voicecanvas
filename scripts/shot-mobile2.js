/**
 * 手机端交互式验证：直接在页面上下文里模拟「保存 Key → 检查横幅消失」
 * 同时截图各 tab 页面
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const TEST_KEY = process.env.MIMO_API_KEY || ''

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 390, height: 844 })
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await new Promise((r) => setTimeout(r, 2000))

  const dir = path.join(__dirname, '../screenshots')
  fs.mkdirSync(dir, { recursive: true })

  // 1. 模拟保存 Key
  const saveResult = await w.webContents.executeJavaScript(`
    (async () => {
      localStorage.setItem('vc.apiKey', ${JSON.stringify(TEST_KEY)});
      // 触发设置页的保存逻辑验证
      return localStorage.getItem('vc.apiKey') ? 'saved' : 'failed';
    })()
  `)
  console.log('Key 保存:', saveResult)

  // 2. 重载页面（模拟重启后状态保持）
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await new Promise((r) => setTimeout(r, 1500))
  const bannerGone = await w.webContents.executeJavaScript(`
    (() => {
      const cards = Array.from(document.querySelectorAll('.m-card'));
      const warnCard = cards.find((c) => c.textContent.includes('还没有配置 API Key'));
      return warnCard ? '横幅仍在' : '横幅已消失';
    })()
  `)
  console.log('重载后:', bannerGone)

  // 3. 逐 tab 截图
  const tabs = ['home', 'design', 'voice', 'transcript', 'settings']
  for (let i = 0; i < tabs.length; i++) {
    await w.webContents.executeJavaScript(`
      (async () => {
        const btns = Array.from(document.querySelectorAll('.m-tab'));
        if (btns[${i}]) btns[${i}].click();
        await new Promise((r) => setTimeout(r, 500));
      })()
    `)
    await new Promise((r) => setTimeout(r, 500))
    const img = await w.webContents.capturePage()
    fs.writeFileSync(path.join(dir, `m2-${tabs[i]}.png`), img.toPNG())
    console.log(`saved m2-${tabs[i]}`)
  }

  app.quit()
})
