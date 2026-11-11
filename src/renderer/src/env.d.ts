/// <reference types="vite/client" />

import type { VcApi } from '../../preload/index'

declare global {
  interface Window {
    vc: VcApi
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
