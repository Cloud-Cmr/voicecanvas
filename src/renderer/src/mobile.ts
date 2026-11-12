import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import './styles/theme.css'
import './styles/mobile.css'
import MobileApp from './MobileApp.vue'

const app = createApp(MobileApp)
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')

// 注册 Service Worker，让 PWA 可添加到主屏并离线启动
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 本地 file:// 或开发环境注册失败属正常 */
    })
  })
}
