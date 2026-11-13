// 在 click 前拦截所有可能出口：console + fetch + xhr + unhandled
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const KEY = process.env.MIMO_API_KEY || ''

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { contextIsolation: true } })
  const pageLogs = []
  w.webContents.on('console-message', (_e, _l, msg) => pageLogs.push(msg.slice(0, 200)))

  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await w.webContents.executeJavaScript(`
    localStorage.setItem('vc.apiKey', ${JSON.stringify(KEY)});
    // 全局 fetch 记录（在 app 代码运行前 hook 也行，这里在 click 前 hook 足够）
    window.__f = [];
    const of_ = window.fetch;
    window.fetch = (...a) => { window.__f.push(String(typeof a[0] === 'string' ? a[0] : a[0]?.url).slice(0, 100)); return of_(...a); };
  `)
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await new Promise((r) => setTimeout(r, 2000))

  // 重新 hook（reload 后丢失）
  await w.webContents.executeJavaScript(`
    window.__f = [];
    const of_ = window.fetch;
    window.fetch = (...a) => { window.__f.push(String(typeof a[0] === 'string' ? a[0] : a[0]?.url).slice(0, 100)); return of_(...a); };
  `)

  const r1 = await w.webContents.executeJavaScript(`
    (async () => {
      const ta = document.querySelector('.el-textarea__inner');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '测试。');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('生成语音'));
      btn.click();
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const audio = !!document.querySelector('audio');
        if (audio) return { ok: true, fetches: window.__f, waited: (i + 1) * 2 };
      }
      return { ok: false, fetches: window.__f, btnNow: Array.from(document.querySelectorAll('button')).map((b) => b.textContent.trim()).filter((t) => t.includes('生成')) };
    })()
  `)
  console.log(JSON.stringify(r1, null, 2))
  console.log('页面日志:', JSON.stringify(pageLogs.filter((l) => !l.includes('Security')).slice(0, 5)))
  app.quit()
})
