# dsh-moss-image

DSH 插件：在对话里说一句要画什么，就用 Moss（MOSS-Image）文生图接口出一张图，显示在会话里并存到本地。

## 安装

从 GitHub 仓库直接安装，不打包、不发 npm、不用下载 tgz。

| 方式 | 做法 |
| --- | --- |
| 让 Agent 装（推荐） | 对 agent 说：安装插件 `github:Akashyc/dsh-moss-image` |
| 插件管理页 | 插件 → 添加插件 → 地址填 `github:Akashyc/dsh-moss-image` → 安装 |
| 安装脚本 | 在本仓库目录执行 `node install.mjs --apply`；不加 `--apply` 只打印要改什么 |
| 手动写 profile | 见下一节 |

`github:` 前缀由 pnpm 解析，公开仓库不用登录；装的是仓库默认分支的当前提交。
装完重启 DSH，到 设置 → 插件 → Moss 生图 里填一次 API Key（去 [platform.moss.cn](https://platform.moss.cn/) 申请）。

### 手动写 profile

编辑 `~/.dsh/profiles/<profile>/package.json`（默认 profile 是 `desktop`），加两处：

```json
{
  "dependencies": {
    "dsh-moss-image": "github:Akashyc/dsh-moss-image"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-moss-image"]
    }
  }
}
```

`bundles` 里已有内容就追加，不要整段替换。然后在 profile 目录执行：

```bash
pnpm install
```

重启 DSH，设置 → 插件 里应出现「Moss 生图」页。

> 更新：重跑 `node install.mjs --apply`，它会额外跑一次 `pnpm update` 拉到最新提交；或先卸载再按同一地址安装。`plugin_manager` 的 `install_bundle` 对已安装的包会直接拒绝，不会覆盖升级。

## 效果

| 行为 | 说明 |
| --- | --- |
| 对话里出图 | 模型自己调 `image_generate`，图以附件显示在会话里，可点开 |
| 先扩写提示词 | 模型把描述扩写成一段英文画面描述再生图（MOSS-Image 英文训练数据最多）；画面里要出现的文字原样保留 |
| 迭代不跳图 | 同一会话里接着改图，自动沿用上一张的种子，模型只改提示词里相关的词；说「换一张」才换新种子 |
| 每张都落盘 | 存到工作区或固定目录；写不进去先放缓存目录并说明原因，不丢图；同名加序号，不覆盖 |
| 尺寸本地拦截 | 每边 256–2048、16 的倍数、总像素 ≤ 2097152，不合格不发请求、不计费 |
| 不自动重试 | 超时那头可能还在生成，自动重发就是重复计费 |
| 输入框按钮 | 输入框左侧「生图」按钮，把「画一张图：」塞进草稿，保留已写的内容 |

对话里直接说「画一只橘猫坐在窗边，雨后的花园，柔和的自然光」即可；要指定尺寸或种子就直接说，例如「9:16，种子 42」。
一次只出一张 PNG，单张可能要几十秒到几分钟，这是接口的常态。
同种子能保住构图和大体样子，但改了尺寸或模型就是另一张图，也做不到同一个角色换场景还长一样。
会话种子只记在内存里，重启 DSH 后每个会话的第一张重新随机。

## 卸载

| 方式 | 做法 |
| --- | --- |
| 让 Agent 卸 | 对 agent 说：卸载插件 `dsh-moss-image` |
| 插件管理页 | 插件 → 已安装 → 该插件 → 卸载 |
| 安装脚本 | `node install.mjs --uninstall --apply` |
| 手动 | 删掉 `dependencies` 和 `dsh.profile.bundles` 里的那两行，`pnpm install`，重启 DSH |

卸载不动这些：凭据服务里的 API Key、`~/.dsh/dsh-moss-image/` 下的设置覆盖层与缓存、已经存下的图片。要清干净就手动删。

## 配置

全部在 设置 → 插件 → Moss 生图 里改，保存后下一张图就生效，不用重启。

| 项 | 默认 | 说明 |
| --- | --- | --- |
| API Key | 空 | 存进 DSH 凭据服务（键名 `MOSS_API_KEY`），不写进配置文件、不回显 |
| 接口地址 | `https://api.mosi.cn` | |
| 超时 | 900 秒 | 只在 Plugins 页的 schema 表单里改 |
| 默认模型 | `moss-image-sft-1.0` | base 没做后训练，参数不对容易出废图；带日期的快照版用于固定版本 |
| 尺寸 | `1024x1024` | 下拉选预设，也可手填宽x高，见下表 |
| 负向提示词 | `nsfw, worst quality, bad anatomy, watermark, jpeg artifact` | 模型另传的负向词追加在后面 |
| 步数 / 引导系数 | `50` / `3` | 官方推荐值；留空用服务端默认；提示词很短时引导系数可提到 4–6 |
| 种子模式 | 沿用上一张 | 也可选每张随机、固定值（选固定值才出现数值框） |
| 提示词增强 | 关 | 提示词已由对话模型扩写，一般不用开 |
| 可见水印 | 关 | |
| 保存位置 | 相对工作区 | 或绝对路径；和目录对不上，保存设置时就报错 |
| 目录 | `images` | 相对工作区填相对路径；绝对路径填完整路径，可用 `~` 开头。设置页试生成在相对工作区模式下不落盘 |
| 文件名模板 | `{date}-{time}-{slug}-s{seed}` | 可用 `{date}` `{time}` `{slug}` `{seed}` `{width}` `{height}` |

### 尺寸预设

| 长宽比 | 低档（约 100 万像素） | 高档（约 200 万像素） |
| --- | --- | --- |
| 1:1 | 1024×1024 | 1440×1440 |
| 4:3 | 1152×864 | 1664×1248 |
| 3:4 | 864×1152 | 1248×1664 |
| 16:9 | 1360×768 | 1920×1088 |
| 9:16 | 768×1360 | 1088×1920 |

2048×2048 超总像素上限，所以 1:1 高档只到 1440；1080 不是 16 的倍数，所以 16:9 高档取 1920×1088。

## 文件

```text
lib/index.js          host：配置、image_generate 工具、会话种子、落盘、本地路由
lib/moss.js           纯逻辑：参数与设置校验、种子挑选、保存目录解析、请求体、错误翻译、文件名
lib/client.js         client：设置页与输入框按钮
cordis.patch.yml      profile bundles 里插一条自己的行
install.mjs           安装/卸载脚本，默认干跑
icon.svg              图标
test/                 node:test 单测
PLAN.md               接口事实、设计与实现记录
```

## 验证

```bash
npm test
npm run check
```

装上之后：设置 → 插件 → Moss 生图 里点「测试连接」（只查模型列表，不计费），再点「试生成」看能否出图。
工具是否换上了新版：调用 `cordis_inspect_query`（provider `Tool`，method `listTools`），看 `image_generate` 的 schema 里是否带 `new_seed` 参数。

## 许可

MIT，全文见 [LICENSE](LICENSE)。Copyright (c) 2026 Akashyc。

社区插件，非 DeepSeek 或 Moss 官方出品，与两家无隶属关系。需自备 Moss API Key，调用费用由使用者承担；插件不代收费用、不上报用量。
提示词与生图参数只发往所配置的 Moss 接口，图片落在你指定的本地目录。生成内容由使用者负责，需遵守 Moss 平台的内容政策与所在地法律。
`private: true` 只防误执行 `npm publish`，不影响源码开放。
