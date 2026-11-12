# VoiceCanvas 移动端 APK — 可行性评估（2026-11-12）

## 结论先行

**做一个「完整功能对等」的原生 APK：不现实。**
**做一个「核心合成功能」的移动版：可行，但不是这个 Electron 项目直接打包，而是一条独立的小分支。**

## 为什么 Electron 打不出 APK

1. Electron 依赖 Chromium + Node.js 完整运行时，官方**不支持 Android 目标**（electron-builder 没有 android target）。
2. capacitorjs / cordova 可以包 Web 界面成 APK，但它们**跑不了 Node 主进程**——我们所有 API 调用、safeStorage、文件落盘、WAV 拼接都在主进程，这些逻辑要重写成纯 JS/TS（浏览器端 fetch 可以，但文件系统、托盘、vcmedia 协议全部失效）。
3. 小米 MiMo API 从 Android App 直连需要在 App 里内嵌 Key（把你的 Key 打进 APK 分发给别人会泄露）。

## 可行的三条路（按性价比排序）

### 方案 A：手机浏览器版（推荐，1-2 天工作量）
- 把 renderer 的 Vue 界面改造成「无 Electron 依赖」模式：API 调用直接走浏览器 fetch，音频用 Blob 播放/下载
- 用 `vite build` 出一个静态站，挂到 GitHub Pages 或本机局域网
- 手机浏览器访问 → 「添加到主屏幕」= 近似 App 体验（PWA）
- 优点：代码复用 80%+，不用装任何东西，Key 存 localStorage
- 缺点：没有后台队列（浏览器切走可能暂停）

### 方案 B：Capacitor 包壳 APK（3-5 天工作量）
- 在方案 A 基础上用 Capacitor 把 PWA 包成 APK
- 加 Capacitor Filesystem 插件落盘音频
- 优点：真 APK、可分发
- 缺点：Key 内嵌问题仍在（自用可以，分发不行）；要装 Android Studio + JDK 构建链（约 3GB）

### 方案 C：功能精简版原生重写（2-4 周工作量）
- Flutter/React Native 重写，只保留「文本→选音色→合成→播放」单线程
- 优点：体验最好
- 缺点：两套代码库，所有功能要同步两次

## 建议

先做方案 A（PWA），能用手机干活了再说要不要包 APK。如果你想要 APK 主要是想「在手机上随时生成语音」，方案 A 就满足了；如果是想「分发给别人装」，那需要先解决 Key 的发放问题（比如做个自建代理服务，或者接受自用内嵌）。

## 需要你拍板的事

1. APK 是自用还是分发给别人？
2. 接受先用 PWA（浏览器加到主屏）过渡吗？
3. 手机上主要用哪些功能？（只合成？还是也要克隆/批量？）
