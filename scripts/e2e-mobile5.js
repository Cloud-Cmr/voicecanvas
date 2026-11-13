// 深度调试：在页面里手动执行 MHome 的 generate 逻辑等价代码，逐步输出
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const KEY = process.env.MIMO_API_KEY || ''

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { contextIsolation: true } })
  w.webContents.on('console-message', (_e, _l, msg) => {
    if (!msg.includes('Security Warning')) console.log('[page]', msg.slice(0, 250))
  })
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await w.webContents.executeJavaScript(`localStorage.setItem('vc.apiKey', ${JSON.stringify(KEY)})`)
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await new Promise((r) => setTimeout(r, 2000))

  // Vue 3 app 实例可以从元素上拿到 __vue_app__
  const result = await w.webContents.executeJavaScript(`
    (async () => {
      const out = { steps: [] };
      const log = (m) => out.steps.push(m);
      try {
        // 检查 isElectron 判断
        log('window.vc=' + typeof window.vc);
        // 直接找按钮组件的 Vue 实例
        const btns = Array.from(document.querySelectorAll('button'));
        const genBtn = btns.find((b) => b.textContent.includes('生成语音'));
        log('btn found=' + !!genBtn);
        // 拿 Vue 组件实例
        const vueEl = genBtn?.__vueParentComponent;
        log('vueParent=' + (vueEl ? 'yes' : 'no'));
        if (vueEl) {
          // 触发 emit/click 处理
          log('instance setupState keys=' + Object.keys(vueEl.setupState || {}).slice(0, 15).join(','));
          // 直接调用 setupState 里的 generate
          if (vueEl.setupState?.generate) {
            log('calling generate() directly');
            vueEl.setupState.generate();
            log('generate() returned (sync part)');
          }
        }
      } catch (e) {
        out.error = String(e).slice(0, 300);
      }
      return out;
    })()
  `)
  console.log(JSON.stringify(result, null, 2))

  // 观察 15 秒
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    const st = await w.webContents.executeJavaScript(`
      ({
        audio: !!document.querySelector('audio'),
        err: (Array.from(document.querySelectorAll('.m-card')).find((c) => (c.getAttribute('style') || '').includes('240'))?.textContent || '').slice(0, 150),
      })
    `)
    console.log(`t=${(i + 1) * 3}s audio=${st.audio} err=${st.err}`)
    if (st.audio) break
  }
  app.quit()
})
