<script setup lang="ts">
/**
 * 音色设计页（voicedesign 模式）
 *
 * 这是本产品的差异化页面：用一段文字描述「凭空造」一个不存在的声音。
 * 对应 API 事实（已实测）：
 * - design 模式的 user 消息 = 音色描述本身，必填；
 * - 不能传 audio.voice，也不支持 (唱歌) 标签；
 * - 不是真流式，服务端一次性返回，通常 1～3 秒；
 * - optimize_text_preview 为 true 时可省略 assistant 正文，由模型自动写播报稿。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { AudioFormat, VoiceAsset } from '../../../shared/types'
import { useSynth, MODE_META, FORMAT_OPTIONS } from '../composables/useSynth'
import AudioPlayer from '../components/AudioPlayer.vue'

const emit = defineEmits<{ (e: 'need-key'): void }>()

/**
 * preload 里 voices.upsert 的形参写成完整 VoiceAsset，但主进程接受 Partial
 * （缺 id 时自增）。这里用一个局部类型描述真实入参，调用处只做一次收窄。
 */
type VoiceUpsertInput = Partial<VoiceAsset> & { name: string; source: VoiceAsset['source'] }

const { loading, error, result, finalText, runningMs, humanElapsed, run } = useSynth()

// ---------- 表单状态 ----------
const description = ref('')
const text = ref('')
const optimize = ref(false)
const format = ref<AudioFormat>('wav')
const hasKey = ref(true)

onMounted(async () => {
  try {
    const s = await window.vc.settings.get()
    hasKey.value = s.hasApiKey
    format.value = s.defaultFormat
  } catch {
    hasKey.value = false
  }
})

// ---------- 描述模板库 ----------
interface TemplateItem {
  key: string
  title: string
  desc: string
  text: string
}

interface TemplateGroup {
  key: string
  title: string
  /** 这一类的写作思路，帮助用户理解为什么这么写 */
  sub: string
  items: TemplateItem[]
}

const templateGroups: TemplateGroup[] = [
  {
    key: 'brief',
    title: '简洁描述型',
    sub: '一句话交代「年龄性别 + 口音 + 声音气质」，适合先快速试出一个方向，再逐层加细节。',
    items: [
      {
        key: 'brief-ru',
        title: '俄语口音的大叔',
        desc: '最短的可用描述，三个特征就够出效果',
        text: 'Heavy Russian accent, gruff middle-aged male, blunt and matter-of-fact.',
      },
      {
        key: 'brief-doc',
        title: '英式纪录片旁白',
        desc: '冷静克制的中性叙述者',
        text: 'Calm British female narrator in her early thirties, neutral broadcast delivery, unhurried pacing, documentary voice-over.',
      },
    ],
  },
  {
    key: 'pro',
    title: '专业描述型',
    sub: '把「录音距离、气息、口腔动作、语速」都写进去，适合 ASMR、有声书、广告这类对质感要求高的场景。',
    items: [
      {
        key: 'pro-asmr',
        title: '贴耳 ASMR 女声',
        desc: '写清录音方式与细微声响，质感最明显',
        text: 'Young female, extreme close-up with a binaural, ear-to-ear ASMR feel. Audible breathing, subtle swallowing, and soft natural lip sounds. She speaks very slowly.',
      },
      {
        key: 'pro-audiobook',
        title: '有声书旁白',
        desc: '近场、气息稳、带一点笑意',
        text: 'Warm middle-aged female audiobook narrator, close-mic, gentle breath support, clear articulation, a faint smile in the voice, steady and patient pacing.',
      },
    ],
  },
  {
    key: 'person',
    title: '中文人物型',
    sub: '用中文写「一个人」而不是「一个参数」：他的年纪、经历、此刻的状态，都会影响声音。',
    items: [
      {
        key: 'person-old',
        title: '沧桑的老爷爷',
        desc: '带口音、语速慢、沙哑，讲故事的语感',
        text: '一位年迈的老先生，说带北方口音的普通话，语速缓慢而沉稳，嗓音略带沙哑和沧桑感，仿佛一位饱经风霜的老爷爷在讲故事。',
      },
      {
        key: 'person-anchor',
        title: '晚间新闻女主播',
        desc: '标准普通话、明亮而克制，用于对公播报',
        text: '一位三十岁出头的女性新闻主播，普通话标准，吐字清晰利落，声线明亮而克制，语速均匀不带情绪起伏，像在播报晚间新闻。',
      },
    ],
  },
  {
    key: 'director',
    title: '导演模式',
    sub: '角色 / 场景 / 指导 三段式。给模型的是「一场戏」，它会把情绪层次和停顿一起演出来，最适合有声剧、剧情广告、角色配音。',
    items: [
      {
        key: 'director-bookshop',
        title: '旧书铺掌柜（剧情旁白）',
        desc: '三段式完整示例：人设 + 处境 + 表演指导',
        text: [
          '【角色】一位年近七旬的旧书铺掌柜，说话带着旧派文人的咬字习惯，声音干瘦却有筋骨，嗓子常年被旱烟熏得发哑。',
          '【场景】深夜打烊的旧书铺，一盏油灯，窗外正下着冷雨。他在给唯一的老主顾交代一本残本的来历。',
          '【指导】开场压低嗓音，像怕被雨里的人听见；说到书页缺损时，不自觉地叹一口气，语气放软、语速变慢；结尾把书往前一推，语调陡然干脆，带一点不容置疑的倔。',
        ].join('\n'),
      },
      {
        key: 'director-teacher',
        title: '支教老师（告别独白）',
        desc: '情绪有起伏、有卡顿，适合短剧与公益片',
        text: [
          '【角色】一个二十八岁的山区支教老师，普通话里掺着一点南方口音，声音清亮，但已经带了些哑。',
          '【场景】放学后的空教室，她对着手机录一段留给孩子们的告别语音。',
          '【指导】前半段努力保持轻快，说到「老师要走了」时卡住半秒；中间有一次没忍住的吸气，尾音发虚；最后一句重新稳住，像在替自己也替孩子们打气。',
        ].join('\n'),
      },
    ],
  },
  {
    key: 'accent',
    title: '口音与地域型',
    sub: '方言与地方口音写「语气习惯」比写「口音很重」更有效：尾音、语速、招呼人的方式都是线索。',
    items: [
      {
        key: 'accent-cd',
        title: '成都茶馆老板',
        desc: '四川口音、热络、语速偏快',
        text: '四川口音的中年男声，语气热络，语速偏快，尾音习惯上扬，像街边茶馆里招呼熟客的老板，边说边笑。',
      },
      {
        key: 'accent-ne',
        title: '东北大哥',
        desc: '嗓门大、直爽、带笑意',
        text: '带浓重东北口音的年轻男声，嗓门大，语气直爽带着笑意，说话利落不拖沓，有股热乎乎的豪爽劲儿。',
      },
    ],
  },
]

const activeGroup = ref<string>(templateGroups[0].key)
const libOpen = ref(true)
const activeGroupMeta = computed(
  () => templateGroups.find((g) => g.key === activeGroup.value) ?? templateGroups[0],
)

async function applyTemplate(item: TemplateItem) {
  const cur = description.value.trim()
  if (cur && cur !== item.text.trim()) {
    try {
      await ElMessageBox.confirm(
        '当前已有一版音色描述，填入模板会覆盖它。',
        '覆盖描述？',
        {
          type: 'warning',
          confirmButtonText: '覆盖',
          cancelButtonText: '取消',
        },
      )
    } catch {
      return
    }
  }
  description.value = item.text
  ElMessage.success(`已填入「${item.title}」，可以继续改成你要的声音`)
}

function clearDescription() {
  description.value = ''
}

// ---------- 四维度快捷词组 ----------
interface DimensionGroup {
  key: string
  title: string
  hint: string
  chips: string[]
}

const dimensions: DimensionGroup[] = [
  {
    key: 'who',
    title: '性别与年龄',
    hint: '先定人，声音的厚度与音高基本就定了',
    chips: ['年轻女性，二十出头', '中年男性，四十岁上下', '年迈的老人', '十几岁的少年'],
  },
  {
    key: 'timbre',
    title: '音色质感',
    hint: '写质感而不是写形容词堆叠：沙哑、气声、共鸣位置',
    chips: ['嗓音沙哑', '胸腔共鸣厚实', '气声偏多、贴耳很近', '声音清脆明亮'],
  },
  {
    key: 'mood',
    title: '情绪与语气',
    hint: '此刻是什么心情，比「好听」有用得多',
    chips: ['语气克制', '热情爽朗', '怅然若失', '带着笑意'],
  },
  {
    key: 'pace',
    title: '语速与节奏',
    hint: '节奏决定听感，长文案尤其要写',
    chips: ['语速缓慢', '语速偏快', '节奏均匀', '句与句之间停顿明显'],
  },
]

const tipsOpen = ref(false)

function appendPhrase(phrase: string) {
  const cur = description.value.trim()
  if (!cur) {
    description.value = `${phrase}。`
  } else {
    const needsStop = !/[。！？.!?，,；;、]$/.test(cur)
    description.value = `${cur}${needsStop ? '。' : ''}${phrase}。`
  }
}

// ---------- 生成 ----------
async function generate() {
  const desc = description.value.trim()
  if (!desc) {
    ElMessage.warning('请先写一段音色描述')
    return
  }
  if (!optimize.value && !text.value.trim()) {
    ElMessage.warning('未开启智能润色时，必须填写要朗读的文本')
    return
  }
  try {
    const s = await window.vc.settings.get()
    hasKey.value = s.hasApiKey
  } catch {
    hasKey.value = false
  }
  if (!hasKey.value) {
    ElMessage.warning('尚未配置 API Key，请先到设置页填写')
    emit('need-key')
    return
  }

  savedName.value = ''
  const res = await run({
    mode: 'design',
    text: text.value.trim(),
    designPrompt: desc,
    format: format.value,
    optimizeTextPreview: optimize.value,
  })
  if (res) {
    ElMessage.success(`生成成功，耗时 ${(res.elapsedMs / 1000).toFixed(1)} 秒`)
  }
}

// ---------- 存为我的音色 ----------
const saveDialog = ref(false)
const voiceName = ref('')
const saving = ref(false)
const savedName = ref('')

function defaultVoiceName(): string {
  const desc = description.value.trim()
  if (!desc) return '设计音色'
  const first = desc.split(/[。！？.!?\n]/)[0].trim()
  return `设计音色 · ${first.slice(0, 14)}`
}

function openSave() {
  voiceName.value = defaultVoiceName()
  saveDialog.value = true
}

async function confirmSave() {
  const name = voiceName.value.trim()
  if (!name) {
    ElMessage.warning('请给这个音色起个名字')
    return
  }
  const desc = description.value.trim()
  saving.value = true
  try {
    const input: VoiceUpsertInput = {
      name,
      source: 'design',
      // design 音的 payload 就是描述词，之后在合成页选中它时可直接复用
      payload: desc,
      description: desc,
    }
    await window.vc.voices.upsert(input as VoiceAsset)
    savedName.value = name
    saveDialog.value = false
    ElMessage.success(`已存入「我的音色」：${name}`)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="vc-page design-page">
    <!-- 顶部说明条 -->
    <div class="notice-bar">
      <div class="notice-mark">🎨</div>
      <div class="notice-body">
        <div class="notice-title">
          用一句话，造一个世界上还不存在的声音
          <span :class="MODE_META.design.tag">音色设计</span>
        </div>
        <p class="notice-text">音色设计 ≠ 从预置里挑一个，也 ≠ 复刻一段录音。你写的是对这个声音的<b>描述</b>（年龄、性别、口音、音色质感、情绪、语速），我们把它作为 <code>user</code> 消息发给 <code>voicedesign</code> 模型，模型先生成一个全新音色，再朗读你给的正文。</p>
        <p class="notice-text">该模式<b>不能指定预置音色</b>（不传 <code>audio.voice</code>）、<b>不支持 (唱歌)</b>，也不是真流式，通常 1～3 秒一次性返回。</p>
      </div>
    </div>

    <div v-if="!hasKey" class="key-warn">
      <span>⚠ 还没有配置 API Key，生成会失败。</span>
      <el-button size="small" type="primary" plain @click="emit('need-key')">
        去设置页配置
      </el-button>
    </div>

    <div class="design-grid">
      <!-- ================= 左栏 ================= -->
      <div class="col">
        <!-- 音色描述 -->
        <section class="vc-card">
          <h3 class="vc-card-title">
            音色描述
            <span class="req">必填</span>
            <span class="vc-spacer" />
            <span class="count vc-mono">{{ description.length }} 字</span>
          </h3>
          <el-textarea
            v-model="description"
            :rows="9"
            :maxlength="1200"
            resize="vertical"
            placeholder="例：一位年近七旬的老先生，说带北方口音的普通话，语速缓慢而沉稳，嗓音略带沙哑和沧桑感。&#10;&#10;建议 1～4 句，写清「谁在说、声音什么样、此刻什么状态」。"
          />
          <div class="desc-actions">
            <el-button size="small" :disabled="!description" @click="clearDescription">
              清空
            </el-button>
            <el-button size="small" @click="libOpen = true">从模板填入</el-button>
            <span class="vc-spacer" />
            <span class="vc-hint inline">这段文字会原样作为 user 消息发出去</span>
          </div>
        </section>

        <!-- 描述模板库 -->
        <section class="vc-card">
          <h3 class="vc-card-title lib-head" @click="libOpen = !libOpen">
            <span>描述模板库</span>
            <span class="lib-badge">5 类 · 10 例</span>
            <span class="vc-spacer" />
            <span class="collapse-arrow" :class="{ open: libOpen }">▾</span>
          </h3>

          <div v-show="libOpen" class="lib-body">
            <div class="lib-tabs">
              <button
                v-for="g in templateGroups"
                :key="g.key"
                class="lib-tab"
                :class="{ active: activeGroup === g.key }"
                @click="activeGroup = g.key"
              >
                {{ g.title }}
              </button>
            </div>

            <p class="lib-sub">{{ activeGroupMeta.sub }}</p>

            <div class="lib-items">
              <button
                v-for="item in activeGroupMeta.items"
                :key="item.key"
                class="lib-item"
                :title="`点击填入：${item.title}`"
                @click="applyTemplate(item)"
              >
                <span class="lib-item-top">
                  <span class="lib-item-title">{{ item.title }}</span>
                  <span class="lib-fill">填入 →</span>
                </span>
                <span class="lib-item-desc">{{ item.desc }}</span>
                <span class="lib-preview">{{ item.text }}</span>
              </button>
            </div>
          </div>
        </section>

        <!-- 写作技巧 -->
        <section class="vc-card">
          <h3 class="vc-card-title lib-head" @click="tipsOpen = !tipsOpen">
            <span>写作技巧 · 四维度</span>
            <span class="vc-spacer" />
            <span class="collapse-arrow" :class="{ open: tipsOpen }">▾</span>
          </h3>

          <div v-show="tipsOpen" class="tips-body">
            <div v-for="d in dimensions" :key="d.key" class="dim">
              <div class="dim-head">
                <span class="dim-title">{{ d.title }}</span>
                <span class="dim-hint">{{ d.hint }}</span>
              </div>
              <div class="dim-chips">
                <button
                  v-for="c in d.chips"
                  :key="c"
                  class="chip"
                  :title="`追加：${c}`"
                  @click="appendPhrase(c)"
                >
                  + {{ c }}
                </button>
              </div>
            </div>

            <div class="vc-divider" />

            <ul class="rules">
              <li><b>建议 1～4 句</b>，先写人、再写声音、最后写状态。</li>
              <li><b>避免互相矛盾</b>的特征，例如「低沉浑厚的少女音」这类描述，模型只能二选一，结果随机。</li>
              <li><b>避免后期与混响词</b>，例如「加了混响」「压缩感强」「EQ 提升」——这些属于音频处理，不属于音色。</li>
              <li>中英文都可以写，写中文人物时用「他/她是什么样的人」比罗列形容词更稳。</li>
            </ul>
          </div>
        </section>
      </div>

      <!-- ================= 右栏 ================= -->
      <div class="col">
        <!-- 合成参数 -->
        <section class="vc-card">
          <h3 class="vc-card-title">合成文本</h3>

          <div class="opt-row">
            <div class="opt-text">
              <div class="opt-label">智能润色播报稿</div>
              <div class="vc-hint inline">开启后可留空文本，由模型自动写一段适配该音色的播报文本；写了文本则在此基础上适配。</div>
            </div>
            <el-switch v-model="optimize" />
          </div>

          <el-textarea
            v-model="text"
            :rows="7"
            :maxlength="3000"
            resize="vertical"
            :placeholder="
              optimize
                ? '可留空 —— 开启智能润色后，将自动生成适配播报的文本。也可以自己写。'
                : '要让它读出来的内容，例如：各位听众，晚上好。'
            "
          />

          <div v-if="optimize" class="hint-banner">
            已开启 <code>optimize_text_preview</code>：文本可以为空，返回后可在下方看到模型实际念的稿子。
          </div>

          <div class="field">
            <label class="vc-label">输出格式</label>
            <el-radio-group v-model="format" size="small">
              <el-radio-button
                v-for="f in FORMAT_OPTIONS"
                :key="f.value"
                :value="f.value"
              >
                {{ f.label }}
              </el-radio-button>
            </el-radio-group>
            <p class="vc-hint">
              {{ FORMAT_OPTIONS.find((f) => f.value === format)?.desc }}
            </p>
          </div>

          <el-button
            class="gen-btn"
            type="primary"
            :loading="loading"
            :disabled="!description.trim()"
            @click="generate"
          >
            {{ loading ? '正在生成…' : '设计并合成' }}
          </el-button>

          <div v-if="loading" class="progress-box">
            <span class="spin" />
            <span>正在按描述生成音色…已等待 {{ (runningMs / 1000).toFixed(1) }}s</span>
          </div>

          <div v-if="error" class="err-box">
            <div class="err-title">生成失败</div>
            <p class="err-msg vc-selectable">{{ error }}</p>
            <p class="vc-hint">
              常见原因：描述为空、描述中存在互相矛盾的特征、或 API Key／额度问题。
            </p>
          </div>
        </section>

        <!-- 结果 -->
        <section v-if="result" class="vc-card">
          <h3 class="vc-card-title">
            生成结果
            <span class="vc-tag">{{ humanElapsed }}</span>
            <span v-if="result.usage" class="vc-tag vc-tag-info">
              {{ result.usage.totalTokens }} tokens
            </span>
          </h3>

          <AudioPlayer
            :file-path="result.filePath"
            :bytes="result.bytes"
            title="音色设计音频"
            :meta="`耗时 ${humanElapsed}`"
          />

          <div class="result-actions">
            <el-button type="primary" :disabled="!!savedName" @click="openSave">
              {{ savedName ? `已存为「${savedName}」` : '存为我的音色' }}
            </el-button>
            <el-button :loading="loading" @click="generate">再生成一版</el-button>
          </div>

          <div v-if="finalText" class="preview-block">
            <div class="preview-head">
              模型实际播报的文本
              <span class="preview-tag">final_text_preview</span>
            </div>
            <p class="preview-body vc-selectable">{{ finalText }}</p>
          </div>
          <p v-else class="vc-hint">
            本次没有返回润色文本（未开启智能润色时属正常）。想确认模型念了什么，可勾选上方的「智能润色播报稿」再生成一次。
          </p>
        </section>
      </div>
    </div>

    <!-- 存为音色弹窗 -->
    <el-dialog v-model="saveDialog" title="存为我的音色" width="460px">
      <p class="vc-hint" style="margin-top: 0">
        保存后可在「语音合成」页直接选用，不需要重新写描述。
      </p>
      <label class="vc-label">音色名称</label>
      <el-input
        v-model="voiceName"
        maxlength="40"
        show-word-limit
        placeholder="给这个声音起个名字"
        @keyup.enter="confirmSave"
      />
      <label class="vc-label" style="margin-top: 12px">描述（随音色一起保存）</label>
      <el-textarea :model-value="description" :rows="4" readonly />
      <template #footer>
        <el-button @click="saveDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="confirmSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.design-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ---------- 顶部说明 ---------- */
.notice-bar {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  background: var(--vc-bg-panel);
  border: 1px solid var(--vc-border);
  border-left: 3px solid var(--vc-info);
  border-radius: var(--vc-radius-md);
  padding: 14px 16px;
}

.notice-mark {
  font-size: 20px;
  line-height: 1.2;
}

.notice-body {
  min-width: 0;
}

.notice-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13.5px;
  font-weight: 650;
}

.notice-text {
  font-size: 12.5px;
  color: var(--vc-text-secondary);
  line-height: 1.75;
  margin: 6px 0 0;
}

.notice-text b {
  color: var(--vc-text-primary);
  font-weight: 600;
}

.notice-text code,
.hint-banner code {
  font-family: var(--vc-font-mono);
  font-size: 11.5px;
  background: var(--vc-bg-input);
  border: 1px solid var(--vc-border);
  padding: 0 4px;
  border-radius: 3px;
  color: var(--vc-accent);
}

.key-warn {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12.5px;
  color: var(--vc-warning);
  background: var(--vc-bg-panel);
  border: 1px solid var(--vc-border);
  border-left: 3px solid var(--vc-warning);
  border-radius: var(--vc-radius-md);
  padding: 10px 14px;
}

/* ---------- 栅格 ---------- */
.design-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

@media (max-width: 1180px) {
  .design-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.req {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: none;
  color: var(--vc-warning);
}

.count {
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--vc-text-muted);
}

.desc-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.vc-hint.inline {
  margin-top: 0;
}

/* ---------- 模板库 ---------- */
.lib-head {
  cursor: pointer;
  user-select: none;
  margin-bottom: 0;
}

.lib-body {
  margin-top: 12px;
}

.lib-badge {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  color: var(--vc-info);
  background: var(--vc-bg-elevated);
  border: 1px solid var(--vc-border);
  border-radius: 999px;
  padding: 1px 7px;
}

.collapse-arrow {
  font-size: 11px;
  color: var(--vc-text-muted);
  transition: transform 0.16s;
}

.collapse-arrow.open {
  transform: rotate(180deg);
}

.lib-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.lib-tab {
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid var(--vc-border);
  background: var(--vc-bg-elevated);
  color: var(--vc-text-secondary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
}

.lib-tab:hover {
  border-color: var(--vc-border-strong);
  color: var(--vc-text-primary);
}

.lib-tab.active {
  background: var(--vc-accent-soft);
  border-color: var(--vc-accent);
  color: var(--vc-accent);
  font-weight: 600;
}

.lib-sub {
  font-size: 11.5px;
  color: var(--vc-text-muted);
  line-height: 1.65;
  margin: 10px 0;
}

.lib-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lib-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-sm);
  background: var(--vc-bg-input);
  color: var(--vc-text-primary);
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
}

.lib-item:hover {
  border-color: var(--vc-accent);
  background: var(--vc-bg-hover);
}

.lib-item-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lib-item-title {
  font-size: 12.5px;
  font-weight: 600;
}

.lib-fill {
  margin-left: auto;
  font-size: 11px;
  color: var(--vc-accent);
  opacity: 0;
  transition: opacity 0.12s;
}

.lib-item:hover .lib-fill {
  opacity: 1;
}

.lib-item-desc {
  font-size: 11px;
  color: var(--vc-text-secondary);
}

.lib-preview {
  font-size: 11.5px;
  color: var(--vc-text-muted);
  line-height: 1.6;
  white-space: pre-wrap;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ---------- 技巧 ---------- */
.tips-body {
  margin-top: 12px;
}

.dim + .dim {
  margin-top: 12px;
}

.dim-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.dim-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--vc-text-primary);
}

.dim-hint {
  font-size: 11px;
  color: var(--vc-text-muted);
}

.dim-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}

.chip {
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--vc-border);
  background: var(--vc-bg-elevated);
  color: var(--vc-text-secondary);
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
}

.chip:hover {
  border-color: var(--vc-accent);
  color: var(--vc-accent);
  background: var(--vc-accent-soft);
}

.rules {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--vc-text-secondary);
  line-height: 1.85;
}

.rules b {
  color: var(--vc-text-primary);
}

/* ---------- 右栏表单 ---------- */
.opt-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 10px 12px;
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-sm);
  background: var(--vc-bg-input);
  margin-bottom: 12px;
}

.opt-text {
  min-width: 0;
}

.opt-label {
  font-size: 12.5px;
  font-weight: 600;
  margin-bottom: 2px;
}

.hint-banner {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--vc-info);
  background: var(--vc-bg-input);
  border: 1px solid var(--vc-border);
  border-left: 2px solid var(--vc-info);
  border-radius: var(--vc-radius-sm);
  padding: 8px 10px;
  line-height: 1.6;
}

.field {
  margin-top: 14px;
}

.gen-btn {
  width: 100%;
  margin-top: 16px;
  height: 38px;
}

.progress-box {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--vc-accent);
  background: var(--vc-accent-soft);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-sm);
  padding: 9px 12px;
}

.spin {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--vc-accent);
  border-top-color: transparent;
  animation: vc-spin 0.8s linear infinite;
  flex-shrink: 0;
}

.err-box {
  margin-top: 12px;
  background: var(--vc-bg-input);
  border: 1px solid var(--vc-border);
  border-left: 3px solid var(--vc-danger);
  border-radius: var(--vc-radius-sm);
  padding: 10px 12px;
}

.err-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--vc-danger);
}

.err-msg {
  font-size: 12px;
  color: var(--vc-text-secondary);
  margin: 4px 0 0;
  line-height: 1.6;
  word-break: break-all;
}

.result-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.preview-block {
  margin-top: 14px;
  background: var(--vc-bg-input);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-sm);
  padding: 10px 12px;
}

.preview-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--vc-text-secondary);
  margin-bottom: 6px;
}

.preview-tag {
  font-family: var(--vc-font-mono);
  font-size: 10px;
  font-weight: 400;
  color: var(--vc-text-muted);
  background: var(--vc-bg-elevated);
  border: 1px solid var(--vc-border);
  border-radius: 3px;
  padding: 0 5px;
}

.preview-body {
  font-size: 12.5px;
  color: var(--vc-text-primary);
  line-height: 1.75;
  margin: 0;
  white-space: pre-wrap;
}
</style>
