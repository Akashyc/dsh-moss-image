# dsh-moss-image · 开发计划

- 版本：v0.1（计划稿）
- 日期：2026-10-29
- 状态：已实现（v0.1.0），待装进 profile 验证
- 目标：在 DSH 里说一句「画一只橘猫」，就能出图；API key 与生图参数有界面可配

## 1. 需求

1. 在 DSH 对话里输入生图请求 + 提示词后，调用 Moss 文生图接口出图
2. 有配置界面，可配置 API key、选择模型、设置生图参数
3. 输入框旁有快捷入口（Boss 追加）

## 2. 接口事实（已核实，非猜测）

文档站 `https://platform.mosi.cn` 是 Nuxt 单页站，HTML 只有壳，正文在 `_payload.json`。以下取自
`/docs/reference/images-generations` 的 payload 原文。

| 项 | 内容 |
|---|---|
| Endpoint | `POST https://api.mosi.cn/v1/images/generations` |
| 鉴权 | `Authorization: Bearer $MOSS_API_KEY` |
| 模型 | `moss-image-base-1.0`、`moss-image-sft-1.0`（各有快照版 `-2026-10-09`） |
| 必填 | `model`、`prompt`（非空，≤4000 字符） |
| 可选 | `prompt_enhance`、`negative_prompt`(≤4000)、`size`、`n`、`seed`、`num_inference_steps`、`guidance_scale`、`response_format`、`output_watermark` |
| size | 默认 `1024x1024`；每边 256–2048，且为 16 的倍数；总像素 ≤ 2097152 |
| n | 只支持 1 |
| seed | 0 – 2^53−1，不传则随机 |
| num_inference_steps | 1–100 |
| guidance_scale | 0–10，显式传 0 有效 |
| response_format | 仅 `url`，不支持 `b64_json` |
| output_watermark | `{ "enabled": bool }`，省略时默认开启可见水印 |
| 返回 | `created`、`data[].url`、`usage.generated_images/output_width/output_height` |
| 生成节奏 | 一次一张 PNG，不支持流式；官方示例用 `--max-time 900` |
| 错误码 | 400 `invalid_field_value`；403 `forbidden` / `prompt_enhancement_refused` / `safety_guardrail_blocked`；404 `resource_not_found`；429 `concurrency_limit_exceeded` / `rate_limit_exceeded`；502 `prompt_enhancement_incomplete` / `upstream_invalid_result` |

文档明确警告：超时或断连时任务可能仍在执行，不要自动重复提交；已有图片 URL 时下载失败优先重试下载。

派生约束：`2048x2048` 超出总像素上限（4194304 > 2097152），`2048x1024` 刚好等于上限。尺寸校验必须在本地做完再发请求。

## 3. 已拍板

| 编号 | 决定 |
|---|---|
| D1 | API key 存 DSH 凭据服务（加密、不进 config 明文、不进日志、不进会话记录） |
| D2 | 图片默认落盘到工作区 `images/`，目录可配置 |
| D3 | 做输入框快捷入口 |

## 4. 架构

```
dsh-moss-image/
  package.json          # dsh.bundle.patch + dsh.client 段
  cordis.patch.yml      # profile bundles 里 insert 自己
  install.mjs           # 安装/卸载，默认干跑
  lib/index.js          # host：Config schema + image_generate 工具 + 本地路由
  lib/moss.js           # 纯逻辑：校验、请求体、错误翻译、文件名
  lib/client.js         # client：设置 tab + 输入框按钮
  test/moss.test.mjs    # 纯逻辑单测
  icon.svg
  README.md             # 用法与开源说明
  LICENSE               # MIT
  PLAN.md
```

### host 半边（干活）

- `ctx.tools.register` 注册 `image_generate`
- `ctx.get('credentials')` 存取 API key
- `ctx.attachments.saveImage` 把图变成会话里的原生图片块
- `ctx.webServer.register` 起 `/x-moss-image/*` 路由，把本地图给 Web 端
- `ctx.fs` 落盘、`ctx.get('workingDirectory')` 取当前会话工作区

### client 半边（界面）

- 插件 Config 由 DSH 0.2 的 Plugins 页按 schema 自动渲染，不重复造表单
- 自定义 tab（`settings.plugins.tab`）只放 schema 表达不了的：测试连接、拉模型列表、试生成一张
- 输入框按钮挂在 `conversation.input.left`

### 数据流

```
用户说「画一只橘猫」 → 模型调 image_generate
  → 读配置 + 取 key → 本地校验 size/参数
  → POST /v1/images/generations
  → 拿到 data[0].url → 立即下载（URL 有时效）
  → 落盘 <工作区>/<imagesDir>/<文件名>.png
  → attachments.saveImage → 返回图片块
  → 聊天里出图 + 参数回显
```

图片回显双保险：attachment 为主（聊天里原生渲染、可点开），本地文件 + 路由链接为副（附件失败也不影响结果）。

## 5. 配置项

| 分组 | 字段 | 默认 |
|---|---|---|
| 连接 | `apiKey`（凭据引用，不落 config 明文） | 空 |
| | `baseUrl` | `https://api.mosi.cn` |
| | `timeoutMs` | 900000 |
| 模型 | `model` | `moss-image-sft-1.0` |
| | `promptEnhance` | `false` |
| 生图 | `size` | `1024x1024`（预设 1024x1024 / 1280x720 / 720x1280 / 1536x1024 / 1024x1536 / 2048x1024 / 1024x2048 + 自定义） |
| | `negativePrompt` | `nsfw, worst quality, bad anatomy, watermark, jpeg artifact` |
| | `numInferenceSteps` | `50`（留空则不传，用服务端默认） |
| | `guidanceScale` | `3` |
| | `seedMode` | `follow`（沿用本会话上一张；`random` 每张新抽；`fixed` 用 `seed`） |
| | `seed` | 空（只在 `fixed` 模式下生效） |
| | `outputWatermark` | `false` |
| 落盘 | `pathMode` | `workspace`（相对会话工作区；`absolute` 固定绝对路径） |
| | `imagesDir` | `images`（必填，须与 `pathMode` 对得上） |
| | `fileNamePattern` | `{date}-{time}-{slug}` |

约束：`size` 与 `seed` 在 UI 与工具层各校验一次；不合法在本地就拦，不发请求。

## 6. 工具契约

```
image_generate(
  prompt: string,                    // 必填
  negative_prompt?: string,
  size?: string,                     // 覆盖配置
  seed?: number,
  num_inference_steps?: number,
  guidance_scale?: number,
  prompt_enhance?: boolean,
  output_watermark?: boolean
)
```

返回：图片块 + 结构化摘要（实际尺寸、是否增强、生效参数、落盘路径、耗时）。

失败时返回可读文案，不抛栈：未配 key、尺寸越界、审核拦截、限流、超时（提示「任务可能仍在执行，勿立刻重试」）。

## 7. 输入框快捷入口

方案 A（默认做）：`conversation.input.left` 加一个「生图」按钮，点击往输入框注入提示词模板并把光标放到模板里，
剩下的交给模型调工具。实现轻，复用模型理解提示词的能力。

方案 B（可选增强，先不做）：浮层里直接填提示词、选尺寸、点生成。体验快，但 client 不能直接拿 key，
得在 host 开一条 remote 通道，成本和风险都高一档。等 A 跑顺了再评估。

## 8. 阶段与验收

P0 骨架（约 0.5 天）
包结构、`cordis.patch.yml`、Config schema、Plugins 页能改配置、凭据读写通。
验收：改一个默认尺寸，重启后还在；key 在配置文件里搜不到明文。

P1 打通（约 0.5 天）
`image_generate` 调接口 → 下载 → 落盘 + attachment → 聊天里出图；错误码映射成人话。
验收：对话里说「画一只橘猫坐在窗边」能出图；没配 key 时提示清楚。

P2 设置页（约 0.5 天）
自定义 tab：填 key、测连通、拉 `/v1/models`、试生成一张。
验收：tab 里点「测试连接」能给明确成败；试生成的图当场显示。

P3 打磨（约 0.5 天）
尺寸/参数校验、429 退避、超时不重复提交、输入框按钮、README 与安装说明、LICENSE 与开源说明、
mac/Windows 路径兼容。
验收：2048x2048 本地拦下并说清约束；403/429/超时三种文案可读；`node --check` 通过；
LICENSE 已就位且 README 的开源说明与实现一致。

## 9. 风险

| 风险 | 处理 |
|---|---|
| 图片 URL 有时效 | 拿到就下载，不依赖外链 |
| 生图慢（分钟级） | 超时放宽到 900s，工具里提示预计耗时 |
| 超时≠失败 | 明确提示「任务可能仍在执行」，不自动重发 |
| 一次只能 1 张 | 不在 UI 做数量选择，需要多张就多调几次 |
| 审核拦截 | 把 `safety_guardrail_blocked` 翻成「内容未过审，改提示词再试」 |
| key 泄露 | 走凭据服务；日志与工具回显里打码 |
| 费用 | 每次调用前回显生效参数；不做静默重试 |

## 10. 待办清单

- [x] P0 包结构 + Config schema
- [x] P0 凭据读写（`credentials.resolve/set`，写在插件的本地路由上）
- [x] P1 接口调用 + 校验
- [x] P1 下载 + 落盘 + attachment
- [x] P2 设置 tab
- [x] P3 输入框按钮
- [x] P3 跨平台检查与 README 补全
- [x] LICENSE（MIT）与 README 开源说明
- [ ] 装进 profile，重启 dsh 后人工验一遍

## 11. 实现记录

落地时和计划不完全一致的地方，都记在这里：

1. **不建 locale/。** 界面文案直接写在 `lib/client.js` 里，多一套 i18n 文件反而没人维护。要做英文再说。
2. **输入框按钮按方案 A 实现，但更克制**：点一下把「画一张图：」塞进草稿并保留已输入内容，不直接发请求，也不替你按回车。方案 B（浮层直连生成）没做，理由见第 7 节。
3. **密钥走本地路由而不是 remote 服务**：`POST /x-moss-image/key` 只接受同源请求（看 `sec-fetch-site`），值直接进凭据服务；`/state` 只回 `已配置 + 前 4 位 + 位数`。
4. **图片存两份**：工作区那份给人看，`$DSH_HOME/dsh-moss-image/cache/` 那份给本地路由用（文件名是 24 位随机 hex，路由只服务这个模式），避免为了出图把任意路径暴露成 HTTP。
5. **超时不自动重试**：`AbortSignal.timeout(timeoutMs)` 用一个，429/502 才标 retryable，超时单独提示「任务可能仍在执行」。
6. **attachment 失败不算失败**：`saveImage` 抛错就吞掉，Markdown/路由链接仍是结果。
7. **`prompt` 的清洗**：trim 后为空直接报错，超过 4000 字符本地就拦，不发请求。
8. **尺寸改成「长宽比 × 分辨率」矩阵**（照 dsh 自己的生图面板）：1:1 / 4:3 / 3:4 / 16:9 / 9:16，
   每档低约 100 万像素、高约 200 万像素。2048x2048 会超总像素上限，所以高档最大只到 1440 见方；
   16:9 高档取 1920x1088，是因为 1080 不是 16 的倍数。全部尺寸都在测试脚本里逐项过了 validateSize。
9. **`Config` schema 仍然是权威默认值**，设置页只写覆盖层（`$DSH_HOME/dsh-moss-image/config.json`），
   两者合成后才交给请求；「恢复默认」= 清空覆盖层。

10. **seed 钉住可复现**：种子留空时由插件自己抽一个（0–2^32−1）显式传给接口，回显里写明
    「seed 483920（插件随机生成）」，文件名默认也带 `-s{seed}`。老默认模板会自动升到新默认，
    用户改过的不动。

11. **v0.1.1 精简**：默认值收成 `DEFAULTS` 一个源（schema、`readConfig`、设置页回落都引用它）；
    删掉 `/config` 的 GET 分支（状态统一走 `/state`）与一次性文件名模板迁移；
    设置页的「长宽比按钮 + 分辨率按钮 + 手填框」三层交互换成下拉 + 手填；
    缓存副本改为只有试生成才写（之前每张图都写一份且从不清理）；
    `/key` `/config` `/probe` `/try` 全部加同源校验；`image_generate` 补上 `slug` 参数。
12. **空值语义分家**：`resolveConfig` 按字段区分「没填」和「填了空」——负向词、步数、引导系数、种子
    的空字符串是有效值（清空/不传），其余字段的空值回退默认，免得误清空把 baseUrl 拼成坏地址。
13. **按官方指南调画质**（依据 MOSS-Image 的 HF 模型卡与 USERGUIDE）：默认模型换成 sft（base 没做后训练，
    参数不对容易出废图）；步数/引导系数默认 50 / 3；工具描述让对话模型先把想法扩写成英文画面描述、
    画面文字原样加引号，不堆质量词；negative_prompt / 步数 / 引导系数 用户没明说就不传；
    模型另传的负向词追加到默认负向词后面，不再整组替换。
14. **保存路径必填 + 模式开关**：去掉 `saveToWorkspace`，每张图都落盘；`pathMode` 显式区分相对工作区 / 绝对路径，
    模式和目录对不上在设置页保存时就报错，运行时在调接口前再拦一次（不花冤枉钱）。`~` 开头算绝对路径并展开成家目录。
    先存附件再落盘；写盘失败不算生图失败，退到缓存目录保住这张图并回显原因。撞名加 `-2` 序号，不覆盖。
    设置页试生成在相对工作区模式下没有会话，只预览不落盘。老配置里 `imagesDir` 是绝对路径的，自动推断为 `absolute`。
15. **种子按会话沿用**：`seedMode` 默认 `follow`，插件用 WeakMap 挂在会话对象上记住上一张的 seed/size/model，
    只在成功出图后更新；工具多一个 `new_seed`（用户说「换一张」时传）。优先级：本次 `seed` > `new_seed` > 模式。
    回显标明种子来源；沿用种子但尺寸或模型变了会提示构图会变。只存内存，重启 DSH 后每个会话第一张重新随机。
    老配置里填过固定 `seed` 的，自动推断为 `fixed`。

验证记录：

- `node --check` 三个文件全过
- `node --test` 12 项全过（尺寸、参数越界、错误翻译、文件名清洗与路径穿越）
- `node install.mjs --apply` 从 `github:Akashyc/dsh-moss-image` 装进 desktop profile 成功：
  pnpm 解析 58 个包、`+ dsh-moss-image 0.1.0`，`node_modules/dsh-moss-image` 里
  lib/、cordis.patch.yml、icon.svg、README、PLAN、LICENSE 齐全
- 待人工验证：重启 dsh → 设置 → 插件 →「Moss 生图」
