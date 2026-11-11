# 踩坑记录（PITFALLS）

> 面向后续维护者。这里的每一条都是接入小米 MiMo TTS 和打包 Electron 时真实踩到的，不是从文档抄的。
> 建议在动手改 `src/main/providers/mimo.ts` 或 `src/main/store.ts` 之前先读一遍。
>
> 格式统一为 **现象 / 原因 / 解法** 三段。
>
> 实测环境：Windows 11 + Node 20，小米 MiMo 开放平台 `api.xiaomimimo.com`，2026-11-11 实跑。

---

## 一、MiMo API 的五个坑

### 坑 1：正文必须放 `assistant`，放错就没声音

**现象**

请求返回 HTTP 200，但 `choices[0].message` 里没有 `audio.data`，界面报 `E_NO_AUDIO`「服务端未返回音频数据」。反复重试都一样，Key 和模型都没问题。

**原因**

MiMo TTS 沿用 OpenAI Chat Completions 的请求形状，但角色语义和直觉相反：

- `user` = **风格指令**（怎么念：语气、语速、情绪、方言）
- `assistant` = **要合成的正文**（念什么）

这和日常用 ChatGPT 的习惯正好相反。把正文塞进 `user`，服务端认为你没有提供要念的内容，于是返回空音频。这个错误特别隐蔽，因为 HTTP 状态码是 200，不是 4xx。

**解法**

在 `buildMessages()` 里固定映射，不给调用方颠倒的机会：

```ts
// src/main/providers/mimo.ts
const instruction = (req.instruction || '').trim()
if (instruction) messages.push({ role: 'user', content: instruction })

const text = (req.text || '').trim()
if (text) {
  messages.push({ role: 'assistant', content: text })
} else if (!(req.mode === 'design' && req.optimizeTextPreview)) {
  throw new TtsError('E_TEXT_REQUIRED', '合成文本不能为空')
}
```

前端也要配合：界面上「合成文本」大框对应 assistant，「风格指令」小框对应 user，并在 README 里显式讲清楚这个概念——用户最容易在这里翻车。

---

### 坑 2：`voicedesign` 的 `user` 是音色描述，且**不能**传 `audio.voice`

**现象**

- 情况 A：按其他模式的习惯只填正文、不填描述 → 报参数错误或返回默认音色，设计完全没生效。
- 情况 B：为了「保险」同时传了 `audio.voice` → 400，或者请求被静默忽略。

**原因**

音色设计模式下，`user` 消息的语义变了：它**就是音色描述本身**（必填），不是可选的风格指令。同时这个模型不接受任何已有的 voice 引用——它要生成的就是一个全新的音色，不存在「基础音色」的概念。

另外 `optimize_text_preview: true` 时正文（assistant）可以省略，服务端会自动生成一段适配播报的文本，事后通过 `final_text_preview` 返回。

**解法**

```ts
if (req.mode === 'design') {
  const desc = (req.designPrompt || '').trim()
  if (!desc) {
    throw new TtsError('E_DESIGN_PROMPT_REQUIRED', '音色设计模式必须填写音色描述')
  }
  messages.push({ role: 'user', content: desc })
}
// ...
} else if (req.mode === 'design') {
  // design 不支持 audio.voice，明确不传
  if (req.optimizeTextPreview) audio.optimize_text_preview = true
}
```

界面层要做三件事：

1. 音色描述框标必填，空的时候禁用生成按钮。
2. 不展示音色下拉（design 模式没有 voice 可选）。
3. 生成后把 `finalTextPreview` 显示出来——用户开了智能润色就等于把正文交给模型写，不展示的话会疑惑「它到底念了什么」。

---

### 坑 3：`voiceclone` 的 voice 必须是 `data:<mime>;base64,...`，且编码后不许超 10MB

**现象**

- 传本地路径或纯 base64 字符串 → 400 参数错误。
- 传一个大样本 → 400，或请求体过大被网关直接拒。

**原因**

克隆模式的 `audio.voice` 不是音色 ID，而是**内联的音频数据 URI**，格式必须严格是：

```
data:audio/wav;base64,<base64 串>
data:audio/mpeg;base64,<base64 串>
```

服务端对编码后的字符串长度上限是 **10MB**。注意是 base64 之后的长度——base64 会让原始体积膨胀约 33%，所以原文件的安全线要倒推：`10MB / 1.33 ≈ 7.5MB`。

**解法**

```ts
export const CLONE_SAMPLE_MAX_BYTES = Math.floor(7.5 * 1024 * 1024)

function encodeCloneSample(sample: Buffer, filePath: string): string {
  const lower = filePath.toLowerCase()
  let mime: string
  if (lower.endsWith('.mp3')) mime = 'audio/mpeg'
  else if (lower.endsWith('.wav')) mime = 'audio/wav'
  else throw new TtsError('E_SAMPLE_FORMAT', '音色样本仅支持 mp3 / wav 格式')

  const b64 = sample.toString('base64')
  if (b64.length > 10 * 1024 * 1024) {
    throw new TtsError('E_SAMPLE_TOO_LARGE', '音色样本编码后超过 10MB 上限，请裁剪或压缩')
  }
  return `data:${mime};base64,${b64}`
}
```

前端要**提前拦**：文件超过 7.5MB 直接拒绝，不要让用户等上传到一半才失败。克隆页的上传区就是这么做的。

> 顺带的伦理要求：克隆页底部必须保留「请确保你有权使用该音频样本」的提示。这不是免责话术摆设，是这类功能的底线。

---

### 坑 4：流式只有 `preset` 是真流式

**现象**

在 design / clone 模式打开 `stream: true`，进度条长时间不动，然后一次性吐出全部音频；或者请求直接挂住到超时。

**原因**

只有预置音色模型（`mimo-v2.5-tts`）实现了真正的 SSE 增量推送。设计和克隆模型即使接受 `stream: true`，实际行为也是「跑完一次性返回」的兼容模式——首字节时间约等于总耗时。

设计模式要先生成音色再合成，克隆模式要先解析样本再做音色嵌入，这两步都没法提前产出音频帧。

**解法**

1. 主进程只对 preset 开流式：

```ts
const stream = !!req.stream && req.mode === 'preset'
```

2. 界面层对 design / clone **不提供**流式开关（置灰并给出原因，而不是留一个勾了没用的开关）。
3. 进度文案分开写：preset 显示「已接收 xxx KB」，design / clone 只显示「已耗时」和一句「可能需要十几秒」，不要用假进度条骗人。

---

### 坑 5：流式返回 pcm16 裸流，得自己拼 44 字节 WAV 头

**现象**

把 SSE 里 `delta.audio.data` 逐块 base64 解出来拼成一个文件，播放器打不开，或者能播但是刺耳噪音、时长显示异常。

**原因**

流式模式下必须请求 `format: 'pcm16'`（不是 wav）。服务端推的是**裸 PCM 采样数据**，没有容器头。直接把裸 PCM 存成 `.wav`，播放器会把它当成未知数据。

拼接本身也有坑：每个 SSE chunk 的音频是独立的 base64 段，必须**先逐块解码成 Buffer 再拼接**，不能把 base64 字符串拼起来一次性解码（分段边界不在 4 字节对齐处时会解出错误数据）。

**解法**

```ts
/** 把 pcm16 mono 24kHz 裸流包成 WAV */
export function pcm16ToWav(pcm: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const byteRate = sampleRate * channels * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)          // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}
```

拼接侧：

```ts
if (audioData) {
  const b = Buffer.from(audioData, 'base64')   // 逐块解码
  chunks.push(b)
  received += b.length
  opts.onProgress?.(received, Date.now() - started)
}
// 最后：Buffer.concat(chunks) → pcm16ToWav()
```

采样率 24000、单声道、16bit 是当前接口的实际输出，写死成默认参数即可；如果官方以后改了，改这一个函数的默认值就行。

---

## 二、SSE 不主动关连接 → 必须自己加空闲超时

**现象**

流式请求把所有音频都收完了，`reader.read()` 却一直不返回 `done: true`，请求就这么挂着，直到进程被关掉或某个外部超时把它掐了。开发时表现为「进度条 100% 但按钮一直转圈」。

**原因**

服务端推完最后一个数据块后**不会主动关闭 HTTP 连接**。只要连接还开着，`reader.read()` 就会一直 pending。

**解法**

两道超时兜底，都写在 `synthesize()` 里：

```ts
const IDLE_TIMEOUT_MS = 60_000    // 空闲超时：60 秒没有新数据就中断
const TOTAL_TIMEOUT_MS = 300_000  // 总超时：5 分钟硬上限
```

- **空闲超时**：每次收到数据就 `resetIdle()`，重置 60 秒计时器。音频已经收齐、服务端不说话时，60 秒后 `controller.abort()` 把挂住的 `read()` 打断。
- **总超时**：从请求发出就计时的 5 分钟硬上限，防止慢速滴数据永远不结束。
- `finally` 里主动 `reader.cancel()`，别指望对端关。

```ts
let idleTimer: NodeJS.Timeout | undefined
const resetIdle = () => {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS)
}
resetIdle()
// 循环里每收到一块就 resetIdle()
```

注意 abort 后 `fetch` 会抛 `AbortError`，要跟真的网络错误区分开，否则用户看到的报错会莫名其妙：

```ts
if (err?.name === 'AbortError') {
  throw new TtsError('E_TIMEOUT', '请求超时或被取消，请检查网络后重试')
}
```

**这里有个已知的行为细节要留意**：空闲超时是靠 abort 打断 `read()` 的，而 abort 抛出的 `AbortError` 会走到外层 `catch`，最终以 `E_TIMEOUT` 返回——也就是说，即便音频字节已经全部收到，只要连接迟迟不关，这次请求仍然表现为失败、拿不到文件。当前实现的取舍是「宁可失败也不长时间挂住界面」；如果以后要优化，可以在 catch 里判断「已经收到过数据」，把空闲超时当作正常结束处理（直接 `pcm16ToWav` 返回已收的部分），只有零字节时才报 `E_TIMEOUT`。

---

## 三、实测数据（2026-11-11，Windows 11，家庭宽带直连）

这些数字是用来做性能回归对照的，改完代码后可以复测一下有没有明显退化。

| 场景 | 结果 | 备注 |
| --- | --- | --- |
| Key 鉴权 `GET /v1/models` | **0.17s**，HTTP 200 | **不需要代理**，直连 `api.xiaomimimo.com` |
| 预置音色合成 | **1.9s**，**184KB** WAV | 中等长度中文文本 |
| 音色设计 | **1.4s**，**176KB** WAV | 含音色生成，比想象中快 |
| 唱歌标签 `(唱歌)` | **9.3s**，**568KB** WAV | 明显更慢，UI 必须给耗时提示 |
| 音色克隆（非流式） | 单次成功 | 流式路径**挂起过**，所以才有了上面的空闲超时 |
| SSE 流式 | 音频收完连接不关 | 靠 60s 空闲超时兜底退出 |

可用模型（当时探测到的）：`mimo-v2.5-tts`、`mimo-v2.5-tts-voicedesign`、`mimo-v2.5-tts-voiceclone`、`mimo-v2.5-asr`、`mimo-v2.6-flash` / `pro` / `pro-ultraspeed`。

预置音色 ID 是 **中文原文**（`冰糖`、`茉莉`、`苏打`、`白桦`），不是拼音，也不是英文标识。英文音色是 `Mia` / `Chloe` / `Milo` / `Dean`。默认音色 ID 是 `mimo_default`。这些 ID 大小写敏感，写错就是 400。

---

## 四、Electron 打包坑

### 坑 6：不要用 `better-sqlite3`（原生模块 ABI 问题）

**现象**

开发时 `npm run dev` 一切正常，`npm run dist:win` 打出来的 exe 双击后白屏或立刻崩溃，控制台里是：

```
Error: The module '...better_sqlite3.node' was compiled against a different Node.js version
using NODE_MODULE_VERSION xxx. This version of Node.js requires NODE_MODULE_VERSION yyy.
```

有时候不是崩溃而是启动后第一次查询数据库时才抛错，更难定位。

**原因**

Electron 用的是自己内嵌的 Node 运行时，`NODE_MODULE_VERSION` 和系统 Node 不一样。任何含原生 `.node` 二进制的包，都必须按 Electron 的 ABI 重新编译（`electron-rebuild`），否则 ABI 不匹配直接加载失败。而 `electron-builder` 打包时如果没配 `npmRebuild`，就会把针对系统 Node 编译的那份二进制塞进安装包里——本机开发能跑，装到别人机器上就炸，非常不利于开源分发。

**解法**

**不用原生模块。** 这个项目所有持久化都是 JSON 文件：

```ts
// src/main/store.ts
const DATA_DIR = () => path.join(app.getPath('userData'), 'data')
// settings.json / voices.json / history.json + keystore.bin
```

理由很实在：

- 数据量级是千条以内（历史还砍到最近 500 条），JSON 完全够，全量读写都在毫秒级。
- 零编译环节，`npm install` 完直接能打包，CI 上不用装 VS Build Tools。
- 天然跨平台，没有 ABI 兼容问题。

配套要做**原子写**，否则进程被强杀时 JSON 会写成半截：

```ts
async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, file)   // rename 在同一分区上是原子的
}
```

读取侧永远 `try { JSON.parse } catch { return fallback }`，读坏文件就当空数据处理，不给用户看崩溃。

如果将来真的需要上 SQLite，备选是 `sql.js`（WASM，无 ABI 问题）或 `node:sqlite`，但先想清楚是不是又在过早优化。

---

### 坑 7：Windows 上 `npm.ps1` 被执行策略拦截

**现象**

在 PowerShell 里跑 `npm install`，报：

```
npm : 无法加载文件 C:\Program Files\nodejs\npm.ps1，因为在此系统上禁止运行脚本。
```

`npx`、`pnpm`、`yarn` 同理。换成 cmd 或者别的方式又一切正常。

**原因**

PowerShell 的执行策略（Execution Policy）默认是 `Restricted` 或 `RemoteSigned`，而 npm 在 Windows 上装的是 `.ps1` 包装脚本。策略不允许运行本地未签名脚本时，`npm.ps1` 就被拦在入口。

**解法**

按侵入性从小到大选一个：

1. **直接用 `npm.cmd`**（推荐，零副作用）：

   ```powershell
   npm.cmd install
   npm.cmd run dev
   npm.cmd run typecheck
   npm.cmd run dist:win
   ```

2. **放开当前用户的策略**（一次性，持久生效）：

   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   ```

3. 换用 Git Bash / cmd。

顺带一条：GitHub Actions 的 `windows-latest` 默认 shell 就是 PowerShell，但 Actions 的 runner 不继承个人机器的执行策略，所以 `run: npm ci` 在 CI 上是正常的。**本地想复现 CI 时别照抄那条命令到自己的 PowerShell 里**，改用 `npm.cmd ci`，否则可能撞上同一条限制。

---

### 坑 8：模型 ID 会随官方版本变化 → 全部做成可配置

**现象**

某天早上软件突然所有合成请求都失败，返回 `model not found` 或类似错误。代码一行没改。

**原因**

官方会调整模型版本号，比如从 `mimo-v2-tts` 变成 `mimo-v2.5-tts`。ID 一旦改动，写死在业务代码里的常量全部失效——用户只能等作者发新版，这在开源项目里尤其糟糕，因为从 Issue 到发版可能隔好几天，期间所有人都用不了。

**解法**

三层设计：

1. **默认值只是兜底**，集中在 `src/shared/constants.ts` 一处：

   ```ts
   export const DEFAULT_MODELS: ModelMap = {
     preset: 'mimo-v2.5-tts',
     design: 'mimo-v2.5-tts-voicedesign',
     clone: 'mimo-v2.5-tts-voiceclone',
   }
   ```
2. **设置页可编辑**三个模型 ID 和 Base URL，改完保存立即生效，不用重启不用等发版，另有「重置默认」按钮。
3. **`getSettings()` 里做合并修复**，存储被写坏或字段缺失时自动回落到默认值：

   ```ts
   merged.models = { ...DEFAULT_MODELS, ...(stored.models || {}) } as ModelMap
   ```

设置页的「测试连接」调 `GET /v1/models` 并把服务端返回的 ID 列出来，这是排查「是不是官方改 ID 了」最快的手段——不用猜，直接对照。

同样的思路适用于 Base URL：官方换域名时，用户在设置页改一下就好，不必等新版本。

---

## 五、其他值得记住的小事

### 渲染进程播放本地音频：别用 `file://`

**现象**

`<audio src="file:///D:/xxx.wav">` 在开发模式下偶尔能播，打包后不播，控制台里是 `Not allowed to load local resource`。

**原因**

`file://` 协议在 Electron 里受同源与权限限制，而且为了播放音频去开 `webSecurity: false` 或者放开 `file://` 访问，等于把整个磁盘读权限交给渲染进程——一旦页面里有注入风险，后果很严重。

**解法**

注册一个自定义只读协议，且只放行音频扩展名：

```ts
protocol.registerSchemesAsPrivileged([
  { scheme: 'vcmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

const AUDIO_EXT = new Set(['.wav', '.mp3', '.pcm', '.ogg', '.flac', '.m4a'])

protocol.handle('vcmedia', async (request) => {
  const filePath = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''))
  if (!AUDIO_EXT.has(path.extname(filePath).toLowerCase())) {
    return new Response('Forbidden: not an audio file', { status: 403 })
  }
  return await net.fetch(`file:///${filePath.replace(/\\/g, '/')}`)
})
```

同时 CSP 里要放行 `media-src`（`src/renderer/index.html` 已经加了 `vcmedia:`）。

### 波形渲染没用 wavesurfer

**现象**

`wavesurfer.js` 是 devDependencies 里的依赖，但代码里没有 import 它，波形却正常显示。

**原因**

自绘 Canvas + Web Audio 已经能把这件事做好，且完全可控：取 400 个桶，每桶取区间内绝对值最大值做包络，再归一化。避免多引入一个 100KB+ 的库和它的内部 DOM 结构，也顺手绕过了它的一些时序问题。

**解法**

`src/renderer/src/components/Waveform.vue` 负责解码和绘制，其他页面直接复用。新增页面需要波形就用它，**不要再引入 wavesurfer**。

### 设计 token 全部走 CSS 变量

**现象**

某些页面在深色主题下颜色不和谐，或者切换主题后局部还是旧色。

**原因**

写死 hex 了。

**解法**

只用 `src/renderer/src/styles/theme.css` 里的 `--vc-*` 变量。这条是硬约定，PR 里出现硬编码颜色会被要求改。

---

## 六、排查问题时最快的三步

1. 看错误卡片里的 `detail` 字段——`mapHttpError()` 会保留服务端原始响应体前 500 字符，比任何二次包装的文案都准。
2. 去设置页点「测试连接」，确认 Key 和服务端模型列表都对得上。
3. 对着本文档第三节「实测数据」比一下耗时和体积，明显偏离就说明参数或模式用错了（比如误传了 `stream`，或者录音长了三倍）。

如果三条都对不上，再翻 `src/main/providers/mimo.ts` 的五个踩坑注释和错误码表——错误码是 `E_` 前缀，`E_AUTH` / `E_RATE_LIMIT` / `E_BAD_REQUEST` / `E_NO_AUDIO` / `E_TIMEOUT` / `E_NETWORK` / `E_SAMPLE_TOO_LARGE` / `E_DESIGN_PROMPT_REQUIRED` / `E_TEXT_REQUIRED` 各有明确含义。
