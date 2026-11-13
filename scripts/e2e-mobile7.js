// 最终验证：重新查询按钮（避免旧 DOM 引用），用原生 click 触发
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const KEY = process.env.MIMO_API_KEY || ''

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { contextIsolation: true } })
  w.webContents.on('console-message', (_e, _l, msg) => {
    if (!msg.includes('Security Warning') && msg.trim()) console.log('[page]', msg.slice(0, 250))
  })
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await w.webContents.executeJavaScript(`localStorage.setItem('vc.apiKey', ${JSON.stringify(KEY)})`)
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await new Promise((r) => setTimeout(r, 2000))

  // 一次性在页面内完成：填文本 → 重新查询按钮 → click → 轮询结果
  const result = await w.webContents.executeJavaScript(`
    (async () => {
      const ta = document.querySelector('.el-textarea__inner');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '测试移动端合成。');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      // click 之后立刻在同一次执行里轮询，避免跨 executeJavaScript 的 DOM 失效
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('生成语音'));
      btn.click();
      // 轮询 30 秒
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const audio = !!document.querySelector('audio');
        const btnNow = (Array.from(document.querySelectorAll('button')).map((b) => b.textContent.trim()).find((t) => t.includes('生成'))) || '';
        const errCard = Array.from(document.querySelectorAll('.m-card')).find((c) => (c.getAttribute('style') || '').includes('240'));
        if (audio) return { ok: true, waited: (i + 1) * 2 };
        if (errCard) return { ok: false, err: errCard.textContent.slice(0, 200) };
        if (i === 14) return { ok: false, err: '30 秒超时，按钮当前文本: ' + btnNow };
      }
      return { ok: false, err: 'loop ended' };
    })()
  `)
  console.log('结果:', JSON.stringify(result, null, 2))
  const img = await w.webContents.capturePage()
  fs.writeFileSync(path.join(__dirname, '../screenshots/m2-final.png'), img.toPNG())
  app.quit()
})
