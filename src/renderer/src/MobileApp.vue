<script setup lang="ts">
/**
 * 移动端 App（PWA / APK 共用）
 *
 * 设计取舍：手机屏幕放不下桌面那 9 个页面，
 * 只保留最核心的四件事：合成、设计、我的音色、设置。
 */
import { ref, computed, onMounted } from 'vue'
import MHome from './views/mobile/MHome.vue'
import MDesign from './views/mobile/MDesign.vue'
import MVoice from './views/mobile/MVoice.vue'
import MSettings from './views/mobile/MSettings.vue'
import { api } from './platform'

type Tab = 'home' | 'design' | 'voice' | 'settings'

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'home', label: '合成' },
  { key: 'design', label: '音色' },
  { key: 'voice', label: '我的' },
  { key: 'settings', label: '设置' },
]

const active = ref<Tab>('home')
const current = computed(() => tabs.find((t) => t.key === active.value)!)
const hasKey = ref(true)

onMounted(async () => {
  const s = await api.settings.get()
  hasKey.value = s.hasApiKey
})

function switchTo(t: Tab) {
  active.value = t
}
</script>

<template>
  <div class="m-page">
    <header class="m-header">
      <h1 class="m-header-title">{{ current.label }}</h1>
      <p class="m-header-desc">
        {{ active === 'home' ? '选音色，输入文字，生成语音' : '' }}
        {{ active === 'design' ? '用一段描述造一个新声音' : '' }}
        {{ active === 'voice' ? '已保存的音色' : '' }}
        {{ active === 'settings' ? 'API Key 与输出' : '' }}
      </p>
    </header>

    <div class="m-scroll">
      <div v-if="!hasKey" class="m-card" style="border-color: rgba(230, 169, 79, 0.4)">
        <p style="margin: 0 0 10px; font-size: 13.5px">
          还没有配置 API Key，无法生成语音。
        </p>
        <el-button size="small" type="primary" @click="switchTo('settings')">
          去配置
        </el-button>
      </div>

      <MHome v-if="active === 'home'" @need-key="switchTo('settings')" @to-design="switchTo('design')" />
      <MDesign v-else-if="active === 'design'" @need-key="switchTo('settings')" />
      <MVoice v-else-if="active === 'voice'" @need-key="switchTo('settings')" />
      <MSettings v-else-if="active === 'settings'" />
    </div>

    <nav class="m-tabbar">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="m-tab"
        :class="{ active: active === t.key }"
        @click="switchTo(t.key)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <template v-if="t.key === 'home'">
            <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
          </template>
          <template v-else-if="t.key === 'design'">
            <path d="M12 3a9 9 0 0 0 0 18c1.3 0 2.2-.9 2.2-2 0-.6-.3-1-.6-1.4-.3-.4-.6-.8-.6-1.3 0-.9.7-1.6 1.6-1.6H17c2 0 3.5-1.5 3.5-3.4C20.5 6.4 16.7 3 12 3Z" />
            <circle cx="8.5" cy="9" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="13" cy="7" r="1.1" fill="currentColor" stroke="none" />
          </template>
          <template v-else-if="t.key === 'voice'">
            <path d="M4 6.5A2 2 0 0 1 6 4.5h3l1.5 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10Z" />
          </template>
          <template v-else>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
          </template>
        </svg>
        <span>{{ t.label }}</span>
      </button>
    </nav>
  </div>
</template>
