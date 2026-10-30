// dsh-moss-image · host 半边。
// 注册 image_generate 工具、读写 Moss API Key、把生成的图片落盘并回传给会话。
// 接口依据：https://platform.mosi.cn/docs/reference/images-generations
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createReadStream, readFileSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import {
    DEFAULT_BASE_URL,
    DEFAULT_CREDENTIAL_KEY,
    DEFAULT_NEGATIVE_PROMPT,
    ENDPOINT,
    LIMITS,
    MODELS,
    MODELS_ENDPOINT,
    SETTING_KEYS,
    SIZE_OPTIONS,
    SIZE_PRESETS,
    buildRequest,
    explainError,
    fileNameFor,
    readImageUrl,
    resolveConfig,
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
    model: MODELS[0],
    promptEnhance: false,
    size: '1024x1024',
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    numInferenceSteps: '',
    guidanceScale: '',
    seed: '',
    outputWatermark: false,
    saveToWorkspace: true,
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
    numInferenceSteps: Schema.string().default(DEFAULTS.numInferenceSteps).description('默认推理步数 1–100；留空用服务端默认。'),
    guidanceScale: Schema.string().default(DEFAULTS.guidanceScale).description('默认引导系数 0–10；留空用服务端默认。'),
    seed: Schema.string().default(DEFAULTS.seed).description('默认随机种子（整数）；留空则每次随机。'),
    outputWatermark: Schema.boolean().default(DEFAULTS.outputWatermark).description('是否给图片加可见水印。'),
    // ── 落盘
    saveToWorkspace: Schema.boolean().default(DEFAULTS.saveToWorkspace).description('把图片另存一份到工作区。'),
    imagesDir: Schema.string().default(DEFAULTS.imagesDir).description('落盘目录；相对路径按当前工作区解析，也可填绝对路径。'),
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
    const merged = resolveConfig(loadOverrides(), schemaValues, DEFAULTS)
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
        seed: String(merged.seed),
        outputWatermark: Boolean(merged.outputWatermark),
        saveToWorkspace: Boolean(merged.saveToWorkspace),
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

/** 把图片写两份：工作区可见的一份 + 路由可服务的一份。返回可用的本地路径。 */
async function persistImage(bytes, options, context, withCache) {
    let workspacePath
    if (options.saveToWorkspace) {
        const base = isAbsolute(options.imagesDir) ? options.imagesDir : resolve(context.cwd, options.imagesDir)
        await mkdir(base, { recursive: true })
        workspacePath = join(base, fileNameFor(options.fileNamePattern, context))
        await writeFile(workspacePath, bytes)
    }
    // 缓存副本只为设置页的试生成预览服务；正常生图走附件，不落第二份。
    let cachedPath
    if (withCache) {
        const cache = cacheDir()
        await mkdir(cache, { recursive: true })
        cachedPath = join(cache, `${randomBytes(12).toString('hex')}.png`)
        await writeFile(cachedPath, bytes)
    }
    return { workspacePath, cachedPath }
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

    /** 一次完整的生图流程：校验 → 请求 → 下载 → 落盘 → 附件。 */
    async function generate(input, exec, withCache = false) {
        const current = options()
        // 种子留空就自己抽一个：抽到的值能回显，这张图才谈得上复现。
        const rawSeed = input.seed ?? current.seed
        const seedAuto = rawSeed === '' || rawSeed === undefined || rawSeed === null
        const seed = seedAuto ? Math.floor(Math.random() * 2 ** 32) : rawSeed
        const { body, width, height } = buildRequest({
            model: input.model ?? current.model,
            prompt: input.prompt,
            negative_prompt: input.negative_prompt ?? current.negativePrompt,
            size: input.size ?? current.size,
            prompt_enhance: input.prompt_enhance ?? current.promptEnhance,
            seed,
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
        const saved = await persistImage(bytes, current, {
            cwd: await sessionCwd(ctx, exec),
            slug: input.slug ?? 'image',
            seed: body.seed,
            width: payload.usage?.output_width ?? width,
            height: payload.usage?.output_height ?? height,
        }, withCache)
        const image = await attachImage(ctx, bytes, 'moss-image.png')
        return { payload, saved, image, body, elapsedMs: Date.now() - startedAt, sizeExplicit, seed, seedAuto }
    }

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
        description: '用 Moss（MOSS-Image）文生图接口画一张图。用户要图、要插画、要海报、要配图时调用：把画面描述写成 prompt 传进来。一次只出一张 PNG，耗时可能到分钟级。尺寸默认取插件设置里的值：除非用户在本次对话里明确说了尺寸或长宽比（例如「横版」「9:16」「用 1536x1024」），否则不要传 size，让设置里的默认值生效。',
        parameters: {
            prompt: { type: 'string', required: true, description: '画面描述；越具体越好，最多 4000 字符。' },
            negative_prompt: { type: 'string', description: '不希望出现的内容；不传则用配置里的默认负向词。' },
            size: { type: 'string', description: `仅当用户明确指定尺寸或长宽比时才传，否则省略、用设置里的默认尺寸。${SIZE_HELP}` },
            seed: { type: 'integer', description: '随机种子，用于复现同一张图。' },
            num_inference_steps: { type: 'integer', description: '推理步数 1–100。' },
            guidance_scale: { type: 'number', description: '引导系数 0–10。' },
            prompt_enhance: { type: 'boolean', description: '是否先让服务端增强提示词再生图。' },
            output_watermark: { type: 'boolean', description: '是否加可见水印。' },
            slug: { type: 'string', description: '文件名里的短标识，如「mountain-cat」；不传则用 image。' },
        },
        output: IMAGE_OUT,
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            try {
                const result = await generate(args, exec)
                const usage = result.payload.usage ?? {}
                const lines = [
                    `已生成：${result.saved.workspacePath ? `已保存到 ${result.saved.workspacePath}` : '未保存到工作区（saveToWorkspace 关闭）'}`,
                    `参数：${result.body.model} · ${result.body.size}（${result.sizeExplicit ? '本次调用指定' : '设置里的默认值'}） · seed ${result.seed}${result.seedAuto ? '（插件随机生成）' : ''}${result.body.prompt_enhance ? ' · 已增强提示词' : ''}`,
                    `实际尺寸：${usage.output_width ?? '?'}x${usage.output_height ?? '?'} · 耗时 ${(result.elapsedMs / 1000).toFixed(1)}s`,
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
                                path: result.saved.workspacePath ?? result.saved.cachedPath,
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
        if (!/^https?:\/\//u.test(current.baseUrl)) log.warn('baseUrl 看起来不是 http(s) 地址：%s', current.baseUrl)
    } catch (error) {
        log.warn('配置检查失败：%s', error)
    }

}