<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import SynthView from './views/SynthView.vue'
import DesignView from './views/DesignView.vue'
import CloneView from './views/CloneView.vue'
import VoiceLibraryView from './views/VoiceLibraryView.vue'
import HistoryView from './views/HistoryView.vue'
import SettingsView from './views/SettingsView.vue'

type TabKey = 'synth' | 'design' | 'clone' | 'voices' | 'history' | 'settings'

interface NavItem {
  key: TabKey
  label: string
  desc: string
  icon: string
}

const navItems: NavItem[] = [
  { key: 'synth', label: '语音合成', desc: '预置音色快速出稿', icon: '🎙️' },
  { key: 'design', label: '音色设计', desc: '用文字创造新声音', icon: '🎨' },
  { key: 'clone', label: '音色克隆', desc: '用样本复刻音色', icon: '🧬' },
  { key: 'voices', label: '我的音色', desc: '已保存的音色资产', icon: '📚' },
  { key: 'history', label: '生成历史', desc: '最近生成过的音频', icon: '🕘' },
  { key: 'settings', label: '设置', desc: 'API 与输出选项', icon: '⚙️' },
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
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-body">
            <span class="nav-label">{{ item.label }}</span>
            <span class="nav-desc">{{ item.desc }}</span>
          </span>
        </button>
      </nav>

      <div class="sidebar-foot">
        <div v-if="!hasApiKey" class="warn-chip" @click="go('settings')">
          ⚠ 未配置 API Key
        </div>
        <div class="version vc-muted">v0.1.0 · MiMo 适配</div>
      </div>
    </aside>

    <main class="content">
      <header class="topbar">
        <div>
          <h1 class="topbar-title">{{ current.label }}</h1>
          <p class="topbar-desc">{{ current.desc }}</p>
        </div>
      </header>

      <div class="view-host">
        <SynthView v-if="active === 'synth'" @need-key="go('settings')" />
        <DesignView v-else-if="active === 'design'" @need-key="go('settings')" />
        <CloneView v-else-if="active === 'clone'" @need-key="go('settings')" />
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
  border-radius: 10px;
  background: linear-gradient(135deg, var(--vc-accent), #1f8f63);
  color: var(--vc-text-inverse);
  font-weight: 800;
  font-size: 17px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 16px var(--vc-accent-glow);
}

.brand-name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.brand-en {
  font-size: 10px;
  color: var(--vc-text-muted);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.nav-item {
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
    background 0.15s,
    color 0.15s;
  font-family: inherit;
}

.nav-item:hover {
  background: var(--vc-bg-hover);
  color: var(--vc-text-primary);
}

.nav-item.active {
  background: var(--vc-accent-soft);
  color: var(--vc-accent);
}

.nav-icon {
  font-size: 15px;
  width: 20px;
  text-align: center;
}

.nav-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.nav-label {
  font-size: 13px;
  font-weight: 600;
}

.nav-desc {
  font-size: 10.5px;
  color: var(--vc-text-muted);
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
  font-size: 11.5px;
  cursor: pointer;
  text-align: center;
}

.version {
  font-size: 10.5px;
  text-align: center;
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.topbar {
  padding: 16px 24px 12px;
  border-bottom: 1px solid var(--vc-border);
  flex-shrink: 0;
}

.topbar-title {
  font-size: 17px;
  font-weight: 650;
  margin: 0;
}

.topbar-desc {
  font-size: 12px;
  color: var(--vc-text-muted);
  margin: 2px 0 0;
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
