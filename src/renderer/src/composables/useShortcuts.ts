/**
 * 全局快捷键 composable
 *
 * 桌面端专业工具的标配：不离开键盘就能操作。
 * 只在 Electron 里生效（浏览器模式跳过，避免和系统快捷键冲突）。
 */
import { onMounted, onBeforeUnmount } from 'vue'

export interface ShortcutDef {
  /** 组合键，如 'ctrl+enter'、'ctrl+k' */
  keys: string
  /** 说明，用于快捷键帮助面板 */
  label: string
  handler: () => void
}

function normalize(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')
  const k = e.key.toLowerCase()
  // 忽略纯修饰键
  if (!['control', 'shift', 'alt', 'meta'].includes(k)) parts.push(k)
  return parts.join('+')
}

export function useShortcuts(defs: ShortcutDef[]) {
  const map = new Map(defs.map((d) => [d.keys.toLowerCase(), d]))

  function onKeydown(e: KeyboardEvent) {
    // 输入框里只响应带修饰键的组合，避免影响打字
    const target = e.target as HTMLElement
    const inInput =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)

    const combo = normalize(e)
    const def = map.get(combo)
    if (!def) return

    const hasModifier = combo.includes('ctrl') || combo.includes('alt')
    if (inInput && !hasModifier) return

    e.preventDefault()
    def.handler()
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

  return { shortcuts: defs }
}

/** 默认快捷键表（供帮助面板展示） */
export const DEFAULT_SHORTCUT_HINTS = [
  { keys: 'Ctrl + Enter', label: '开始生成' },
  { keys: 'Ctrl + K', label: '打开音色选择' },
  { keys: 'Ctrl + 1~9', label: '切换页面' },
  { keys: 'Ctrl + ,', label: '打开设置' },
  { keys: 'Ctrl + Shift + R', label: '重新生成' },
  { keys: 'Esc', label: '停止/关闭' },
]
