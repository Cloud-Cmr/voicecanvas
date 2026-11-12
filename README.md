# 声绘 VoiceCanvas

> 一个本地优先的桌面端 AI 语音工作台：把「文本 → 多种音色 → 可交付音频」做成流水线，而不只是给 API 套一层皮。

![License](https://img.shields.io/badge/license-MIT-3ddc97)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-4a9eff)
![Electron](https://img.shields.io/badge/Electron-33-47848F)
![Vue](https://img.shields.io/badge/Vue-3.5-42b883)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6)

首发适配小米 **MiMo TTS**，支持预置音色、音色设计、音色克隆三种合成方式。

---

## ⚠️ 免责声明

**本项目是第三方非官方客户端，与小米公司及其关联方无任何隶属、合作或背书关系。**

- 「小米」「MiMo」等名称、商标归其各自权利人所有，本项目仅作事实性指代。
- 语音合成服务由 **小米 MiMo 开放平台**（`platform.xiaomimimo.com`）提供，你需要自行注册账号、获取 API Key，并遵守其服务条款与计费规则。
- 本项目不包含任何模型权重，不上传、不代理、不转售任何用户数据；所有请求由你的电脑直接发往官方接口。
- 使用音色克隆功能时，请确保你对所提供的音频样本拥有合法使用权，并尊重他人的声音权与人格权。因滥用造成的后果由使用者自行承担。

如果你在寻找官方产品，请访问小米 MiMo 开放平台官网。

---

## 界面预览

<!-- TODO: 截图 -->
<!--
  截图补齐后，把下面这段注释取消即可。图片请放在 docs/screenshots/ 下。
  建议截图清单（1280×800 以上，深色主题，示例文本用虚构内容）：
    synth.png     语音合成页：左侧大文本框 + 右侧参数面板 + 生成后的波形播放器
    design.png    音色设计页：音色描述 + 模板库 + 润色后文本预览
    clone.png     音色克隆页：拖拽上传区 + 样本试听 + 取样提示
    voices.png    我的音色页：卡片网格（预置 / 设计 / 克隆 三种来源标签齐全）
    history.png   生成历史页：表格 + 筛选 + 试听
    settings.png  设置页：API Key、接口配置、输出目录

| 语音合成 | 音色设计 |
| --- | --- |
| ![语音合成](docs/screenshots/synth.png) | ![音色设计](docs/screenshots/design.png) |

| 音色克隆 | 我的音色 |
| --- | --- |
| ![音色克隆](docs/screenshots/clone.png) | ![我的音色](docs/screenshots/voices.png) |

| 生成历史 | 设置 |
| --- | --- |
| ![生成历史](docs/screenshots/history.png) | ![设置](docs/screenshots/settings.png) |
-->

界面是「左侧固定导航 + 右侧内容区」的单窗口布局，六个页面：

| 页面 | 说明 |
| --- | --- |
| 🎙️ 语音合成 | 预置音色快速出稿。左侧大文本框，右侧音色、风格指令、格式、流式开关 |
| 🎨 音色设计 | 用一段文字描述「凭空创造」一个世界上不存在的声音 |
| 🧬 音色克隆 | 上传一段 `.wav` / `.mp3` 样本音频，复刻该音色说话 |
| 📚 我的音色 | 已保存的音色资产，卡片网格，支持试听 / 重命名 / 删除 / 一键跳到合成页 |
| 🕘 生成历史 | 最近 500 条生成记录，支持筛选、试听、打开所在目录 |
| ⚙️ 设置 | API Key、Base URL、三个模型 ID、默认格式、保存目录 |

---

## 功能特性

- **三种合成模式**：预置音色（9 个官方音色）、音色设计（文字造声）、音色克隆（样本复刻）。
- **AI 写手**：一句话想法 → 专业音色描述；按音色人设自动生成最适合它念的稿子（`mimo-v2.6-flash`，官方 Studio 同款能力）。
- **听写转写（ASR）**：音频 → 文字（`mimo-v2.5-asr`）。采访录音出稿、或把 TTS 生成结果转回来校对念得对不对——语音闭环。
- **长文模式**：有声书 / 长稿按句切段、逐段合成、无损拼接成一个 WAV，段间 300ms 自然停顿。
- **批量工作台**：多行台词一次跑完，支持 SRT / LRC / TXT 台词表导入，并发可调、失败自动重试、队列进度实时可视；跑批时关窗口自动隐藏到托盘，任务不中断。
- **风格方案库**：「音色 + 风格指令」组合存成命名方案，合成页一键套用。
- **真流式进度**：预置音色走 SSE 真流式，主进程实时回传已接收字节数，进度与耗时同步刷新。
- **本地资产沉淀**：设计出来的音色、克隆出来的音色可以「存为我的音色」，之后在合成页的下拉里直接选用。
- **生成历史自动落盘**：每次成功合成都记录模式、文本、音色、大小、token 用量，音频自动存到你指定的目录；支持一键导出 CSV / JSON。
- **音频标签面板**：点一下就把 `(怅然)`、`[轻笑]`、`(唱歌)` 这类标签插到光标处，不用背语法。
- **API Key 本地加密**：走 Electron `safeStorage`（Windows 上是 DPAPI），明文只在主进程内存里短暂存在，渲染进程永远拿不到。
- **接口全可配**：Base URL 和三个模型 ID 都能在设置页改，官方换域名或改版本号时不用等新版本。
- **纯本地 JSON 持久化**：没有原生模块，没有 `NODE_MODULE_VERSION` 崩溃，打包体积和启动速度都更可控。
- **原子写**：临时文件 + `rename`，断电或崩溃不会把 JSON 写坏。
- **自定义媒体协议**：播放音频走 `vcmedia://` 只读协议，不给渲染进程开放 `file://` 全盘访问权限。

---

## 快速开始

### 直接下载安装（推荐普通用户）

到 [Releases](https://github.com/Cloud-Cmr/voicecanvas/releases) 下载：

| 文件 | 说明 |
| --- | --- |
| `VoiceCanvas-x.y.0-Setup.exe` | 安装版，带开始菜单 / 桌面快捷方式 |
| `VoiceCanvas-x.y.0-Portable.exe` | 绿色免安装版，可放 U 盘 |

> 首次运行如遇 Windows SmartScreen 蓝屏提示，点「更多信息」→「仍要运行」（开源项目未购买代码签名证书）。

### 环境要求（从源码运行）

- **Node.js 20 LTS 或更高版本**（推荐 20 / 22）
- **Windows 10 / 11**（当前主要开发与验证平台；macOS / Linux 未做适配验证）
- 一个小米 MiMo 开放平台的 API Key（见下一节）

### 从源码运行

```bash
git clone <你的仓库地址> voicecanvas
cd voicecanvas
npm install
npm run dev
```

`npm run dev` 会由 electron-vite 同时启动主进程、预加载脚本和渲染进程，并带上热更新。

> Windows PowerShell 若提示「无法加载文件 npm.ps1，因为在此系统上禁止运行脚本」，改用 `npm.cmd install` / `npm.cmd run dev` 即可，或执行 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 放开当前用户策略。

### 打包 Windows 安装包

```bash
npm run dist:win
```

该命令等价于 `electron-vite build && electron-builder --win`。构建产物默认落在 `dist/`（electron-builder 的默认输出目录）；如果你在 `package.json` 的 `build.directories.output` 里指定了 `release/`，产物就在 `release/`。

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发模式启动（带热更新） |
| `npm run build` | 只构建三端产物到 `out/`，不打安装包 |
| `npm run typecheck` | 主进程 + 渲染进程类型检查 |
| `npm run typecheck:node` | 仅检查主进程 |
| `npm run typecheck:web` | 仅检查渲染进程（vue-tsc） |
| `npm run dist:win` | 构建并打包 Windows 安装包 |

---

## 获取 API Key

1. 打开 **<https://platform.xiaomimimo.com>**，注册并登录（首次使用需按官方提示完成实名或开通流程）。
2. 进入控制台的「API Key」（或「密钥管理」）页面，创建一个新 Key。
3. 复制生成的 Key（形如 `sk-` 开头的一串字符，**只显示一次，注意保存**）。
4. 回到本软件，进入「设置 → API 凭证」，把 Key 粘贴进输入框，点「保存」。
5. 点「测试连接」验证：成功后会用 `GET /v1/models` 拉一遍可用模型列表并显示数量，同时把服务端返回的模型 ID 列出来，方便你核对设置页里的模型 ID 是否还对得上。

Key 保存后用系统级加密写在本地 `keystore.bin`，界面只会显示「已配置」，**不回显明文，也不支持查看**。想换 Key 就直接粘贴新的覆盖。

---

## 使用说明

### 先理解一个核心概念：正文放 assistant，风格指令放 user

MiMo 的 TTS 接口沿用 Chat Completions 的形状，但角色分工和直觉相反：

| 角色 | 装什么 | 举例 |
| --- | --- | --- |
| `user` | **风格指令**（怎么念） | `用温柔的语气，语速稍慢` |
| `assistant` | **要念的正文**（念什么） | `欢迎来到声绘，今天讲讲怎么做播客。` |

**把正文塞进 `user` 会导致没有音频返回。** 这是接入 MiMo TTS 时最常见的错误，本项目在 `src/main/providers/mimo.ts` 里已经替你处理好了——界面上「合成文本」框就是 assistant，「风格指令」框就是 user，你按界面填就行。

唯一的例外是**音色设计**模式：那时候 `user` 装的是音色描述本身，不是一个可选的风格指令。

### 模式一：语音合成（预置音色）

最快的出稿方式，适合旁白、口播、短视频配音。

1. 进「语音合成」，在左侧大文本框里写要念的内容（可以看到字数统计，支持一键粘贴 / 清空）。
2. 右侧选音色，9 个预置音色分中文和英文两组（对照表见下方）；下拉里还会出现你在「我的音色」里保存的设计音色和克隆音色，按来源分组显示。
3. （可选）填风格指令，比如 `语速偏慢，略带疲惫感`。
4. 选输出格式：WAV（无损、体积大）或 MP3（压缩、体积小）。
5. 需要边生成边看进度就打开「流式输出」——**只有预置音色支持真流式**，设计和克隆模式该开关会置灰。
6. 点「生成」。完成后出现波形播放器，同时显示端到端耗时和 token 用量，可以「重新生成」或打开所在文件夹。

预置音色一览：

| 音色 ID | 名称 | 语言 | 性别 |
| --- | --- | --- | --- |
| `mimo_default` | MiMo-默认（冰糖） | 中文 | 女 |
| `冰糖` | 冰糖 | 中文 | 女 |
| `茉莉` | 茉莉 | 中文 | 女 |
| `苏打` | 苏打 | 中文 | 男 |
| `白桦` | 白桦 | 中文 | 男 |
| `Mia` | Mia | 英文 | 女 |
| `Chloe` | Chloe | 英文 | 女 |
| `Milo` | Milo | 英文 | 男 |
| `Dean` | Dean | 英文 | 男 |

注意中文音色的 ID 就是中文原文（`冰糖`、`茉莉`、`苏打`、`白桦`），不是拼音，也不是英文别名；大小写同样敏感（`Mia` 不是 `mia`）。

### 模式二：音色设计（文字造声）

「用一个描述，凭空造一个世界上不存在的声音」。这是三种模式里最有意思的一种。

1. 进「音色设计」。左侧是**音色描述**（必填，对应 API 的 `user` 消息）。
2. 不会写？展开描述模板库，四类模板一键填入：
   - **简洁描述型**：一句话关键词，如 `Heavy Russian accent, gruff middle-aged male, blunt and matter-of-fact.`
   - **专业描述型**：场景 + 人设 + 质感多维度。
   - **中文人物型**：如「一位年迈的老先生，说带北方口音的普通话，语速缓慢而沉稳，嗓音略带沙哑和沧桑感」。
   - **导演模式**：角色 / 场景 / 指导三段式，适合需要精确控制的角色配音。
3. 右侧填**合成文本**（对应 `assistant`）。如果打开「智能润色」（`optimize_text_preview`），文本可以留空，由模型自动生成一段适配播报的文本；生成后页面会显示服务端返回的 `final_text_preview`，让你看到模型**实际念的**是什么。
4. 生成后点「存为我的音色」，起个名字，之后就能在合成页的下拉里直接选它。

**写作四维度**：性别与年龄、音色质感（沙哑 / 清亮 / 磁性）、情绪与语气、语速与节奏。建议 1～4 句，别写矛盾特征（「低沉的女童声」这种模型会摇摆），也别写混响、EQ、压缩这类后期词——它们描述的是处理链，不是声音本身。

**注意**：音色设计**不能**传 `audio.voice`（传了会报错），也**不支持**唱歌标签。

### 模式三：音色克隆（样本复刻）

用一段真人录音，让模型用这个音色说话。

1. 进「音色克隆」，把 `.wav` 或 `.mp3` 拖进上传区，或点击选择文件。
2. **文件大小必须 ≤ 7.5MB**（前端会先拦一道）。原因：样本要以 `data:audio/wav;base64,...` 形式随请求体上传，base64 会让体积膨胀约 33%，而服务端上限是编码后 10MB。想更稳可以裁到 10～30 秒。
3. 选好后可以先用播放器试听样本，确认音质和人声干净。
4. 填风格指令（可空，这里的 `user` 是风格指令，**不是**音色描述）、填合成文本（必填）。
5. 点生成。克隆模式没有流式开关——接口层面它是「跑完一次性返回」，所以进度文案写的是「正在克隆生成，可能需要十几秒」，请耐心等。
6. 生成后可「存为我的音色」，软件会记住样本路径和元信息，后续复用不用重新上传。

**注意**：克隆模式同样**不支持唱歌标签**。另外请务必确认你对样本拥有合法使用权。

### 音频标签语法

两个写法，作用不同：

- `(标签)` **方括号换成圆括号**，放在文本开头，表示整体风格：`(东北话)今天咱们唠点实在的。`
- `[标签]` 方括号，插在任意位置，表示细粒度动作：`这事儿啊，[叹气]我早就想说了。`

标签面板覆盖整体风格、情绪、方言、细粒度四组，点一下插入到光标处。

**唱歌标签 `(唱歌)` 只有预置音色模式可用。** 它确实能唱，但明显更慢——实测一次约 9.3 秒（普通合成 1.9 秒），所以界面会给出耗时提示。设计与克隆模式既不支持，面板里也会置灰。

---

## 支持模型

| 模型 ID | 用来做什么 | 流式 | `audio.voice` | 唱歌标签 | 正文可以为空 |
| --- | --- | --- | --- | --- | --- |
| `mimo-v2.5-tts` | 预置音色合成 | ✅ 真流式（SSE + pcm16） | 必填，传音色 ID | ✅ | ❌ |
| `mimo-v2.5-tts-voicedesign` | 文字描述生成音色 | ❌ 跑完一次性返回 | **禁止传** | ❌ | ✅（开启智能润色时） |
| `mimo-v2.5-tts-voiceclone` | 音频样本克隆音色 | ❌ 跑完一次性返回 | 必填，传 `data:<mime>;base64,<b64>` | ❌ | ❌ |

能力矩阵（代码里的 `CAPABILITIES` 常量，用于置灰界面选项）：

| 模式 | 流式 | 唱歌 | 可传 voice | 需要描述 |
| --- | --- | --- | --- | --- |
| `preset` | ✅ | ✅ | ✅ | ❌ |
| `design` | ❌ | ❌ | ❌ | ✅ |
| `clone` | ❌ | ❌ | ✅ | ❌ |

**模型 ID 会随官方版本变化**（例如 `mimo-v2-tts` → `mimo-v2.5-tts`），所以三个 ID 全部集中在设置页，可随时改、可一键重置默认。遇到 `model not found` 之类的报错，先去设置页核对 ID，而不是等软件更新。

---

## 数据与隐私

所有数据都在你本机，不上传任何第三方服务器（除了你自己发往小米接口的合成请求）。

| 内容 | 位置 |
| --- | --- |
| 设置 | `%APPDATA%\voicecanvas\data\settings.json` |
| 我的音色 | `%APPDATA%\voicecanvas\data\voices.json` |
| 生成历史（保留最近 500 条） | `%APPDATA%\voicecanvas\data\history.json` |
| API Key（`safeStorage` 加密） | `%APPDATA%\voicecanvas\keystore.bin` |
| 生成的音频 | 默认 `音乐\VoiceCanvas`，可在设置页改 |

`%APPDATA%` 即 `C:\Users\<你的用户名>\AppData\Roaming`。

安全设计：

- 渲染进程开启 `contextIsolation`、关闭 `nodeIntegration`，只能通过 preload 暴露的白名单 API 访问主进程能力。
- 所有 HTTP 请求在主进程发起，Key 不进渲染进程。
- 音频播放走自定义 `vcmedia://` 协议，且只放行音频扩展名，避免开放 `file://` 全盘读取。
- 页面带 CSP，`script-src` 仅允许 `'self'`。

---

## 常见问题（FAQ）

**Q：生成了但没声音 / 服务端没返回音频数据？**
最常见原因是把正文放进了 `user`、风格指令放进了 `assistant`，角色弄反了就没有音频。本客户端已经固定了映射（合成文本框 → assistant，风格指令框 → user），所以你只要确认**合成文本不是空的**即可。如果确实填了文本仍失败，看错误卡片里的原始报错——`E_NO_AUDIO` 表示服务端返回了 200 但结构里没有 `choices[0].message.audio.data`，通常是模型 ID 填错了。

**Q：为什么音色克隆这么慢？**
克隆要把样本整段 base64 塞进请求体，服务端要先解析样本、再做音色嵌入，而且它是「跑完一次性返回」，没有流式可以「先吐一部分」，所以首字节时间约等于总耗时。样本越大越慢，上行带宽也会有影响。页面上给的是「已耗时」而不是假进度条，就是不想骗你。

**Q：为什么唱歌比普通合成慢这么多？**
`(唱歌)` 标签走的是带旋律生成的推理路径，不是简单的韵律调节。实测普通合成 1.9 秒出 184KB，唱歌要 9.3 秒才出 568KB。另外它只支持预置音色。

**Q：API Key 存在哪？安全吗？**
`%APPDATA%\voicecanvas\keystore.bin`，用 Electron `safeStorage` 加密（Windows 上是 DPAPI，密钥绑定当前 Windows 用户）。文件本身是密文，换一台电脑或换一个系统用户都解不开。渲染进程只拿到 `hasApiKey: true/false`，拿不到明文。

需要如实说明的一点：如果 `safeStorage.isEncryptionAvailable()` 返回 false（极少数系统环境），程序会降级为明文存储，文件头标记为 `RAW1` 而不是 `ENC1`。这种环境下 Key 等同于明文落盘，请自行评估风险；正常的 Windows 10/11 不会走到这条路径。

**Q：官方换了域名 / 模型版本号，软件就废了？**
不会。设置页里 Base URL 和三个模型 ID 都可编辑，改完保存立即生效，不用等新版本发布。「测试连接」按钮会调 `GET /v1/models` 并把服务端返回的模型 ID 列出来，你可以直接对照着填。

**Q：国内需要挂代理吗？**
不需要。实测直连 `api.xiaomimimo.com` 的鉴权响应约 0.17 秒。如果你的网络环境特殊（公司代理、DNS 污染），才需要在系统层配置代理。

**Q：生成的音频存在哪？能改吗？**
默认在系统「音乐」目录下的 `VoiceCanvas` 文件夹，设置页可以改成任意目录。每次生成成功后会自动落盘，并记入「生成历史」，历史里可以直接「打开所在位置」。

**Q：支持 macOS / Linux 吗？**
代码层面没写死 Windows 专有 API（`safeStorage` 在三大平台都有实现），但当前只在 Windows 10/11 上做过完整验证，macOS / Linux 属于未验证状态。欢迎 PR 补平台适配。

**Q：会上传我的文本吗？**
不会上传到本项目维护者的任何服务器。合成请求由你的电脑直接发给小米官方接口，文本内容只存在于你本机 JSON 和发给官方接口的请求体里。

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面外壳 | Electron 33 |
| 构建 | electron-vite 2（主 / 预加载 / 渲染三端一体） |
| 界面 | Vue 3.5（组合式 API，`<script setup>`） |
| 语言 | TypeScript 5.7 |
| UI 组件 | Element Plus 2.9（中文 locale，深色主题覆盖） |
| 波形 | 自绘 Canvas + Web Audio `decodeAudioData`（未依赖 wavesurfer） |
| 持久化 | JSON 文件 + `safeStorage` 加密，原子写 |
| 打包 | electron-builder 25 |

---

## 目录结构

```
voicecanvas/
├─ package.json                  依赖与脚本
├─ electron.vite.config.ts       三端构建配置与路径别名
├─ tsconfig.node.json            主进程 / 预加载 TS 配置
├─ tsconfig.web.json             渲染进程 TS 配置
├─ README.md
├─ LICENSE
├─ docs/
│  └─ PITFALLS.md                踩坑记录（接入 MiMo 前建议先读）
├─ .github/
│  └─ workflows/
│     └─ build.yml               Windows 打包与 Release CI
└─ src/
   ├─ shared/                    三端共享
   │  ├─ types.ts                类型定义 + IPC 通道名
   │  └─ constants.ts            默认模型 ID、预置音色、能力矩阵
   ├─ main/                      主进程
   │  ├─ index.ts                窗口、IPC 注册、vcmedia 协议
   │  ├─ store.ts                设置 / Key / 音色 / 历史 持久化
   │  └─ providers/
   │     └─ mimo.ts              MiMo 三模型调用、流式拼接、错误映射
   ├─ preload/
   │  └─ index.ts                contextBridge 白名单 API（window.vc）
   └─ renderer/                  渲染进程
      ├─ index.html              含 CSP
      └─ src/
         ├─ main.ts              挂载 Vue + Element Plus
         ├─ App.vue              侧边栏布局与页面切换
         ├─ styles/theme.css     深色设计变量与原子类
         ├─ composables/         useSynth（合成与进度）、usePlayer（播放）
         ├─ components/          AudioPlayer、Waveform、AudioTagPanel、VoiceCard
         └─ views/               六个页面视图
```

---

## 贡献指南

欢迎 PR、Issue 和真实使用反馈。提交前请先看一眼 [`docs/PITFALLS.md`](docs/PITFALLS.md)——MiMo 接口有五个反直觉的坑，踩过的就不用再踩一遍。

### 开发约定

1. **先开 Issue 再动大改**。新页面、新 provider、数据格式变更这类改动，先描述清楚要解决什么问题。
2. **类型只在 `src/shared/types.ts` 改**，改完三端一起对齐。
3. **颜色只用 `--vc-*` CSS 变量**，不要写死 hex，深色主题要统一。
4. **不要引入原生模块**（包括 `better-sqlite3`、`node-ffi` 之类）。electron-rebuild 的 ABI 问题是这个项目刻意规避的，详见踩坑文档。
5. **自己跑一遍 `npm run typecheck`**，两个 tsconfig 都要过。
6. **提交信息**用 `feat:` / `fix:` / `docs:` / `refactor:` / `chore:` 前缀，中文描述即可。

### 想接第二家语音服务？

扩展点在 **`src/main/providers/`**：

1. 新建 `providers/<name>.ts`，导出与 `mimo.ts` 一致的形状——`synthesize()`、`verifyKey()`、`DEFAULT_MODELS`、`PRESET_VOICES`。外部只依赖这些，不关心内部怎么调。
2. 在设置页把 `providerId` 和 `models` 暴露成可选。
3. 界面层不用改：`SynthRequest` / `SynthResponse` 是稳定的，三个页面靠它工作。

这样设计的原因很直接——模型 ID、域名、参数形状都会变，把变化锁在 provider 目录里，界面和存储层就不用跟着改。

### 路线图

- [x] 三模式合成 + 音色库 + 历史 + 设置（v0.1，MVP）
- [ ] 批量队列：多段文本 × 多音色，并发限流 + 失败重试
- [ ] SRT / TXT / Excel 台词表导入 → 逐条生成 → 打包导出
- [ ] ffmpeg 后处理：拼接、去静音、响度归一
- [ ] 多 Provider（Azure / 火山 / MiniMax）
- [ ] 自动更新（`electron-updater` 已在依赖里）
- [ ] macOS / Linux 构建

---

## 致谢

- 语音能力来自**小米 MiMo 开放平台**，感谢其提供可用的 TTS 接口。
- 界面基于 [Vue 3](https://vuejs.org/)、[Element Plus](https://element-plus.org/)、[Electron](https://www.electronjs.org/)、[electron-vite](https://electron-vite.org/)。
- 感谢所有提交 Issue、复现问题和贡献代码的人。

---

## License

[MIT](LICENSE) © VoiceCanvas contributors
