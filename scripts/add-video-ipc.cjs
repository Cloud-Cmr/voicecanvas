// 加视频处理 IPC 通道
const fs = require('fs')
const f = 'src/shared/types.ts'
let c = fs.readFileSync(f, 'utf8')
if (!c.includes('videoExtractFrames')) {
  c = c.replace(
    "  whisperTranscribe: 'whisper:transcribe',",
    "  whisperTranscribe: 'whisper:transcribe',\n  videoExtractFrames: 'video:extractFrames',\n  videoExtractAudio: 'video:extractAudio',\n  videoMuxAudio: 'video:muxAudio',\n  ocrFrames: 'ocr:frames',\n  videoPickOpen: 'video:pickOpen',",
  )
  fs.writeFileSync(f, c)
  console.log('✓ video IPC 通道已加')
} else {
  console.log('已存在，跳过')
}
