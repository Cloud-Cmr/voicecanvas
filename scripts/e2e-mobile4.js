// 测试 platform api.synth.run 在页面里的真实行为
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const KEY = process.env.MIMO_API_KEY || ''

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { contextIsolation: true } })
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await w.webContents.executeJavaScript(`localStorage.setItem('vc.apiKey', ${JSON.stringify(KEY)})`)
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await new Promise((r) => setTimeout(r, 2000))

  // Vue app 把 api 模块编译进 bundle 了，无法直接 import。
  // 改为 UI 驱动 + 捕获页面内所有 console + Promise rejection
  const clickResult = await w.webContents.executeJavaScript(`
    (async () => {
      window.__unhandled = [];
      window.addEventListener('unhandledrejection', (e) => window.__unhandled.push(String(e.reason).slice(0, 200)));
      const ta = document.querySelector('.el-textarea__inner');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '测试移动端合成。');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find((b) => b.textContent.includes('生成语音'));
      btn.click();
      return { clicked: true };
    })()
  `)
  console.log('click:', JSON.stringify(clickResult))

  // 等 20 秒观察
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const st = await w.webContents.executeJavaScript(`
      ({
        unhandled: window.__unhandled,
        audio: !!document.querySelector('audio'),
        btnText: (Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('生成') || b.textContent.includes('生成中'))?.textContent || '').trim(),
      })
    `)
    console.log(`t=${(i + 1) * 2}s unhandled=${JSON.stringify(st.unhandled)} audio=${st.audio} btn="${st.btnText}"`)
    if (st.audio) break
  }
  app.quit()
})
