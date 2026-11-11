<script setup lang="ts">
/**
 * 波形组件：用 Web Audio 解码后画峰值，不依赖 wavesurfer。
 * 所有页面共用，保证波形视觉一致。
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = withDefaults(
  defineProps<{
    filePath: string
    currentTime?: number
    duration?: number
    height?: number
    color?: string
    progressColor?: string
  }>(),
  {
    currentTime: 0,
    duration: 0,
    height: 64,
    // 未播放部分是示波器冷青的暗调，播放过头显琥珀主色（呼应录音棚主题）
    color: '#2b3a3d',
    progressColor: '#e8a849',
  },
)

const emit = defineEmits<{ (e: 'seek', time: number): void }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const peaks = ref<number[]>([])
const loading = ref(false)
const err = ref<string | null>(null)

let ctx: AudioContext | null = null
let ro: ResizeObserver | null = null

async function decode(filePath: string) {
  loading.value = true
  err.value = null
  peaks.value = []
  try {
    const url = window.vc.file.toMediaUrl(filePath)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = await res.arrayBuffer()
    ctx = ctx || new AudioContext()
    const audioBuf = await ctx.decodeAudioData(buf)
    const ch = audioBuf.getChannelData(0)
    // 取 400 个采样点，每个点取区间最大值，视觉上更接近真实包络
    const buckets = 400
    const step = Math.max(1, Math.floor(ch.length / buckets))
    const out: number[] = []
    for (let i = 0; i < buckets; i++) {
      let max = 0
      const start = i * step
      const end = Math.min(start + step, ch.length)
      for (let j = start; j < end; j++) {
        const v = Math.abs(ch[j])
        if (v > max) max = v
      }
      out.push(max)
    }
    // 归一化，避免音量小的样本画成一条线
    const peak = Math.max(...out, 0.0001)
    peaks.value = out.map((v) => v / peak)
    draw()
  } catch (e: any) {
    err.value = e?.message || '波形解析失败'
  } finally {
    loading.value = false
  }
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = props.height
  canvas.width = w * dpr
  canvas.height = h * dpr
  const c = canvas.getContext('2d')
  if (!c) return
  c.scale(dpr, dpr)
  c.clearRect(0, 0, w, h)

  if (!peaks.value.length) {
    c.fillStyle = '#20242f'
    c.fillRect(0, h / 2 - 1, w, 2)
    return
  }

  const barW = w / peaks.value.length
  const progress =
    props.duration > 0 ? Math.min(1, props.currentTime / props.duration) : 0
  const progressX = w * progress

  for (let i = 0; i < peaks.value.length; i++) {
    const x = i * barW
    const amp = Math.max(2, peaks.value[i] * (h - 6))
    const y = (h - amp) / 2
    c.fillStyle = x + barW < progressX ? props.progressColor : props.color
    c.fillRect(x, y, Math.max(1, barW - 1), amp)
  }

  // 播放头
  if (progress > 0) {
    c.fillStyle = props.progressColor
    c.fillRect(progressX - 1, 0, 2, h)
  }
}

function onClick(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas || !props.duration) return
  const rect = canvas.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  emit('seek', Math.max(0, Math.min(props.duration, ratio * props.duration)))
}

watch(() => props.filePath, (p) => { if (p) decode(p) })
watch(
  () => [props.currentTime, props.duration],
  () => draw(),
)

onMounted(() => {
  if (props.filePath) decode(props.filePath)
  const canvas = canvasRef.value
  if (canvas) {
    ro = new ResizeObserver(() => draw())
    ro.observe(canvas)
  }
})

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})

defineExpose({ redraw: draw })
</script>

<template>
  <div class="wave-wrap" :style="{ height: height + 'px' }">
    <canvas ref="canvasRef" class="wave-canvas" @click="onClick" />
    <div v-if="loading" class="wave-overlay">解析波形…</div>
    <div v-else-if="err" class="wave-overlay err">{{ err }}</div>
  </div>
</template>

<style scoped>
.wave-wrap {
  position: relative;
  width: 100%;
  background: var(--vc-bg-input);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-sm);
  overflow: hidden;
}

.wave-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: pointer;
}

.wave-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--vc-text-muted);
  background: rgba(18, 21, 28, 0.75);
}

.wave-overlay.err {
  color: var(--vc-danger);
}
</style>
