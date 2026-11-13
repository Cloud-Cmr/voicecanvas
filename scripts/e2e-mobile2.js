// e2e-mobile 的 fetch hook 版本：追踪移动端页面发起的网络请求
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const KEY = process.env.MIMO_API_KEY || ''

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { contextIsolation: true } })
  w.webContents.on('console-message', (_e, _l, msg) => console.log('[page]', msg.slice(0, 200)))

  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await w.webContents.executeJavaScript(`localStorage.setItem('vc.apiKey', ${JSON.stringify(KEY)})`)
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await new Promise((r) => setTimeout(r, 2000))

  // hook fetch + 填文本 + 点生成
  const clickResult = await w.webContents.executeJavaScript(`
    (async () => {
      window.__fetches = [];
      const orig = window.fetch;
      window.fetch = (...args) => {
        window.__fetches.push({ url: typeof args[0] === 'string' ? args[0] : args[0].url, ts: Date.now() });
        return orig(...args);
      };
      const ta = document.querySelector('.el-textarea__inner');
      if (!ta) return { error: 'no textarea' };
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '你好，这是移动端语音测试。');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const btns = Array.from(document.querySelectorAll('button'));
      const genBtn = btns.find((b) => b.textContent.includes('生成语音'));
      if (!genBtn) return { error: 'no button' };
      genBtn.click();
      return { clicked: true };
    })()
  `)
  console.log('click:', JSON.stringify(clickResult))

  // 15 秒内每 2 秒查一次 fetches + 页面错误
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const st = await w.webContents.executeJavaScript(`
      ({
        fetches: window.__fetches,
        hasAudio: !!document.querySelector('audio'),
        errorMsg: (Array.from(document.querySelectorAll('.m-card')).find((c) => (c.getAttribute('style') || '').includes('240, 115'))?.textContent || '').slice(0, 120),
      })
    `)
    console.log(`t=${(i + 1) * 2}s fetches=${st.fetches.length} audio=${st.hasAudio} err=${st.errorMsg}`)
    if (st.errorMsg) console.log('   错误内容:', st.errorMsg)
    if (st.hasAudio) break
  }

  const img = await w.webContents.capturePage()
  fs.writeFileSync(path.join(__dirname, '../screenshots/m2-final.png'), img.toPNG())
  app.quit()
})
