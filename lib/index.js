// dsh-moss-image · host 半边。
// 注册 image_generate 工具、读写 Moss API Key、把生成的图片落盘并回传给会话。
// 接口依据：https://platform.mosi.cn/docs/reference/images-generations
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createReadStream, readFileSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import {
    DEFAULT_BASE_URL,
    DEFAULT_CREDENTIAL_KEY,
    DEFAULT_NEGATIVE_PROMPT,
    ENDPOINT,
    LIMITS,
    MODELS,
    MODELS_ENDPOINT,
    PATH_MODES,
    SEED_MODES,
    SETTING_KEYS,
    SIZE_OPTIONS,
    SIZE_PRESETS,
    buildRequest,
    explainError,
    fileNameFor,
    imagesDirProblem,
    pickSeed,
    readImageUrl,
    resolveConfig,
    resolveImagesDir,
    upgradeOverrides,
    validateSettings,
    validateSize,
} from './moss.js'

export const name = 'dsh-moss-image'
export const inject = ['tools']

const SIZE_HELP = `宽x高，默认 1024x1024；每边 256–2048 且为 16 的倍数，总像素不超过 2097152。常用：${SIZE_PRESETS.join(' / ')}`

/** 默认文件名带 seed，方便回头复现。 */
const DEFAULT_FILE_PATTERN = '{date}-{time}-{slug}-s{seed}'

/** 默认值只写这一遍：schema、运行时读取、设置页回落都引用它。 */
const DEFAULTS = {
    baseUrl: DEFAULT_BASE_URL,
    credentialKey: DEFAULT_CREDENTIAL_KEY,
    timeoutMs: 900000,
    // sft：base 没做后训练也没蒸馏 CFG，官方说参数要调仔细才出好图。
    model: MODELS[1],
    promptEnhance: false,
    size: '1024x1024',
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    // 官方推荐：步数 ≥50；长提示词引导系数 3（工具描述会让模型写长的英文提示词）。
    numInferenceSteps: '50',
    guidanceScale: '3',
    seedMode: 'follow',
    seed: '',
    outputWatermark: false,
    pathMode: 'workspace',
    imagesDir: 'images',
    fileNamePattern: DEFAULT_FILE_PATTERN,
    routePath: '/x-moss-image',
    publicBaseUrl: '',
}

// dsh 0.2 会在 Plugins 页把可编辑项换成 volatile 引用，读的时候要还原成普通值。
const plain = (value) => (value && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value)

export const Config = Schema.object({
    // ── 连接
    baseUrl: Schema.string().default(DEFAULTS.baseUrl).description('Moss API 的基址。'),
    credentialKey: Schema.string().default(DEFAULTS.credentialKey)
        .description('API Key 在 DSH 凭据服务里的键名（密钥本身不进配置文件）。'),
    timeoutMs: Schema.natural().default(DEFAULTS.timeoutMs).description('单次生图超时（毫秒）。接口慢是常态，默认 15 分钟。'),
    // ── 模型
    model: Schema.union([...MODELS]).default(DEFAULTS.model).description('默认模型。快照版用于固定版本复现。'),
    promptEnhance: Schema.boolean().default(DEFAULTS.promptEnhance).description('默认是否先增强提示词再生图。'),
    // ── 生图参数
    size: Schema.string().default(DEFAULTS.size).description(`默认尺寸。${SIZE_HELP}`),
    negativePrompt: Schema.string().default(DEFAULTS.negativePrompt).description('默认负向提示词，最多 4000 字符。'),
    numInferenceSteps: Schema.string().default(DEFAULTS.numInferenceSteps).description('默认推理步数 1–100，官方推荐 ≥50；留空用服务端默认。'),
    guidanceScale: Schema.string().default(DEFAULTS.guidanceScale)
        .description('默认引导系数 0–10，官方推荐 3–6（提示词越短越高）；留空用服务端默认。'),
    seedMode: Schema.union([...SEED_MODES]).default(DEFAULTS.seedMode)
        .description('种子模式：follow 沿用本会话上一张（迭代时图不跳）；random 每张新抽；fixed 一直用下面的固定种子。'),
    seed: Schema.string().default(DEFAULTS.seed).description('固定种子（整数），只在 fixed 模式下生效。'),
    outputWatermark: Schema.boolean().default(DEFAULTS.outputWatermark).description('是否给图片加可见水印。'),
    // ── 落盘
    pathMode: Schema.union([...PATH_MODES]).default(DEFAULTS.pathMode)
        .description('保存位置：workspace 相对当前会话工作区；absolute 固定的绝对路径。'),
    imagesDir: Schema.string().default(DEFAULTS.imagesDir)
        .description('保存目录。workspace 模式填相对路径；absolute 模式填完整路径，可用 ~ 开头。'),
    fileNamePattern: Schema.string().default(DEFAULTS.fileNamePattern)
        .description('文件名模板，可用 {date} {time} {slug} {seed} {width} {height}。'),
    // ── Web
    routePath: Schema.string().default(DEFAULTS.routePath).description('给网页端提供图片与设置接口的本地路由前缀。'),
    publicBaseUrl: Schema.string().default(DEFAULTS.publicBaseUrl).description('图片链接使用的外部地址；留空则用当前 dsh Web 服务地址。'),
})

/** 读当前生效的配置：设置页覆盖值 ← schema 值 ← 默认值，每次调用重新取，改完即时生效。 */
function readConfig(config) {
    const schemaValues = {}
    for (const key of Object.keys(DEFAULTS)) schemaValues[key] = plain(config[key])
    const merged = resolveConfig(upgradeOverrides(loadOverrides()), schemaValues, DEFAULTS)
    return {
        baseUrl: String(merged.baseUrl).replace(/\/+$/u, ''),
        credentialKey: String(merged.credentialKey),
        timeoutMs: Number(merged.timeoutMs),
        model: String(merged.model),
        promptEnhance: Boolean(merged.promptEnhance),
        size: String(merged.size),
        negativePrompt: String(merged.negativePrompt),
        numInferenceSteps: String(merged.numInferenceSteps),
        guidanceScale: String(merged.guidanceScale),
        seedMode: String(merged.seedMode),
        seed: String(merged.seed),
        outputWatermark: Boolean(merged.outputWatermark),
        pathMode: String(merged.pathMode),
        imagesDir: String(merged.imagesDir),
        fileNamePattern: String(merged.fileNamePattern),
        routePath: String(merged.routePath),
        publicBaseUrl: String(merged.publicBaseUrl).replace(/\/+$/u, ''),
    }
}

/** 从生效配置里挑出可编辑字段，给设置页回显。 */
function settingsOf(current) {
    const value = {}
    for (const key of SETTING_KEYS) value[key] = current[key]
    return value
}

/** 当前会话的工作目录：优先问 workingDirectory 服务，它才是会话真正的 cwd。 */
async function sessionCwd(ctx, exec) {
    const directory = ctx.get('workingDirectory')
    const agent = exec?.agent
    if (directory) {
        if (agent?.session && typeof directory.get === 'function') {
            try {
                const found = directory.get(agent.session)
                if (found) return found
            } catch {}
        }
        if (agent && typeof directory.ensure === 'function') {
            try {
                const found = await directory.ensure(agent)
                if (found) return found
            } catch {}
        }
    }
    return agent?.cwd ?? process.cwd()
}

function cacheDir() {
    const home = process.env.DSH_HOME
    return home ? join(home, 'dsh-moss-image', 'cache') : join(tmpdir(), 'dsh-moss-image-cache')
}

/** 设置页写下的覆盖值：存在 $DSH_HOME 下，不动 profile 的配置文件。 */
function storeFile() {
    const home = process.env.DSH_HOME
    return home ? join(home, 'dsh-moss-image', 'config.json') : join(tmpdir(), 'dsh-moss-image-config.json')
}

let overridesCache
/** 懒加载，读一次缓存着；写的时候同步更新缓存，改完立刻生效。 */
function loadOverrides() {
    if (overridesCache !== undefined) return overridesCache
    try {
        overridesCache = JSON.parse(readFileSync(storeFile(), 'utf8'))
    } catch {
        overridesCache = {}
    }
    return overridesCache
}

async function saveOverrides(next) {
    const path = storeFile()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`)
    overridesCache = next
}

async function readKey(ctx, options) {
    const credentials = ctx.get('credentials')
    if (!credentials?.resolve) return undefined
    const resolved = await credentials.resolve(options.credentialKey)
    const value = typeof resolved === 'string' ? resolved : resolved?.value
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** 只回显前 4 位 + 长度，日志和界面上都不出现完整密钥。 */
function maskKey(key) {
    return `${key.slice(0, 4)}…${key.length} 位`
}

async function callMossApi(ctx, options, body) {
    const key = await readKey(ctx, options)
    if (!key) {
        const error = new Error(`还没有配置 Moss API Key。到「设置 → 插件 → Moss 生图」里填一次（凭据键名：${options.credentialKey}）。`)
        error.code = 'missing_api_key'
        throw error
    }
    const url = `${options.baseUrl}${ENDPOINT}`
    let response
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${key}`,
                'content-type': 'application/json',
                accept: 'application/json',
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(options.timeoutMs),
        })
    } catch (cause) {
        const timedOut = cause?.name === 'TimeoutError' || cause?.name === 'AbortError'
        const error = new Error(timedOut
            ? `等了 ${Math.round(options.timeoutMs / 1000)} 秒还没返回。接口超时或断连时任务可能仍在生成，先别重复提交——过一会儿再看是否有结果。`
            : `连不上 ${url}：${cause?.message ?? cause}。检查网络、Base URL 和代理设置。`)
        error.code = timedOut ? 'timeout' : 'network'
        error.retryable = false
        throw error
    }
    const text = await response.text()
    let payload
    try {
        payload = text ? JSON.parse(text) : {}
    } catch {
        payload = { message: text.slice(0, 500) }
    }
    if (!response.ok) {
        const explained = explainError(response.status, payload)
        const error = new Error(explained.text)
        error.code = explained.code || `http_${explained.status}`
        error.status = explained.status
        error.retryable = explained.retryable
        throw error
    }
    return payload
}

async function downloadImage(url, signal) {
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`下载图片失败（HTTP ${response.status}）。图片链接可能已过期，重新生成一次。`)
    return Buffer.from(await response.arrayBuffer())
}

async function writeImage(dir, name, bytes) {
    await mkdir(dir, { recursive: true })
    // 沿用种子后，同一秒出的两张文件名会一模一样：撞名就加序号，绝不覆盖已有的图。
    for (let n = 1; ; n += 1) {
        const path = join(dir, n === 1 ? name : name.replace(/\.png$/u, `-${n}.png`))
        try {
            await writeFile(path, bytes, { flag: 'wx' })
            return path
        } catch (error) {
            if (error?.code !== 'EEXIST') throw error
        }
    }
}

/**
 * 把图片写进保存目录；dir 为空（相对工作区模式下的试生成）就不落盘。
 * 写不进去不算生图失败：钱已经花了、URL 会过期，先退到缓存目录保住这张图，并把原因带回去。
 * withCache 额外写一份随机名的缓存副本，只为设置页试生成的预览路由服务。
 */
async function persistImage(bytes, dir, options, context, withCache) {
    let savedPath
    let saveError
    if (dir) {
        const name = fileNameFor(options.fileNamePattern, context)
        try {
            savedPath = await writeImage(dir, name, bytes)
        } catch (error) {
            saveError = error?.message ?? String(error)
            savedPath = await writeImage(cacheDir(), name, bytes).catch(() => undefined)
        }
    }
    const cachedPath = withCache ? await writeImage(cacheDir(), `${randomBytes(12).toString('hex')}.png`, bytes) : undefined
    return { savedPath, saveError, cachedPath }
}

async function attachImage(ctx, bytes, name) {
    const attachments = ctx.get('attachments')
    if (!attachments?.saveImage) return undefined
    try {
        const ref = await attachments.saveImage({ data: bytes, mediaType: 'image/png', name })
        return {
            attachmentId: String(ref.attachmentId),
            mediaType: ref.mediaType,
            bytes: ref.bytes,
            width: ref.width,
            height: ref.height,
        }
    } catch {
        // 附件是加分项：失败也不该让这次生成算失败。
        return undefined
    }
}

async function readJsonBody(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

/** 设置页是本地同源页面；跨站请求一律不认，尤其是会花钱的接口。 */
function sameOrigin(req) {
    const site = req.headers['sec-fetch-site']
    return site === undefined || site === 'none' || site === 'same-origin'
}

export function apply(ctx, config) {
    const log = ctx.logger?.('dsh-moss-image') ?? { info: () => {}, warn: () => {} }
    const options = () => readConfig(config)

    // 每个会话上一张图的 { seed, size, model }：follow 模式靠它让迭代时图不跳。
    // 会话是对象，用 WeakMap 挂在它身上，会话没了记录跟着回收。
    // shortcut: 只存内存，重启 DSH 后每个会话第一张重新随机；要跨重启记住再落盘到 $DSH_HOME。
    const lastBySession = new WeakMap()
    const sessionOf = (exec) => {
        const session = exec?.agent?.session
        return session && typeof session === 'object' ? session : undefined
    }

    /** 一次完整的生图流程：校验 → 请求 → 下载 → 附件 → 落盘。 */
    async function generate(input, exec, withCache = false) {
        const current = options()
        // 保存目录在花钱之前就解析掉：配错了直接拦下，别生完图才发现没处放。
        const target = resolveImagesDir(current.pathMode, current.imagesDir, exec ? await sessionCwd(ctx, exec) : undefined, homedir())
        if (!target.ok) {
            const error = new Error(`${target.message}。到「设置 → 插件 → Moss 生图」里改保存位置。`)
            error.code = 'invalid_images_dir'
            throw error
        }
        const session = sessionOf(exec)
        const last = session ? lastBySession.get(session) : undefined
        const picked = pickSeed({
            seed: input.seed,
            newSeed: input.new_seed === true,
            mode: current.seedMode,
            fixed: current.seed,
            last: last?.seed,
        })
        const { body, width, height } = buildRequest({
            model: input.model ?? current.model,
            prompt: input.prompt,
            // 追加而不是替换：模型传了负向词也别把默认那组质量负向词丢掉。
            negative_prompt: [current.negativePrompt, input.negative_prompt].filter(Boolean).join(', '),
            size: input.size ?? current.size,
            prompt_enhance: input.prompt_enhance ?? current.promptEnhance,
            seed: picked.seed,
            num_inference_steps: input.num_inference_steps ?? current.numInferenceSteps,
            guidance_scale: input.guidance_scale ?? current.guidanceScale,
            output_watermark: input.output_watermark ?? current.outputWatermark,
        })
        // 记下尺寸是不是这次调用手动指定的，回显时能说清来源。
        const sizeExplicit = typeof input.size === 'string' && input.size.trim() !== ''
        const startedAt = Date.now()
        const payload = await callMossApi(ctx, current, body)
        const url = readImageUrl(payload)
        const bytes = await downloadImage(url, AbortSignal.timeout(current.timeoutMs))
        const image = await attachImage(ctx, bytes, 'moss-image.png')
        const saved = await persistImage(bytes, target.dir, current, {
            slug: input.slug ?? 'image',
            seed: body.seed,
            width: payload.usage?.output_width ?? width,
            height: payload.usage?.output_height ?? height,
        }, withCache)
        // 只有成功出图才记成「上一张」；尺寸或模型变了，同种子也是另一张图，回显里要提醒。
        const drifted = picked.source === 'follow' && (last.size !== body.size || last.model !== body.model)
        if (session) lastBySession.set(session, { seed: body.seed, size: body.size, model: body.model })
        return { payload, saved, image, body, elapsedMs: Date.now() - startedAt, sizeExplicit, seedSource: picked.source, drifted }
    }

    const SEED_SOURCE_TEXT = { explicit: '本次指定', follow: '沿用上一张', fixed: '设置里的固定值', random: '新抽' }

    const IMAGE_OUT = {
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                text: { type: 'string', required: true },
                image: { type: 'object', additionalProperties: true },
            },
        },
        render: (_args, value) => [
            { type: 'text', text: value.text },
            ...(value.image ? [{ type: 'image', attachment: { ...value.image } }] : []),
        ],
    }

    ctx.tools.register(defineTool({
        name: 'image_generate',
        description: '用 Moss（MOSS-Image）文生图接口画一张图。用户要图、要插画、要海报、要配图时调用：先按 prompt 参数的要求把用户的想法扩写好再传进来。用户在改上一张图（换颜色、改细节、加减东西）时，在上一次的 prompt 上只改相关的词、其余原样保留，种子插件会自动沿用，这样图才不会跳。一次只出一张 PNG，耗时可能到分钟级。尺寸默认取插件设置里的值：除非用户在本次对话里明确说了尺寸或长宽比（例如「横版」「9:16」「用 1536x1024」），否则不要传 size，让设置里的默认值生效。negative_prompt、num_inference_steps、guidance_scale 同理：用户没明说就不要传。',
        parameters: {
            prompt: {
                type: 'string',
                required: true,
                description: '画面描述，最多 4000 字符。不要直接传用户原话：先扩写成一段连贯的英文描述（MOSS-Image 英文训练数据最多），依次交代主体与动作、外观细节、场景、构图与镜头、媒介/画风、光线、材质、配色、氛围；用户没说的细节由你补齐，但不要改用户指定的风格。画面里要出现的文字用双引号原样保留原语言（中文就写中文），换行写 \\n。不要堆 masterpiece、best quality、8k 这类质量词，不要写占位文案。',
            },
            negative_prompt: { type: 'string', description: '不希望出现的内容，会追加到设置里的默认负向词后面。只在用户明确说了不要什么时才传。' },
            size: { type: 'string', description: `仅当用户明确指定尺寸或长宽比时才传，否则省略、用设置里的默认尺寸。${SIZE_HELP}` },
            seed: { type: 'integer', description: '随机种子。只在用户报了具体数字（或要回到之前某张图，回显里有它的 seed）时才传；平时不传，插件按设置自动沿用本会话上一张的种子。' },
            new_seed: { type: 'boolean', description: '用户要「换一张」「来张不同的」「重新抽」时传 true，换一个新种子。在改上一张图时不要传。' },
            num_inference_steps: { type: 'integer', description: '推理步数 1–100，设置里默认 50。用户没明说就不要传。' },
            guidance_scale: { type: 'number', description: '引导系数 0–10，设置里默认 3。用户没明说就不要传；别套用 Stable Diffusion 的 7.5。' },
            prompt_enhance: { type: 'boolean', description: '是否先让服务端增强提示词再生图。一般不用传：prompt 已经由你扩写过了。' },
            output_watermark: { type: 'boolean', description: '是否加可见水印。' },
            slug: { type: 'string', description: '文件名里的短标识，如「mountain-cat」；不传则用 image。' },
        },
        output: IMAGE_OUT,
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            try {
                const result = await generate(args, exec)
                const usage = result.payload.usage ?? {}
                const { savedPath, saveError } = result.saved
                const lines = [
                    saveError
                        ? `已生成，但没存进保存目录（${saveError}）；${savedPath ? `先放在 ${savedPath}` : '图只在会话附件里'}。`
                        : `已生成：已保存到 ${savedPath}`,
                    `参数：${result.body.model} · ${result.body.size}（${result.sizeExplicit ? '本次调用指定' : '设置里的默认值'}） · seed ${result.body.seed}（${SEED_SOURCE_TEXT[result.seedSource]}）${result.body.prompt_enhance ? ' · 已增强提示词' : ''}`,
                    `实际尺寸：${usage.output_width ?? '?'}x${usage.output_height ?? '?'} · 耗时 ${(result.elapsedMs / 1000).toFixed(1)}s`,
                    ...(result.drifted ? ['提示：尺寸或模型和上一张不同，同一个种子也会出不一样的构图。'] : []),
                ]
                return { text: lines.join('\n'), ...(result.image ? { image: result.image } : {}) }
            } catch (error) {
                const code = error?.code ?? 'unknown'
                const suffix = error?.retryable ? '\n（这次可以隔一会儿重试。）' : ''
                return { text: `生图失败 [${code}]：${error?.message ?? error}${suffix}` }
            }
        },
    }))

    // ── 给网页端用的本地接口：状态、密钥、图片、连通性测试、试生成。
    ctx.inject(['webServer'], (wctx) => {
        const routePath = () => options().routePath
        const origin = () => {
            const configured = options().publicBaseUrl
            if (configured) return configured
            const port = wctx.get('webServer')?.port
            return port === undefined ? '' : `http://127.0.0.1:${port}`
        }

        const json = (res, status, value) => {
            res.statusCode = status
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            res.end(JSON.stringify(value))
        }

        wctx.effect(() => wctx.webServer.register({
            kind: 'prefix',
            path: routePath(),
            handler: async (req, res) => {
                const current = options()
                const rest = new URL(req.url ?? '/', 'http://x').pathname.slice(current.routePath.length)
                try {
                    // 图片：只服务缓存目录里由本插件写下的文件。
                    const image = /^\/i\/([0-9a-f]{24})\.png$/u.exec(rest)
                    if (image) {
                        const file = join(cacheDir(), `${image[1]}.png`)
                        const info = await stat(file)
                        res.setHeader('Content-Type', 'image/png')
                        res.setHeader('Content-Length', String(info.size))
                        res.setHeader('Cache-Control', 'private, max-age=86400')
                        res.setHeader('X-Content-Type-Options', 'nosniff')
                        if (req.method === 'HEAD') return res.end()
                        createReadStream(file).on('error', () => res.destroy()).pipe(res)
                        return
                    }

                    // 状态：key 在不在、当前生效值、可选模型与尺寸。设置页只拉这一个。
                    if (rest === '/state') {
                        const key = await readKey(ctx, current)
                        return json(res, 200, {
                            configured: Boolean(key),
                            credentialKey: current.credentialKey,
                            keyHint: key ? maskKey(key) : '',
                            value: settingsOf(current),
                            models: MODELS,
                            sizes: SIZE_PRESETS,
                            sizeOptions: SIZE_OPTIONS,
                        })
                    }

                    // 密钥读写：只接受同源请求；值直接进凭据服务，不回显、不落配置。
                    if (rest === '/key') {
                        if (!sameOrigin(req)) return json(res, 403, { ok: false, message: '只接受同源请求。' })
                        const credentials = ctx.get('credentials')
                        if (!credentials?.set) {
                            return json(res, 500, { ok: false, message: '这个 dsh 没有可写的凭据服务，无法保存密钥。' })
                        }
                        if (req.method === 'DELETE') {
                            try {
                                await credentials.unset?.(current.credentialKey)
                                return json(res, 200, { ok: true, message: '已清除 API Key。' })
                            } catch (error) {
                                return json(res, 500, { ok: false, message: `清除失败：${error?.message ?? error}` })
                            }
                        }
                        if (req.method !== 'POST') return json(res, 405, { ok: false, message: '只支持 POST / DELETE。' })
                        let payload
                        try {
                            payload = await readJsonBody(req)
                        } catch {
                            return json(res, 400, { ok: false, message: '请求体不是合法 JSON。' })
                        }
                        const value = typeof payload.value === 'string' ? payload.value.trim() : ''
                        if (value.length < 8) return json(res, 400, { ok: false, message: '这个值太短了，不像一个 API Key。' })
                        try {
                            await credentials.set(current.credentialKey, value)
                            return json(res, 200, { ok: true, message: '已保存到凭据服务。', keyHint: maskKey(value) })
                        } catch (error) {
                            return json(res, 500, { ok: false, message: `保存失败：${error?.message ?? error}` })
                        }
                    }

                    // 参数：设置页写覆盖层，保存到 $DSH_HOME，立即生效。
                    if (rest === '/config') {
                        if (!sameOrigin(req)) return json(res, 403, { ok: false, message: '只接受同源请求。' })
                        if (req.method === 'DELETE') {
                            await saveOverrides({})
                            return json(res, 200, { ok: true, message: '已恢复默认值。' })
                        }
                        if (req.method !== 'PUT' && req.method !== 'POST') {
                            return json(res, 405, { ok: false, message: '只支持 PUT / DELETE。' })
                        }
                        let payload
                        try {
                            payload = await readJsonBody(req)
                        } catch {
                            return json(res, 400, { ok: false, message: '请求体不是合法 JSON。' })
                        }
                        const checked = validateSettings(payload)
                        if (checked.errors.length > 0) {
                            return json(res, 400, { ok: false, message: checked.errors.join('；') })
                        }
                        await saveOverrides({ ...loadOverrides(), ...checked.value })
                        return json(res, 200, { ok: true, message: '已保存，下一张图就用新参数。' })
                    }

                    // 连通性：只查模型列表，不产生生图费用。
                    if (rest === '/probe') {
                        if (!sameOrigin(req)) return json(res, 403, { ok: false, message: '只接受同源请求。' })
                        const key = await readKey(ctx, current)
                        if (!key) return json(res, 400, { ok: false, message: `还没有配置密钥（凭据键名：${current.credentialKey}）。` })
                        try {
                            const response = await fetch(`${current.baseUrl}${MODELS_ENDPOINT}`, {
                                headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
                                signal: AbortSignal.timeout(20000),
                            })
                            const text = await response.text()
                            if (!response.ok) {
                                const payload = (() => { try { return JSON.parse(text) } catch { return { message: text.slice(0, 200) } } })()
                                const explained = explainError(response.status, payload)
                                return json(res, 200, { ok: false, message: explained.text })
                            }
                            const listed = (() => { try { return JSON.parse(text) } catch { return undefined } })()
                            const ids = Array.isArray(listed?.data) ? listed.data.map((m) => m?.id).filter((id) => typeof id === 'string') : []
                            return json(res, 200, { ok: true, message: `连接正常，账号可用模型 ${ids.length} 个。`, models: ids })
                        } catch (cause) {
                            return json(res, 200, { ok: false, message: `连不上 ${current.baseUrl}：${cause?.message ?? cause}` })
                        }
                    }

                    // 试生成：会花钱，只在设置页点按钮时才会走到这里。
                    if (rest === '/try') {
                        if (!sameOrigin(req)) return json(res, 403, { ok: false, message: '只接受同源请求。' })
                        let body
                        try {
                            body = await readJsonBody(req)
                        } catch {
                            return json(res, 400, { ok: false, message: '请求体不是合法 JSON。' })
                        }
                        const prompt = typeof body.prompt === 'string' && body.prompt.trim() !== ''
                            ? body.prompt
                            : '一只橘猫坐在窗边，窗外是雨后的花园，柔和的自然光，温暖细腻的摄影风格。'
                        try {
                            const result = await generate({ prompt, size: body.size }, undefined, true)
                            const file = result.saved.cachedPath.split(/[\\/]/u).pop().replace(/\.png$/u, '')
                            return json(res, 200, {
                                ok: true,
                                url: `${origin()}${current.routePath}/i/${file}.png`,
                                path: result.saved.savedPath,
                                saveError: result.saved.saveError,
                                elapsedMs: result.elapsedMs,
                            })
                        } catch (error) {
                            return json(res, 200, { ok: false, message: `${error?.message ?? error}` })
                        }
                    }

                    json(res, 404, { ok: false, message: 'not found' })
                } catch (error) {
                    log.warn('route: %s', error)
                    if (!res.headersSent) json(res, 500, { ok: false, message: String(error?.message ?? error) })
                }
            },
        }), 'dsh-moss-image: image and settings route')
    })

    // 启动时扫一眼配置，把明显的错误说清楚，省得第一次生图才发现。
    try {
        const current = options()
        const size = validateSize(current.size)
        if (!size.ok) log.warn('默认尺寸不合法，生图时会退回 1024x1024：%s', size.message)
        const dir = imagesDirProblem(current.pathMode, current.imagesDir)
        if (dir) log.warn('保存位置配置有问题，生图前会被拦下：%s', dir)
        if (!/^https?:\/\//u.test(current.baseUrl)) log.warn('baseUrl 看起来不是 http(s) 地址：%s', current.baseUrl)
    } catch (error) {
        log.warn('配置检查失败：%s', error)
    }

}