<script setup lang="ts">
/**
 * 自定义标题栏（无边框窗口）
 * 左侧是可拖拽区域，右侧是窗口控制按钮。
 * 控件符合 Windows 习惯：最小化/最大化无边框，关闭悬停变红。
 */
import { ref, onMounted } from 'vue'

const isMax = ref(false)

async function minimize() {
  await window.vc.window.minimize()
}

async function toggleMax() {
  isMax.value = !((await window.vc.window.toggleMaximize()) ?? false)
}

async function close() {
  await window.vc.window.close()
}

onMounted(async () => {
  try {
    isMax.value = !((await window.vc.window.isMaximized()) ?? false)
    // 监听窗口状态变化（双击/系统拖拽也会改变）
    window.addEventListener('resize', async () => {
      isMax.value = !((await window.vc.window.isMaximized()) ?? false)
    })
  } catch {
    /* 浏览器模式无 window.vc */
  }
})
</script>

<template>
  <div class="titlebar">
    <!-- 拖拽区（占满左侧，避开右侧按钮） -->
    <div class="drag-region" style="-webkit-app-region: drag" />

    <div class="tb-controls" style="-webkit-app-region: no-drag">
      <button class="tb-btn" title="最小化" @click="minimize">
        <svg viewBox="0 0 12 12" width="12" height="12">
          <path d="M1 6h10" stroke="currentColor" stroke-width="1.2" fill="none" />
        </svg>
      </button>
      <button class="tb-btn" :title="isMax ? '还原' : '最大化'" @click="toggleMax">
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
          <template v-if="!isMax">
            <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
          </template>
          <template v-else>
            <rect x="0.5" y="2.5" width="9" height="9" rx="1" />
            <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1" />
          </template>
        </svg>
      </button>
      <button class="tb-btn tb-close" title="关闭" @click="close">
        <svg viewBox="0 0 12 12" width="12" height="12">
          <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.2" fill="none" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 36px;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  background: transparent;
  pointer-events: none; /* 让拖拽区穿透，仅按钮接收事件 */
}

.drag-region {
  position: absolute;
  inset: 0 138px 0 0; /* 左侧全区域（避让右侧按钮 138px） */
}

.tb-controls {
  display: flex;
  height: 100%;
  pointer-events: auto;
}

.tb-btn {
  width: 46px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--vc-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color var(--vc-dur-fast) var(--vc-ease), color var(--vc-dur-fast) var(--vc-ease);
}

.tb-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--vc-text-primary);
}

.tb-btn.tb-close:hover {
  background: #e81123;
  color: #fff;
}
</style>
