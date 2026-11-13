// e2e-mobile3：打印 fetch 请求详情 + 实际响应状态
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const KEY = process.env.MIMO_API_KEY || ''

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { contextIsolation: true } })

  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await w.webContents.executeJavaScript(`localStorage.setItem('vc.apiKey', ${JSON.stringify(KEY)})`)
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await new Promise((r) => setTimeout(r, 2000))

  const clickResult = await w.webContents.executeJavaScript(`
    (async () => {
      window.__result = null;
      const ta = document.querySelector('.el-textarea__inner');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '你好，这是移动端语音测试。');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));

      // 直接调用 api.synth.run（绕过 UI 点击，同时捕获结果）
      const mod = await import('./assets/' + Array.from(document.scripts)
        .map(s => s.src).find(s => s.includes('assets/') && s.endsWith('.js'))?.split('/').pop());
      return { note: '改用直接 fetch 测试' };
    })()
  `)
  console.log('准备:', JSON.stringify(clickResult))

  // 直接在页面上下文测试 fetch API（跳过 Vue 组件逻辑，隔离问题）
  const direct = await w.webContents.executeJavaScript(`
    (async () => {
      const key = localStorage.getItem('vc.apiKey');
      const t0 = Date.now();
      try {
        const res = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'api-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'mimo-v2.5-tts',
            messages: [{ role: 'assistant', content: '移动端测试' }],
            audio: { format: 'wav', voice: '冰糖' },
          }),
        });
        const st = res.status;
        const j = await res.json().catch(() => null);
        return {
          status: st,
          ms: Date.now() - t0,
          hasAudio: !!j?.choices?.[0]?.message?.audio?.data,
          err: j?.error?.message || null,
        };
      } catch (e) {
        return { fetchError: e.message, ms: Date.now() - t0 };
      }
    })()
  `)
  console.log('直接 fetch 结果:', JSON.stringify(direct))

  app.quit()
})
