// 最终调试：完整鼠标事件序列 + 页面错误捕获
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const KEY = process.env.MIMO_API_KEY || ''

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { contextIsolation: true } })
  w.webContents.on('console-message', (_e, _l, msg) => {
    if (!msg.includes('Security Warning') && msg.trim()) console.log('[page]', msg.slice(0, 300))
  })
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await w.webContents.executeJavaScript(`localStorage.setItem('vc.apiKey', ${JSON.stringify(KEY)})`)
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await new Promise((r) => setTimeout(r, 2000))

  const result = await w.webContents.executeJavaScript(`
    (async () => {
      // 填文本
      const ta = document.querySelector('.el-textarea__inner');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '测试移动端合成。');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      // 完整鼠标事件序列
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find((b) => b.textContent.includes('生成语音'));
      const opts = { bubbles: true, cancelable: true, view: window };
      btn.dispatchEvent(new MouseEvent('mousedown', opts));
      btn.dispatchEvent(new MouseEvent('mouseup', opts));
      btn.dispatchEvent(new MouseEvent('click', opts));
      return { done: true, btnText: btn.textContent.trim() };
    })()
  `)
  console.log('click:', JSON.stringify(result))

  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    const st = await w.webContents.executeJavaScript(`
      ({
        audio: !!document.querySelector('audio'),
        btn: (Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t.includes('生成'))[0] || ''),
        err: (Array.from(document.querySelectorAll('.m-card')).find((c) => (c.getAttribute('style') || '').includes('240'))?.textContent || '').slice(0, 200),
        banner: Array.from(document.querySelectorAll('.m-card')).some(c => c.textContent.includes('还没有配置')),
      })
    `)
    console.log(`t=${(i + 1) * 3}s audio=${st.audio} btn="${st.btn}" err="${st.err}" banner=${st.banner}`)
    if (st.audio) break
  }
  app.quit()
})
