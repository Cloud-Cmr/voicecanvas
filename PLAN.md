# 声绘 VoiceCanvas — 项目大纲（可编辑，改完告诉我）

> 状态：`草稿 v0.1` ｜ 生成时间：2026-11-11
> **改法**：直接改这份文件里的任意内容，或者回消息告诉我"第几条改成 XX"。
> 标了 `⬜ 待拍板` 的是我需要你决定的；标了 `✅ 建议` 的是我推荐、你默认同意就照做的。

---

## 1. 一句话定位

**声绘 VoiceCanvas** 是一个桌面端 AI 语音工作台：把「文本 → 多种音色 → 可交付音频文件」这件事做得比官方网页 Studio 更快、更能批量、更能沉淀资产。

✅ 建议定位：不是"API 的漂亮皮肤"，而是**本地资产 + 流水线**。
理由：官方随时可能给网页补上批量功能，但"我的音色库、生成历史、项目工程文件"只有本地客户端适合做。

不在范围内（明确不做，避免摊子铺太大）：
- ❌ 不做在线社区/分享平台
- ❌ 不做自己的语音模型
- ❌ 第一版不做音频编辑器的多轨混音

---

## 2. 名字

✅ 建议：**声绘 / VoiceCanvas**，仓库名 `voicecanvas`

备选（你不喜欢就换）：
| 名字 | 优点 | 缺点 |
|---|---|---|
| 声绘 VoiceCanvas | 不绑小米商标、通用、好记 | 略抽象 |
| MiMo Studio | 搜索流量最大 | 侵权风险，官方改模型名就尴尬 |
| 音匠 VoiceSmith | 有"手艺"感 | 英文偏小众 |
| 说书人 NarratorBox | 中文场景感强 | 局限在"讲故事" |

⬜ 待拍板：用不用"声绘 VoiceCanvas"？

---

## 3. 技术栈（已定，除非你要改）

| 层 | 选型 | 备注 |
|---|---|---|
| 桌面外壳 | Electron 33 + TypeScript | 已按你的选择 |
| 界面 | Vue 3 + Vite + TypeScript | 组合式 API |
| UI 组件 | Element Plus | 深色主题覆盖 |
| 波形/播放 | wavesurfer.js 7 | 波形渲染 + 区域试听 |
| 本地存储 | **JSON 文件 + safeStorage 加密** | 见第 6 节，刻意不用 SQLite |
| 打包 | electron-builder | NSIS 安装版 + portable 绿色版 |
| 构建 | electron-vite | 主/预加载/渲染三端一体 |

⬜ 待拍板：`better-sqlite3` 还是 JSON？
✅ 建议 **JSON**——SQLite 是原生模块，必须按 Electron ABI 重编译，打出来的 exe 极易崩（`NODE_MODULE_VERSION` 不匹配）。音色库/历史这种千级数据，JSON 完全够，还免了编译环节。

---

## 4. 目录结构（已建部分打 ✅）

```
voicecanvas/
├─ package.json                        ✅
├─ electron.vite.config.ts             ✅
├─ tsconfig.node.json / web.json       ✅
├─ PLAN.md                             ← 本文件
├─ README.md                           ⬜ 待写（docs 队友）
├─ .gitignore / LICENSE / .editorconfig ⬜ 待写
├─ src/
│  ├─ shared/types.ts                  ✅ 三端共享类型 + IPC 通道名
│  ├─ main/
│  │  ├─ index.ts                      ✅ 窗口 + 全部 IPC 注册
│  │  ├─ store.ts                      ✅ 设置/Key/音色/历史 持久化
│  │  └─ providers/
│  │     ├─ index.ts                   ⬜ provider 注册表（可扩展第二家）
│  │     └─ mimo.ts                    ✅ MiMo 三模型 + 流式 + 错误映射
│  ├─ preload/index.ts                 ✅ contextBridge 白名单
│  └─ renderer/
│     ├─ index.html                    ✅ 含 CSP
│     └─ src/
│        ├─ main.ts                    ⬜
│        ├─ App.vue                    ⬜ 侧边栏布局
│        ├─ styles/theme.css           ⬜ 深色设计基线
│        ├─ composables/               ⬜ useSynth / usePlayer
│        ├─ components/                ⬜ AudioPlayer、Waveform、VoiceCard
│        └─ views/
│           ├─ SynthView.vue           ⬜ 主合成页
│           ├─ DesignView.vue          ⬜ 音色设计页
│           ├─ CloneView.vue           ⬜ 音色克隆页
│           ├─ VoiceLibraryView.vue    ⬜ 我的音色
│           ├─ HistoryView.vue         ⬜ 生成历史
│           └─ SettingsView.vue        ⬜ 设置
└─ .github/workflows/build.yml          ⬜ 三平台 CI
```

---

## 5. 页面清单与交互（这是核心，请重点看这里）

### 5.1 主合成页（SynthView）
- 左侧：大文本框（字数统计、粘贴/清空）
- 右侧参数：
  - 音色选择（预置 9 个 + 我的音色里的 design/clone 资产，统一下拉）
  - 风格指令输入框（对应 `user` 消息，可留空）
  - 输出格式：WAV / MP3
  - 开关：流式输出（仅预置音色可用）
- 底部：生成按钮 + 状态（进度/耗时/token 用量）
- 生成后：波形播放器 + 「保存到…」「打开所在文件夹」「重新生成」
- ⬜ 待拍板：主页面要不要支持"多段文本一次性排队生成"？

### 5.2 音色设计页（DesignView）
- 音色描述大输入框（对应 `user` 消息）
- **描述模板库**：一键填入 4 类模板
  1. 简洁描述型（一句话关键词）
  2. 专业描述型（场景+人设+质感多维度）
  3. 导演模式（角色 / 场景 / 指导 三段式）
  4. 中文人物型（例：饱经风霜的老爷爷讲故事）
- 合成文本输入框（对应 `assistant`）
- 开关：`optimize_text_preview`（智能润色；开了可自动生成文本）
- 生成后显示 `final_text_preview`（让用户看到模型实际念了什么）
- 「存为我的音色」→ 存入音色库，后续在合成页直接选用

### 5.3 音色克隆页（CloneView）
- 拖拽区：仅收 `.wav` / `.mp3`，前端先卡体积（**base64 后 ≤10MB，原文件建议 ≤7.5MB**）
- 上传后：波形显示 + 手动选区裁剪
- 试听样本
- 风格指令（可选）+ 合成文本
- 「存为我的音色」→ 保存样本路径 + 元信息

### 5.4 我的音色（VoiceLibraryView）
- 卡片网格：名称 / 来源标签（预置/设计/克隆）/ 试听 / 重命名 / 删除
- 点击卡片 → 一键跳到合成页并选中该音色

### 5.5 生成历史（HistoryView）
- 表格：时间 / 模式 / 音色 / 文本摘要 / 时长 / token
- 操作：试听 / 打开文件 / 复制参数重跑 / 删除

### 5.6 设置（SettingsView）
- API Key（密码框，保存后显示"已配置"，只支持覆盖不支持查看明文）
- Base URL（可改，防官方换域名）
- 三个模型 ID（可改，防官方改版本号）
- 默认输出格式 + 输出目录
- 「测试连接」按钮 → 调 `/v1/models` 验证

⬜ 待拍板：上面 6 个页面够不够？要不要加"批量/台词表"页（见第 7 节）？

---

## 6. 数据与安全

- 存储路径：`app.getPath('userData')/data/{settings,voices,history}.json`
- API Key：`safeStorage`（Windows 走 DPAPI）加密后存 `keystore.bin`，**渲染进程永远拿不到明文**
- 全部 HTTP 请求走主进程，渲染进程开 `contextIsolation`、关 `nodeIntegration`
- 原子写（临时文件 + rename），断电不会写坏 JSON
- `.gitignore` 必须锁死：`node_modules/`、`out/`、`release/`、`*.key`、`userdata/`、`_probe/`

---

## 7. 范围边界：MVP / v1.0 / 以后

**MVP（先做这个，能发布）**
- 三个合成页面 + 音色库 + 历史 + 设置
- 单次生成、试听、保存、重新生成
- Windows 打包出 exe

**v1.0（发布后第一波迭代）**
- 批量队列（多段文本 × 多音色，并发限流 + 失败重试）
- SRT / TXT / Excel 台词表导入 → 逐条生成 → 打包导出
- ffmpeg 后处理：拼接、去静音、响度归一
- 音频标签快捷面板（点一下插入 `(怅然)`、`[大笑]`、`(唱歌)`）

**更远**
- 多 Provider（Azure / 火山 / MiniMax）
- 自动更新（electron-updater）
- macOS / Linux 构建

⬜ 待拍板：MVP 是否就按上面这些？要不要把"批量队列"提前进 MVP？

---

## 8. 已验证的技术事实（实测，不是猜的）

用你的 Key 在 2026-11-11 实测通过：

| 项目 | 结果 |
|---|---|
| Key 有效性 | ✅ 200，直连 `api.xiaomimimo.com` 仅 0.17s，**不需要代理** |
| 可用模型 | `mimo-v2.5-tts`、`mimo-v2.5-tts-voicedesign`、`mimo-v2.5-tts-voiceclone`、`mimo-v2.5-asr`、`mimo-v2.6-flash/pro/pro-ultraspeed` |
| 预置音色生成 | ✅ 200，1.9s，184KB WAV |
| 音色设计 | ✅ 200，1.4s，176KB WAV |
| 唱歌标签 `(唱歌)` | ✅ 200，9.3s，568KB WAV（明显更慢，UI 要给提示） |
| 音色克隆 | 单次成功，但**流式路径挂起过** → 必须自己加空闲超时 |
| 流式接口 | SSE 跑完**不主动关连接**，要用 60s 空闲超时兜底 |

已写进代码的 5 个坑（都在 `mimo.ts` 里处理了）：
1. 正文必须放 `assistant`，风格指令放 `user`，弄反就没声音
2. `voicedesign` 的 `user` 就是音色描述，必填，且**不能传** `audio.voice`
3. `voiceclone` 的 `voice` 必须 `data:audio/wav;base64,...`，超 10MB 直接拒
4. 流式只有预置音色是真流式，design/clone 是"跑完一次性吐"，进度条逻辑要分开
5. 流式返回 pcm16 裸流，得自己拼 44 字节 WAV 头

---

## 9. 智能体团队分工（你确认后我才建）

| 成员 | 写哪些文件 | 不碰什么 |
|---|---|---|
| Lead（我） | 骨架、`providers/`、`store.ts`、`main/index.ts`、preload、最终合并验收 | — |
| `ui-synth` | `SynthView.vue`、`VoiceLibraryView.vue`、`HistoryView.vue`、`AudioPlayer.vue`、`Waveform.vue` | 不碰 main/preload |
| `ui-design-clone` | `DesignView.vue`、`CloneView.vue`、`VoiceCard.vue` | 不碰 main/preload |
| `docs-ci` | `README.md`、`.gitignore`、`LICENSE`、`.github/workflows/build.yml`、踩坑文档 | 不碰 `src/` |

前提：我先把 `App.vue`、路由、`theme.css`、`main.ts` 和 composables 写完，作为所有人共用的基线，否则三个人的 UI 风格会打架。

---

## 10. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M0 | 骨架 + 类型 + API 层 | ✅ 已完成，Key 实测通过 |
| M1 | 渲染基线（App/路由/主题/播放器） | 能打开窗口，空页面可切换 |
| M2 | 三个合成页（团队并行） | 三种模式都能真出音频 |
| M3 | 音色库 + 历史 + 设置 | 数据持久化，重启不丢 |
| M4 | 打包 exe | 双击能跑，装机可用 |
| M5 | README + CI + 首次 Release | 可发 GitHub |

---

## 11. 需要你拍板的 4 件事（回我就行）

1. ⬜ 名字用 **声绘 VoiceCanvas** 吗？
2. ⬜ 存储用 **JSON**（推荐）还是坚持 SQLite？
3. ⬜ 页面就上面 6 个，还是 MVP 就要"批量队列"页？
4. ⬜ 智能体团队现在就建，还是等你看完再建？
