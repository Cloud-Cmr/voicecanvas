// click 传播测试：listener 能否收到 click？
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const KEY = process.env.MIMO_API_KEY || ''

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { contextIsolation: true } })
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await w.webContents.executeJavaScript(`localStorage.setItem('vc.apiKey', ${JSON.stringify(KEY)})`)
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await new Promise((r) => setTimeout(r, 2000))

  const result = await w.webContents.executeJavaScript(`
    (async () => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('生成语音'));
      // 挂自己的 listener
      let received = 0;
      btn.addEventListener('click', () => received++);
      btn.click();
      await new Promise((r) => setTimeout(r, 300));
      const nativeReceived = received;
      // Element Plus 的按钮：真正的可点元素可能是内部的 <button>，外层找错了？
      // 检查 btn 的标签与父链
      const info = {
        tag: btn.tagName,
        cls: btn.className.slice(0, 60),
        disabled: btn.disabled,
        parentTag: btn.parentElement?.tagName,
        parentCls: (btn.parentElement?.className || '').slice(0, 60),
      };
      // 也试一下 HTMLElement.prototype.click 在 disabled 时无效
      return { nativeReceived, info };
    })()
  `)
  console.log(JSON.stringify(result, null, 2))
  app.quit()
})
