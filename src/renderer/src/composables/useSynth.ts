import { ref, computed } from 'vue'
import type { AudioFormat, SynthRequest, SynthResponse, TtsMode } from '../../../shared/types'

export interface SynthState {
  loading: boolean
  error: string | null
  result: Extract<SynthResponse, { ok: true }> | null
  receivedBytes: number
  elapsedMs: number
}

/**
 * 统一合成逻辑：三个页面共用，避免各写一套进度/错误处理。
 */
export function useSynth() {
  const loading = ref(false)
  const error = ref<string | null>(null)
  const result = ref<Extract<SynthResponse, { ok: true }> | null>(null)
  const receivedBytes = ref(0)
  const elapsedMs = ref(0)
  const runningMs = ref(0)
  const finalText = ref<string>('')

  let ticker: ReturnType<typeof setInterval> | null = null
  let offProgress: (() => void) | null = null

  function startTicker() {
    const t0 = Date.now()
    runningMs.value = 0
    ticker = setInterval(() => {
      runningMs.value = Date.now() - t0
    }, 100)
  }

  function stopTicker() {
    if (ticker) {
      clearInterval(ticker)
      ticker = null
    }
  }

  async function run(req: SynthRequest) {
    if (loading.value) return null
    loading.value = true
    error.value = null
    result.value = null
    receivedBytes.value = 0
    elapsedMs.value = 0
    finalText.value = ''

    offProgress = window.vc.synth.onProgress((e) => {
      receivedBytes.value = e.receivedBytes
      elapsedMs.value = e.elapsedMs
    })
    startTicker()

    try {
      const res = await window.vc.synth.run(req)
      if (res.ok) {
        result.value = res
        finalText.value = res.finalTextPreview || ''
        return res
      }
      error.value = res.message
      return null
    } catch (e: any) {
      error.value = e?.message || String(e)
      return null
    } finally {
      stopTicker()
      loading.value = false
      offProgress?.()
      offProgress = null
    }
  }

  const humanElapsed = computed(() => {
    const ms = loading.value ? runningMs.value : (result.value?.elapsedMs ?? 0)
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
  })

  return {
    loading,
    error,
    result,
    receivedBytes,
    elapsedMs,
    runningMs,
    humanElapsed,
    finalText,
    run,
  }
}

/** 格式选项 */
export const FORMAT_OPTIONS: Array<{ value: AudioFormat; label: string; desc: string }> = [
  { value: 'wav', label: 'WAV', desc: '无损，体积大，适合后期处理' },
  { value: 'mp3', label: 'MP3', desc: '压缩，体积小，适合直接分发' },
]

/** 模式的中文名与配色，三个页面统一口径 */
export const MODE_META: Record<TtsMode, { label: string; tag: string }> = {
  preset: { label: '预置音色', tag: 'vc-tag' },
  design: { label: '音色设计', tag: 'vc-tag vc-tag-info' },
  clone: { label: '音色克隆', tag: 'vc-tag vc-tag-warn' },
}
