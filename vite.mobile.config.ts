import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 移动端 / PWA 构建配置
 *
 * 与 Electron 版共用同一套 Vue 组件，区别：
 * - base 用相对路径，方便挂到任意静态目录 / GitHub Pages
 * - 产物输出到 dist-mobile/
 * - 不引入 Electron 相关代码（组件里通过 platform.ts 分支）
 */
export default defineConfig({
  base: './',
  root: resolve(__dirname, 'src/renderer'),
  plugins: [vue()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist-mobile'),
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/mobile.html'),
    },
  },
})
