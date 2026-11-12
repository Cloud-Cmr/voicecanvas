<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import SynthView from './views/SynthView.vue'
import DesignView from './views/DesignView.vue'
import CloneView from './views/CloneView.vue'
import BatchView from './views/BatchView.vue'
import TimelineView from './views/TimelineView.vue'
import CompareView from './views/CompareView.vue'
import ProjectView from './views/ProjectView.vue'
import TranscriptView from './views/TranscriptView.vue'
import VoiceLibraryView from './views/VoiceLibraryView.vue'
import HistoryView from './views/HistoryView.vue'
import SettingsView from './views/SettingsView.vue'
import { useShortcuts } from './composables/useShortcuts'

type TabKey =
  | 'synth'
  | 'design'
  | 'clone'
  | 'batch'
  | 'timeline'
  | 'compare'
  | 'projects'
  | 'transcript'
  | 'voices'
  | 'history'
  | 'settings'

interface NavItem {
  key: TabKey
  label: string
  desc: string
}

const navItems: NavItem[] = [
  { key: 'synth', label: '语音合成', desc: '预置音色快速出稿' },
  { key: 'design', label: '音色设计', desc: '用文字创造新声音' },
  { key: 'clone', label: '音色克隆', desc: '用样本复刻音色' },
  { key: 'batch', label: '批量工作台', desc: '台词表一键批量生成' },
  { key: 'timeline', label: '时间戳配音', desc: '按时间点摆声音出 LRC' },
  { key: 'compare', label: '音色对比', desc: '一段文本听多个音色' },
  { key: 'projects', label: '项目工作区', desc: '多次配音集中管理' },
  { key: 'transcript', label: '听写转写', desc: '音频转文字（ASR）' },
  { key: 'voices', label: '我的音色', desc: '已保存的音色资产' },
  { key: 'history', label: '生成历史', desc: '最近生成过的音频' },
  { key: 'settings', label: '设置', desc: 'API 与输出选项' },
]

const active = ref<TabKey>('synth')
const hasApiKey = ref(true)
const showGuide = ref(false)

const current = computed(() => navItems.find((n) => n.key === active.value)!)

onMounted(async () => {
  try {
    const s = await window.vc.settings.get()
    hasApiKey.value = s.hasApiKey
    if (!s.hasApiKey) {
      showGuide.value = true
    }
  } catch {
    hasApiKey.value = false
  }
})

function go(key: TabKey) {
  active.value = key
}

// 全局快捷键：Ctrl+1~9 切页，Ctrl+, 设置
const tabOrder: TabKey[] = [
  'synth',
  'design',
  'clone',
  'batch',
  'timeline',
  'transcript',
  'voices',
  'history',
]

useShortcuts([
  ...tabOrder.map((k, i) => ({
    keys: `ctrl+${i + 1}`,
    label: `切到${navItems.find((n) => n.key === k)?.label}`,
    handler: () => go(k),
  })),
  { keys: 'ctrl+,', label: '打开设置', handler: () => go('settings') },
])

async function onKeySaved() {
  const s = await window.vc.settings.get()
  hasApiKey.value = s.hasApiKey
  if (s.hasApiKey) showGuide.value = false
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">声</div>
        <div class="brand-text">
          <div class="brand-name">声绘</div>
          <div class="brand-en">VoiceCanvas</div>
        </div>
      </div>

      <nav class="nav">
        <button
          v-for="item in navItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: active === item.key }"
          @click="go(item.key)"
        >
          <span class="nav-icon">
            <!-- 16px 线性图标，1.5 描边随字重，currentColor 随状态着色 -->
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none"
                 stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <template v-if="item.key === 'synth'">
                <path d="M3 6.5v3" /><path d="M6 4.5v7" /><path d="M9.5 3v10" /><path d="M13 6v4" />
              </template>
              <template v-else-if="item.key === 'design'">
                <path d="M8 1.8c-3.4 0-6.2 2.8-6.2 6.2 0 3.4 2.8 6.2 6.2 6.2.9 0 1.5-.6 1.5-1.4 0-.4-.2-.7-.4-1-.2-.3-.4-.6-.4-1 0-.8.6-1.4 1.4-1.4h1.6c1.4 0 2.5-1.1 2.5-2.4C14.2 4 11.4 1.8 8 1.8Z" />
                <circle cx="5" cy="6" r="0.9" fill="currentColor" stroke="none" />
                <circle cx="8.5" cy="4.6" r="0.9" fill="currentColor" stroke="none" />
              </template>
              <template v-else-if="item.key === 'clone'">
                <rect x="5.5" y="5.5" width="8.5" height="8.5" rx="2" />
                <path d="M10.5 2.5h-6a2 2 0 0 0-2 2v6" />
              </template>
              <template v-else-if="item.key === 'voices'">
                <path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h2.4l1.4 1.8H12a1.5 1.5 0 0 1 1.5 1.5v5.2A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5V4.5Z" />
              </template>
              <template v-else-if="item.key === 'history'">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 4.8V8l2.3 1.6" />
              </template>
              <template v-else>
                <circle cx="8" cy="8" r="2.2" />
                <path d="M8 1.8v1.9M8 12.3v1.9M1.8 8h1.9M12.3 8h1.9M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" />
              </template>
            </svg>
          </span>
          <span class="nav-body">
            <span class="nav-label">{{ item.label }}</span>
            <span class="nav-desc">{{ item.desc }}</span>
          </span>
        </button>
      </nav>

      <div class="sidebar-foot">
        <div v-if="!hasApiKey" class="warn-chip" @click="go('settings')">
          未配置 API Key
        </div>
        <div class="version vc-muted">v0.5.0</div>
      </div>
    </aside>

    <main class="content">
      <header class="topbar">
        <div class="topbar-main">
          <h1 class="topbar-title">{{ current.label }}</h1>
          <p class="topbar-desc">{{ current.desc }}</p>
        </div>
        <div class="topbar-right">
          <span class="status-dot" :class="{ ok: hasApiKey }" :title="hasApiKey ? 'API 已配置' : 'API 未配置'" />
          <span class="status-text">{{ hasApiKey ? '就绪' : '未配置' }}</span>
        </div>
      </header>

      <div class="view-host">
        <SynthView v-if="active === 'synth'" @need-key="go('settings')" />
        <DesignView v-else-if="active === 'design'" @need-key="go('settings')" />
        <CloneView v-else-if="active === 'clone'" @need-key="go('settings')" />
        <BatchView v-else-if="active === 'batch'" @need-key="go('settings')" />
        <TimelineView v-else-if="active === 'timeline'" @need-key="go('settings')" />
        <CompareView v-else-if="active === 'compare'" @need-key="go('settings')" />
        <TranscriptView v-else-if="active === 'transcript'" @need-key="go('settings')" />
        <VoiceLibraryView v-else-if="active === 'voices'" @use-voice="go('synth')" />
        <HistoryView v-else-if="active === 'history'" />
        <SettingsView v-else-if="active === 'settings'" @saved="onKeySaved" />
      </div>
    </main>

    <el-dialog
      v-model="showGuide"
      title="欢迎使用 声绘 VoiceCanvas"
      width="520px"
      :close-on-click-modal="false"
    >
      <p class="vc-subtitle" style="margin-bottom: 12px">
        开始之前需要配置小米 MiMo 的 API Key，大约 1 分钟。
      </p>
      <ol class="guide-list">
        <li>
          打开
          <a href="https://platform.xiaomimimo.com" target="_blank"
            >platform.xiaomimimo.com</a
          >
          注册并登录
        </li>
        <li>进入控制台的「API Key」页面，创建一个新 Key</li>
        <li>复制 Key，粘贴到本软件的「设置 → API Key」，点保存</li>
      </ol>
      <p class="vc-hint">
        Key 会使用系统级加密（Windows DPAPI）保存在本机，不会上传到任何服务器。
      </p>
      <template #footer>
        <el-button @click="showGuide = false">稍后配置</el-button>
        <el-button type="primary" @click="go('settings'); showGuide = false">
          去配置
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  background: var(--vc-bg-base);
}

.sidebar {
  width: 224px;
  flex-shrink: 0;
  background: var(--vc-bg-panel);
  border-right: 1px solid var(--vc-border);
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px 18px;
}

.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: var(--vc-radius-sm);
  /* VU 表指针的琥珀铜渐变，呼应「声绘」把声音画出来的隐喻 */
  background: linear-gradient(150deg, var(--vc-accent-bright), var(--vc-accent-dim));
  color: #1a1408;
  font-weight: 700;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    0 0 20px var(--vc-accent-glow),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.brand-name {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: 0.06em;
}

.brand-en {
  font-size: 11.5px;
  color: var(--vc-text-faint);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: none;
  background: transparent;
  border-radius: var(--vc-radius-sm);
  cursor: pointer;
  text-align: left;
  color: var(--vc-text-secondary);
  transition:
    background-color var(--vc-dur-fast) var(--vc-ease),
    color var(--vc-dur-fast) var(--vc-ease);
  font-family: inherit;
}

.nav-item:hover {
  background: var(--vc-bg-hover);
  color: var(--vc-text-primary);
}

/* 选中态：左侧短竖条 + 极淡底色。
   比整块高亮更克制，也不会盖住图标本身。 */
.nav-item.active {
  background: var(--vc-accent-soft);
  color: var(--vc-accent);
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 16px;
  border-radius: 0 2px 2px 0;
  background: var(--vc-accent);
}

.nav-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  opacity: 0.75;
}

.nav-item.active .nav-icon,
.nav-item:hover .nav-icon {
  opacity: 1;
}

.nav-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.nav-label {
  font-size: 13px;
  font-weight: 550;
  letter-spacing: 0.01em;
}

.nav-desc {
  font-size: 11.5px;
  color: var(--vc-text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-item.active .nav-desc {
  color: var(--vc-accent-dim);
}

.sidebar-foot {
  padding-top: 12px;
  border-top: 1px solid var(--vc-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.warn-chip {
  background: rgba(255, 180, 84, 0.12);
  border: 1px solid rgba(255, 180, 84, 0.3);
  color: var(--vc-warning);
  border-radius: var(--vc-radius-sm);
  padding: 7px 10px;
  font-size: 12px;
  cursor: pointer;
  text-align: center;
}

.version {
  font-size: 12px;
  text-align: center;
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 32px 14px;
  border-bottom: 1px solid var(--vc-hairline);
  flex-shrink: 0;
  /* 顶栏比内容区略亮一点，形成"光源在上"的层次 */
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.018), transparent);
}

.topbar-title {
  font-size: 18px;
  font-weight: 640;
  margin: 0;
  letter-spacing: -0.012em;
  color: var(--vc-text-primary);
}

.topbar-desc {
  font-size: 12.5px;
  color: var(--vc-text-muted);
  margin: 3px 0 0;
  letter-spacing: 0.005em;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 7px;
}

/* 状态指示：颜色 + 文字双通道，不靠颜色单独承载语义 */
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vc-text-faint);
  flex-shrink: 0;
}

.status-dot.ok {
  background: var(--vc-scope);
  box-shadow: 0 0 8px rgba(111, 211, 199, 0.5);
}

.status-text {
  font-size: 11.5px;
  color: var(--vc-text-muted);
  letter-spacing: 0.03em;
}

.view-host {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.guide-list {
  margin: 0;
  padding-left: 20px;
  color: var(--vc-text-secondary);
  font-size: 13px;
  line-height: 2;
}

.guide-list a {
  color: var(--vc-accent);
  text-decoration: none;
}
</style>
