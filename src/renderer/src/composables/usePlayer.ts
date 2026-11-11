import { ref, onBeforeUnmount, watch } from 'vue'

/**
 * 音频播放 + 波形。
 *
 * 播放源来自主进程落盘的文件，通过自定义协议 vcmedia:// 读取，
 * 避免给渲染进程开 file:// 权限。
 */
export function usePlayer() {
  const audio = ref<HTMLAudioElement | null>(null)
  const playing = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const volume = ref(1)
  const src = ref<string>('')
  const loading = ref(false)
  const failed = ref<string | null>(null)

  function ensureAudio(): HTMLAudioElement {
    if (!audio.value) {
      const el = new Audio()
      el.preload = 'auto'
      el.addEventListener('timeupdate', () => {
        currentTime.value = el.currentTime
      })
      el.addEventListener('loadedmetadata', () => {
        duration.value = Number.isFinite(el.duration) ? el.duration : 0
        loading.value = false
      })
      el.addEventListener('ended', () => {
        playing.value = false
        currentTime.value = 0
      })
      el.addEventListener('error', () => {
        playing.value = false
        loading.value = false
        failed.value = '音频加载失败，可能是文件已被移动或删除'
      })
      audio.value = el
    }
    return audio.value
  }

  /** 用本地绝对路径加载 */
  function load(filePath: string) {
    const el = ensureAudio()
    failed.value = null
    loading.value = true
    playing.value = false
    currentTime.value = 0
    duration.value = 0
    src.value = window.vc.file.toMediaUrl(filePath)
    el.src = src.value
    el.load()
  }

  async function toggle() {
    const el = ensureAudio()
    if (!el.src) return
    if (playing.value) {
      el.pause()
      playing.value = false
    } else {
      try {
        await el.play()
        playing.value = true
      } catch (e: any) {
        failed.value = e?.message || '播放失败'
      }
    }
  }

  function seek(t: number) {
    const el = ensureAudio()
    if (!el.src) return
    el.currentTime = Math.max(0, Math.min(t, duration.value || t))
    currentTime.value = el.currentTime
  }

  function stop() {
    const el = ensureAudio()
    el.pause()
    el.currentTime = 0
    playing.value = false
    currentTime.value = 0
  }

  watch(volume, (v) => {
    const el = ensureAudio()
    el.volume = v
  })

  onBeforeUnmount(() => {
    if (audio.value) {
      audio.value.pause()
      audio.value.src = ''
    }
  })

  return {
    playing,
    currentTime,
    duration,
    volume,
    src,
    loading,
    failed,
    load,
    toggle,
    seek,
    stop,
  }
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
