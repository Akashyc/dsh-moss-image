# dsh-moss-image

给 DSH 用的 Moss 文生图插件：在对话里说一句「画一只橘猫坐在窗边」，就调 Moss API 出一张图，
并把图直接显示在会话里。

> 状态：已实现，等装进 profile 验证。设计与接口核实见 [PLAN.md](./PLAN.md)。

## 它能干什么

- 对话驱动：用自然语言描述画面，模型自动调用 `image_generate` 工具生图
- 参数可控：模型、尺寸、负向提示词、步数、引导系数、种子、水印都能配
- 提示词增强：可选让服务端先把提示词扩写再画（同一次请求内完成）
- 图片落盘：默认存到当前工作区的 `images/`，目录可改
- 会话内直接显示：图片以附件形式回传，聊天里可看可点开

## 接口

| 项 | 值 |
|---|---|
| Endpoint | `POST https://api.mosi.cn/v1/images/generations` |
| 鉴权 | `Authorization: Bearer <MOSS_API_KEY>` |
| 模型 | `moss-image-base-1.0`、`moss-image-sft-1.0`（含快照版） |
| 返回 | 一次一张 PNG 的 URL |

一次只生成一张，不支持流式，单张耗时可能到分钟级。

## 安装

```bash
node install.mjs                     # 干跑：只打印要改什么，不动文件
node install.mjs --apply             # 真装：从 GitHub 拉包并写进 profile
node install.mjs --from local --apply  # 从本地目录装（改代码时用，建软链）
node install.mjs --uninstall --apply   # 卸掉
```

默认装进 `$DSH_HOME/profiles/desktop`，依赖写 `github:Akashyc/dsh-moss-image`，
可用 `--profile <名字>` 换 profile、`--pnpm <路径>` 指定 pnpm。装完重启 dsh，
设置 → 插件 里会出现「Moss 生图」页。

脚本不会自动备份 `package.json`；要留底先自己复制一份。

## 配置

全部在 设置 → 插件 → dsh-moss-image 里改，改完即时生效。

| 分组 | 项 | 说明 |
|---|---|---|
| 连接 | API Key | 在插件页「Moss 生图」里填一次；存进 DSH 凭据服务，不写进配置文件、不回显 |
| | Base URL | 默认 `https://api.mosi.cn` |
| | 超时 | 默认 900 秒，生图慢是这个接口的常态 |
| 模型 | 默认模型 | base / sft / 各自的固定快照版 |
| | 提示词增强 | 默认关 |
| 生图 | 尺寸 | 长宽比 × 分辨率两档：1:1 / 4:3 / 3:4 / 16:9 / 9:16，低约 100 万像素、高约 200 万像素；也可手填（每边 256–2048、16 的倍数、总像素 ≤ 2097152） |
| | 负向提示词 | 默认给一组通用负向词 |
| | 步数 / 引导系数 / 种子 | 留空则用服务端默认 |
| | 可见水印 | 默认关 |
| 落盘 | 保存到工作区 | 默认开 |
| | 目录 | 默认 `images`，可填绝对路径 |
| | 文件名模板 | 默认 `{date}-{time}-{slug}` |

## 用法

对话里直接说：

```
画一只橘猫坐在窗边，窗外是雨后的花园，柔和的自然光，温暖细腻的摄影风格
```

模型会调用工具并带回图片。需要指定尺寸或种子时直接说，例如「横版 1536x1024，种子 42」。

输入框左侧还有一个「生图」按钮：点一下把「画一张图：」模板塞进草稿并保留你已经写的内容，
接着补画面描述发出去即可。

## 目录结构

```
dsh-moss-image/
  package.json          # dsh.bundle.patch + dsh.client 段
  cordis.patch.yml      # profile bundles 里插一条自己的行
  install.mjs           # 安装/卸载，默认干跑
  lib/index.js          # host：配置、工具、本地路由
  lib/moss.js           # 纯逻辑：参数校验、请求体、错误翻译、文件名
  lib/client.js         # client：设置页与输入框按钮
  test/moss.test.mjs    # 纯逻辑单测（node --test）
  icon.svg
  README.md
  PLAN.md
  LICENSE
```

## 已知限制

- 一次请求只出 1 张图
- 只支持 URL 返回，不支持 base64
- 不自动重试：接口超时可能仍在生成，自动重发会重复计费

## 开源说明

本插件以 MIT 许可开源，可自由使用、修改、分发，保留版权声明即可。

| 项 | 说明 |
|---|---|
| 许可 | MIT，全文见 [LICENSE](./LICENSE) |
| 作者 | Akashyc |
| 性质 | 社区插件，非 DeepSeek 或 Moss 官方出品，与两家官方无隶属关系 |
| 费用 | 需自备 Moss API Key；调用产生的费用由使用者自行承担。本插件不代收费用、不转售额度、不上报用量 |
| 数据流向 | 提示词与生图参数发往所配置的 Moss API 端点；图片落在你指定的本地目录；API Key 存在 DSH 凭据服务里，不回显、不写日志 |
| 内容责任 | 生成内容由使用者负责，需遵守 Moss 平台的内容政策与所在地法律 |
| 依赖 | 运行时只依赖 DSH 与 Moss API，无其他第三方运行时依赖；不打包任何受版权保护的素材 |
| 反馈 | 问题与改进建议直接提 issue，或在工作区里改完提 PR；改动请保持 mac / Windows 双平台可用 |

## 贡献约定

- 提交前跑 `node --check`，保证每个 JS 文件语法通过
- 不把 API Key、真实会话日志、生成的图片提交进仓库
- 改了接口参数或尺寸约束，同步更新本文件与 [PLAN.md](./PLAN.md) 的接口表
