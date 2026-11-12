/**
 * 麦克风录音 composable
 *
 * 用途：音色克隆页「直接录一段」——录完做成 wav 样本直接喂给 voiceclone。
 *
 * 技术要点：
 * - MediaRecorder 拿到的 webm/opus 不是 MiMo 接受的格式，必须转 WAV
 * - 转法：把录到的音频块解码成 AudioBuffer（24kHz mono），再手写 RIFF 头
 * - 主进程要能收到字节落盘，走 file.saveBytes
 */
import { ref, onBeforeUnmount } from 'vue'

const TARGET_RATE = 24000

export interface RecordResult {
  /** 写入磁盘后的绝对路径 */
  path: string
  /** 建议的文件名 */
  name: string
  bytes: number
  /** 录音时长（秒） */
  seconds: number
}

/** AudioBuffer → 24kHz mono 16bit WAV */
async function audioBufferToWav(buffer: AudioBuffer): Promise<Uint8Array> {
  // 重采样到 24kHz：用 OfflineAudioContext 做，质量比自己丢点好
  let data: Float32Array
  const ch0 = buffer.getChannelData(0)
  if (buffer.sampleRate === TARGET_RATE) {
    data = ch0
  } else {
    const length = Math.ceil((buffer.duration * TARGET_RATE))
    const off = new OfflineAudioContext(1, length, TARGET_RATE)
    const src = off.createBufferSource()
    const mono = off.createBuffer(1, buffer.length, buffer.sampleRate)
    mono.copyToChannel(ch0, 0)
    src.buffer = mono
    src.connect(off.destination)
    src.start(0)
    const rendered = await off.startRendering()
    data = rendered.getChannelData(0)
  }

  const samples = data.length
  const buf = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buf)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, TARGET_RATE, true)
  view.setUint32(28, TARGET_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples * 2, true)
  let off = 44
  for (let i = 0; i < samples; i++) {
    const s = Math.max(-1, Math.min(1, data[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  return new Uint8Array(buf)
}

export function useRecorder() {
  const recording = ref(false)
  const elapsed = ref(0)
  const level = ref(0)
  const error = ref<string | null>(null)
  const converting = ref(false)

  let stream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  let audioCtx: AudioContext | null = null
  let rafId: number | null = null
  let startedAt = 0

  function cleanup() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {})
      audioCtx = null
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop())
      stream = null
    }
    recorder = null
    level.value = 0
  }

  async function start(): Promise<boolean> {
    error.value = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    } catch (e: any) {
      error.value =
        e?.name === 'NotAllowedError'
          ? '麦克风权限被拒绝。请在系统设置里允许本应用访问麦克风。'
          : `无法打开麦克风：${e?.message || e}`
      return false
    }

    // 实时音量反馈，让用户知道在录
    try {
      audioCtx = new AudioContext()
      const src = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      src.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (let i = 0; i < data.length; i++) {
          peak = Math.max(peak, Math.abs(data[i] - 128) / 128)
        }
        level.value = peak
        rafId = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      /* 音量条失败不影响录音 */
    }

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : ''
    chunks = []
    recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    recorder.start(200)

    startedAt = Date.now()
    elapsed.value = 0
    timer = setInterval(() => {
      elapsed.value = Math.floor((Date.now() - startedAt) / 1000)
      // 超过 60 秒自动停（样本不需要太长，也防止忘关）
      if (elapsed.value >= 60) void stop()
    }, 250)
    recording.value = true
    return true
  }

  /** 停止并转 WAV 落盘 */
  async function stop(): Promise<RecordResult | null> {
    if (!recorder || !recording.value) return null
    recording.value = false

    const blob = await new Promise<Blob | null>((resolve) => {
      const r = recorder!
      r.onstop = () => resolve(new Blob(chunks, { type: r.mimeType || 'audio/webm' }))
      try {
        r.stop()
      } catch {
        resolve(null)
      }
    })
    const seconds = Math.round(((Date.now() - startedAt) / 1000) * 10) / 10
    cleanup()

    if (!blob || blob.size === 0) {
      error.value = '没有录到音频，请检查麦克风'
      return null
    }

    converting.value = true
    try {
      const arr = await blob.arrayBuffer()
      const ctx = new AudioContext()
      const decoded = await ctx.decodeAudioData(arr)
      await ctx.close()
      const wav = await audioBufferToWav(decoded)

      const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '')
      const name = `录音样本-${stamp}.wav`
      const res = await window.vc.file.saveRecordedAudio(name, Array.from(wav))
      if (!res.ok || !res.path) {
        error.value = res.message || '保存录音失败'
        return null
      }
      return { path: res.path, name, bytes: res.bytes ?? wav.length, seconds }
    } catch (e: any) {
      error.value = `音频转换失败：${e?.message || e}`
      return null
    } finally {
      converting.value = false
    }
  }

  function cancel() {
    if (recorder && recording.value) {
      recording.value = false
      try {
        recorder.stop()
      } catch {
        /* ignore */
      }
    }
    chunks = []
    cleanup()
  }

  onBeforeUnmount(() => {
    cancel()
  })

  return { recording, elapsed, level, error, converting, start, stop, cancel }
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(Math.floor(s)).padStart(2, '0')}`
}
