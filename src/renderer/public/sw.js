/* 声绘 VoiceCanvas — Service Worker
 *
 * 目标：让 PWA 能「添加到主屏」后像 App 一样启动，
 * 并且界面资源离线可用（API 调用仍需联网）。
 */

const CACHE = 'voicecanvas-v1'
const CORE = ['./mobile.html', './manifest.webmanifest', './icon-192.png', './icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE).catch(() => {}) )
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request

  // 非 http(s) 协议（file://、capacitor:// 等）一律不拦截：
  // file:// 下 caches.match 与 new URL().origin 都会出错，
  // respondWith 收到非法 Response 会让整个页面加载失败（ERR_FAILED）。
  if (!req.url.startsWith('http')) return

  // API 请求绝不缓存（要实时结果）
  if (req.url.includes('api.xiaomimimo.com')) return

  // 界面资源：先用缓存，后台更新
  try {
    if (req.method === 'GET' && new URL(req.url).origin === self.location.origin) {
      event.respondWith(
        caches.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              if (res && res.status === 200) {
                const clone = res.clone()
                caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {})
              }
              return res
            })
            .catch(() => cached || Response.error())
          return cached || network
        }).catch(() => fetch(req)),
      )
    }
  } catch {
    /* 解析失败就交给网络 */
  }
})
