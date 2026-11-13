/**
 * 移动端端到端验证：
 * 1. 注入 Key → 横幅消失
 * 2. 输入文本 → 点生成 → 真实调用 API → 音频可播放
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const KEY = process.env.MIMO_API_KEY || ''

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { contextIsolation: true } })

  // 先加载页面（file:// 源），再注入 Key（同源 localStorage），然后 reload 使其生效
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await w.webContents.executeJavaScript(`localStorage.setItem('vc.apiKey', ${JSON.stringify(KEY)})`)
  await w.loadFile(path.join(__dirname, '../dist-mobile/index.html'))
  await new Promise((r) => setTimeout(r, 2500))

  const state1 = await w.webContents.executeJavaScript(`
    ({
      hasKey: !!localStorage.getItem('vc.apiKey'),
      banner: Array.from(document.querySelectorAll('.m-card')).some((c) => c.textContent.includes('还没有配置 API Key')),
    })
  `)
  console.log('状态:', JSON.stringify(state1))

  // 输入文本并点生成
  const gen = await w.webContents.executeJavaScript(`
    (async () => {
      const ta = document.querySelector('.el-textarea__inner');
      if (!ta) return { error: '找不到文本框' };
      // Vue 需要 input 事件触发响应式
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '你好，这是移动端的语音测试。');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      // 找生成按钮
      const btns = Array.from(document.querySelectorAll('button'));
      const genBtn = btns.find((b) => b.textContent.includes('生成语音'));
      if (!genBtn) return { error: '找不到生成按钮', btnTexts: btns.map((b) => b.textContent.trim()).slice(0, 10) };
      genBtn.click();
      return { clicked: true };
    })()
  `)
  console.log('点击生成:', JSON.stringify(gen))

  // 等待真实 API 响应（最长 60 秒）
  let audioOk = false
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const st = await w.webContents.executeJavaScript(`
      ({
        hasResult: !!document.querySelector('audio'),
        error: (Array.from(document.querySelectorAll('.m-card')).find((c) => c.style.borderColor && c.style.borderColor.includes('240, 115'))?.textContent || '').slice(0, 100),
      })
    `)
    if (st.hasResult) {
      audioOk = true
      console.log(`✓ 音频生成成功（等待 ${((i + 1) * 2)}s）`)
      break
    }
    if (st.error) {
      console.log('✗ 页面显示错误:', st.error)
      break
    }
    if (i === 29) console.log('✗ 60 秒超时')
  }

  // 截图最终状态
  const img = await w.webContents.capturePage()
  fs.writeFileSync(path.join(__dirname, '../screenshots/m2-final.png'), img.toPNG())
  console.log('最终截图:', audioOk ? '含音频播放器' : '含错误信息')

  app.quit()
})
