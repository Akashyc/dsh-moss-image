// dsh-moss-image · Moss 文生图 API 的纯逻辑层。
// 这里不碰 DSH 的任何服务，只做参数校验、请求体拼装和错误翻译，方便本地单测。
// 接口依据：https://platform.mosi.cn/docs/reference/images-generations
import { isAbsolute, resolve } from 'node:path'

export const DEFAULT_BASE_URL = 'https://api.mosi.cn'
export const DEFAULT_CREDENTIAL_KEY = 'MOSS_API_KEY'
export const ENDPOINT = '/v1/images/generations'
export const MODELS_ENDPOINT = '/v1/models'

/** 稳定版与固定快照版模型 ID。快照版不要另传 version。 */
export const MODELS = [
    'moss-image-base-1.0',
    'moss-image-sft-1.0',
    'moss-image-base-1.0-2026-10-09',
    'moss-image-sft-1.0-2026-10-09',
]

/**
 * 尺寸矩阵：长宽比 × 分辨率档位。
 * 全部满足每边 256–2048、16 的倍数、总像素 ≤ 2097152。
 * 低档约 100 万像素，高档约 200 万像素——2048x2048 会超上限，所以高档最大只到 1440 见方。
 */
export const SIZE_OPTIONS = [
    { ratio: '1:1', low: '1024x1024', high: '1440x1440' },
    { ratio: '4:3', low: '1152x864', high: '1664x1248' },
    { ratio: '3:4', low: '864x1152', high: '1248x1664' },
    { ratio: '16:9', low: '1360x768', high: '1920x1088' },
    { ratio: '9:16', low: '768x1360', high: '1088x1920' },
]

export const SIZE_PRESETS = SIZE_OPTIONS.flatMap((option) => [option.low, option.high])

export const LIMITS = {
    minSide: 256,
    maxSide: 2048,
    multipleOf: 16,
    maxPixels: 2097152,
    promptMax: 4000,
    negativeMax: 4000,
    stepsMin: 1,
    stepsMax: 100,
    guidanceMin: 0,
    guidanceMax: 10,
    seedMax: Number.MAX_SAFE_INTEGER,
}

export const DEFAULT_NEGATIVE_PROMPT = 'nsfw, worst quality, bad anatomy, watermark, jpeg artifact'

/** 保存位置：workspace 相对当前会话工作区；absolute 固定的绝对路径。 */
export const PATH_MODES = ['workspace', 'absolute']

/** 种子模式：follow 沿用本会话上一张；random 每张新抽；fixed 一直用设置里的固定值。 */
export const SEED_MODES = ['follow', 'random', 'fixed']

/** 解析 "1024x1024" 这种尺寸串；格式不对返回 undefined。 */
export function parseSize(value) {
    if (typeof value !== 'string') return undefined
    const m = /^\s*(\d{1,5})\s*[xX×*]\s*(\d{1,5})\s*$/u.exec(value)
    if (!m) return undefined
    const width = Number(m[1])
    const height = Number(m[2])
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return undefined
    return { width, height }
}

/**
 * 本地先把尺寸校验掉，不合格就别发请求——省一次失败调用，也省一次计费。
 * 返回 { ok:true, size, width, height } 或 { ok:false, message }。
 */
export function validateSize(value) {
    const parsed = parseSize(value)
    if (!parsed) {
        const sample = SIZE_PRESETS[0]
        return { ok: false, message: `尺寸格式应为「宽x高」，例如 ${sample}；收到的是「${String(value)}」。` }
    }
    const { width, height } = parsed
    const problems = []
    for (const [label, side] of [['宽', width], ['高', height]]) {
        if (side < LIMITS.minSide || side > LIMITS.maxSide) {
            problems.push(`${label} ${side} 超出范围（${LIMITS.minSide}–${LIMITS.maxSide}）`)
        }
        if (side % LIMITS.multipleOf !== 0) {
            problems.push(`${label} ${side} 不是 ${LIMITS.multipleOf} 的倍数`)
        }
    }
    const pixels = width * height
    if (pixels > LIMITS.maxPixels) {
        problems.push(`总像素 ${pixels} 超过上限 ${LIMITS.maxPixels}（比如 2048x2048 就超了，2048x1024 刚好）`)
    }
    if (problems.length > 0) return { ok: false, message: `尺寸 ${width}x${height} 不可用：${problems.join('；')}。` }
    return { ok: true, size: `${width}x${height}`, width, height }
}

/** 校验并归一化一次请求的参数，越界直接报错，不让它走到网络。 */
export function buildRequest(input = {}) {
    // 尺寸先校验：布局坐标要按画布宽高换算。
    const size = validateSize(input.size)
    if (!size.ok) throw inputError(size.message)

    // 有布局就把它编译成接口要的 JSON 字符串当 prompt，文字 prompt 只作为模型的备注不发送。
    const layout = input.layout !== undefined && input.layout !== null
    const prompt = layout
        ? compileLayout(input.layout, size.width, size.height)
        : typeof input.prompt === 'string' ? input.prompt.trim() : ''
    if (prompt === '') throw inputError('prompt 不能为空。')
    if (prompt.length > LIMITS.promptMax) throw inputError(`prompt 太长（${prompt.length} 字符），上限 ${LIMITS.promptMax}。`)

    const body = {
        model: input.model,
        prompt,
        n: 1,
        response_format: 'url',
    }

    const negative = typeof input.negative_prompt === 'string' ? input.negative_prompt.trim() : ''
    if (negative !== '') {
        if (negative.length > LIMITS.negativeMax) {
            throw inputError(`negative_prompt 太长（${negative.length} 字符），上限 ${LIMITS.negativeMax}。`)
        }
        body.negative_prompt = negative
    }

    body.size = size.size

    // 布局 JSON 交给智能改写可能被改成散文，坐标就丢了：布局请求一律不开。
    if (typeof input.prompt_enhance === 'boolean') body.prompt_enhance = layout ? false : input.prompt_enhance

    if (input.seed !== undefined && input.seed !== null && input.seed !== '') {
        const seed = Number(input.seed)
        if (!Number.isSafeInteger(seed) || seed < 0 || seed > LIMITS.seedMax) {
            throw inputError(`seed 必须是 0–${LIMITS.seedMax} 的整数。`)
        }
        body.seed = seed
    }

    if (input.num_inference_steps !== undefined && input.num_inference_steps !== null && input.num_inference_steps !== '') {
        const steps = Number(input.num_inference_steps)
        if (!Number.isSafeInteger(steps) || steps < LIMITS.stepsMin || steps > LIMITS.stepsMax) {
            throw inputError(`num_inference_steps 必须是 ${LIMITS.stepsMin}–${LIMITS.stepsMax} 的整数。`)
        }
        body.num_inference_steps = steps
    }

    if (input.guidance_scale !== undefined && input.guidance_scale !== null && input.guidance_scale !== '') {
        const scale = Number(input.guidance_scale)
        if (!Number.isFinite(scale) || scale < LIMITS.guidanceMin || scale > LIMITS.guidanceMax) {
            throw inputError(`guidance_scale 必须是 ${LIMITS.guidanceMin}–${LIMITS.guidanceMax} 的数。`)
        }
        body.guidance_scale = scale
    }

    if (typeof input.output_watermark === 'boolean') body.output_watermark = { enabled: input.output_watermark }

    return { body, width: size.width, height: size.height, layout }
}

/**
 * 把模型给的布局编译成布局生图接口要的 JSON 字符串。
 * 模型写左上角原点、[x1, y1, x2, y2] 的像素框（大模型最熟这种写法）；
 * 接口要以画布中心为原点、[y_min, x_min, y_max, x_max] 的整数坐标。
 * 框越界、反了或缺字段直接报错让模型改，不偷偷挪框。
 * 接口依据：https://platform.moss.cn/docs/reference/layout-image-generation
 */
export function compileLayout(layout, width, height) {
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) throw inputError('layout 必须是对象。')
    const caption = typeof layout.caption === 'string' ? layout.caption.trim() : ''
    if (caption === '') throw inputError('layout.caption 不能为空：写一句整体场景和风格。')
    if (!Array.isArray(layout.items) || layout.items.length === 0) throw inputError('layout.items 至少要有一个元素。')
    const items = layout.items.map((item, index) => {
        const where = `layout.items[${index}]`
        const label = typeof item?.label === 'string' ? item.label.trim() : ''
        const itemCaption = typeof item?.caption === 'string' ? item.caption.trim() : ''
        if (label === '' || itemCaption === '') throw inputError(`${where} 要有 label 和 caption。`)
        const box = item.box
        if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) {
            throw inputError(`${where}.box 要是 4 个数字 [x1, y1, x2, y2]。`)
        }
        const [x1, y1, x2, y2] = box
        if (x1 >= x2 || y1 >= y2) throw inputError(`${where}.box 要满足 x1 < x2、y1 < y2。`)
        if (x1 < 0 || y1 < 0 || x2 > width || y2 > height) {
            throw inputError(`${where}.box 超出画布 ${width}x${height}（左上角原点）。`)
        }
        const out = { label, caption: itemCaption }
        if (typeof item.text === 'string' && item.text !== '') out.text = item.text
        else if (label === 'text') throw inputError(`${where} 是文字元素，要写要渲染的 text。`)
        out.bbox = [y1 - height / 2, x1 - width / 2, y2 - height / 2, x2 - width / 2].map(Math.round)
        return out
    })
    const meta = Array.isArray(layout.meta) ? layout.meta.filter((m) => typeof m === 'string' && m !== '') : []
    const summary = { ...(meta.length > 0 ? { meta } : {}), canvas: 'single', caption }
    return JSON.stringify({ summary, items, bbox_coord_space: 'abs_centralized', bbox_format: 'yxyx' })
}

/**
 * 按设置里的两个开关，生成给对话模型看的 prompt 写法要求。
 * rewrite：让模型扩写优化；english：最终提示词用英文。两个都关就原文照传。
 */
export function promptRules({ rewrite, english }) {
    const head = '画面描述，最多 4000 字符。'
    const text = '画面里要出现的文字用双引号原样保留原语言（中文就写中文），换行写 \\n。'
    if (!rewrite) {
        return english
            ? `${head}把用户的描述忠实翻译成英文后传入：只翻译，不增删内容、不补细节，描述很短也不扩写；去掉「画一张图：」这类指令词。${text}`
            : `${head}把用户写的描述原样传入：不翻译、不改写、不补细节，只去掉「画一张图：」这类指令词。`
    }
    const lang = english ? '一段连贯的英文描述（MOSS-Image 英文训练数据最多）' : '一段连贯的描述，沿用用户的语言'
    return `${head}不要直接传用户原话：先扩写成${lang}，依次交代主体与动作、外观细节、场景与背景、构图与镜头、媒介/画风、光线、材质、配色、氛围。`
        + '用户没说的细节由你补齐：按主题配合适的场景、构图和光线，别默认写成白底、影棚光、呆板站姿（用户要设定图、立绘时除外），也不要改用户指定的风格。'
        + `${text}不要堆 masterpiece、best quality、8k 这类质量词，不要写占位文案。`
}

function inputError(message) {
    const error = new Error(message)
    error.code = 'invalid_field_value'
    error.retryable = false
    return error
}

const ERROR_TEXT = {
    invalid_field_value: '请求参数不合法：检查字段名、类型和取值范围。',
    forbidden: '鉴权失败：API Key 缺失、无效或没有权限。去设置里检查密钥。',
    prompt_enhancement_refused: '提示词增强被模型拒绝了，这次没有生图。关掉「提示词增强」或改写描述再试。',
    safety_guardrail_blocked: '内容未通过平台安全审核。改一下提示词再试。',
    resource_not_found: '图片结果资产不存在。重新生成一次；反复出现就把请求标识发给服务方。',
    concurrency_limit_exceeded: '进行中的生成任务已达上限。等手上的任务结束再提交。',
    rate_limit_exceeded: '请求太频繁了。降低频率再试。',
    prompt_enhancement_incomplete: '增强结果被截断（502）。保留请求标识并联系服务方，别自动重试。',
    upstream_invalid_result: '上游返回的结果校验失败（502）。保留任务和追踪标识并联系服务方。',
}

/** 把 HTTP 状态码 + 响应体翻成可读文案，并标出能不能重试。 */
export function explainError(status, payload) {
    const code = payload?.error?.code ?? payload?.code ?? payload?.error?.type ?? ''
    const detail = payload?.error?.message ?? payload?.message ?? ''
    const known = ERROR_TEXT[code]
    const retryable = status === 429 || status === 502 || status === 503 || status === 504
    const head = known ?? (status === 401 || status === 403
        ? ERROR_TEXT.forbidden
        : `请求失败（HTTP ${status}${code ? ` · ${code}` : ''}）。`)
    const tail = detail ? `服务端说：${detail}` : ''
    return { status, code, retryable, text: [head, tail].filter(Boolean).join('\n') }
}

/** 从响应里取出图片 URL；结构不对就报错。 */
export function readImageUrl(payload) {
    const url = payload?.data?.[0]?.url
    if (typeof url !== 'string' || url === '') {
        const error = new Error('接口没有返回图片 URL。')
        error.code = 'upstream_invalid_result'
        error.retryable = true
        throw error
    }
    return url
}



/**
 * 这些字段的空字符串是「有意义的值」：留空表示不传（步数/系数/种子），
 * 或者表示故意清空（负向词）。其余字段的空值视为没填，回退默认。
 */
export const EMPTY_MEANS_VALUE = ['negativePrompt', 'numInferenceSteps', 'guidanceScale', 'seed']

/**
 * 合并三层配置：设置页覆盖值 ← schema 值 ← 默认值。
 * 目的是分清「没填」和「填了空」——前者回退默认，后者在允许的字段上原样保留。
 */
export function resolveConfig(overrides, schemaValues, defaults) {
    const value = {}
    for (const key of Object.keys(defaults)) {
        const over = overrides[key]
        const raw = over !== undefined ? over : schemaValues[key]
        if (raw === undefined || raw === null) {
            value[key] = defaults[key]
        } else if (raw === '' && !EMPTY_MEANS_VALUE.includes(key)) {
            value[key] = defaults[key]
        } else {
            value[key] = raw
        }
    }
    return value
}

/** 设置页可编辑的字段：/state 回显与 /config 写入只认这些。 */
export const SETTING_KEYS = [
    'baseUrl', 'model', 'size', 'negativePrompt', 'numInferenceSteps',
    'guidanceScale', 'seedMode', 'seed', 'promptRewrite', 'promptEnglish', 'layoutEnabled',
    'promptEnhance', 'outputWatermark', 'pathMode', 'imagesDir', 'fileNamePattern',
]

/**
 * 设置页提交的参数：只认白名单字段，逐项校验，错了就说清哪里错。
 * 返回 { value, errors }：value 是要落盘的合法值，errors 是给人看的提示。
 */
export function validateSettings(payload) {
    const value = {}
    const errors = []
    const str = (key) => (typeof payload[key] === 'string' ? payload[key].trim() : undefined)

    if ('baseUrl' in payload) {
        const url = str('baseUrl') ?? ''
        if (/^https?:\/\//u.test(url)) value.baseUrl = url.replace(/\/+$/u, '')
        else errors.push('Base URL 必须是 http(s) 地址')
    }
    if ('model' in payload) {
        const model = str('model') ?? ''
        if (MODELS.includes(model)) value.model = model
        else errors.push(`模型只能是：${MODELS.join(' / ')}`)
    }
    if ('size' in payload) {
        const checked = validateSize(str('size') ?? '')
        if (checked.ok) value.size = checked.size
        else errors.push(checked.message)
    }
    if ('negativePrompt' in payload) {
        const negative = str('negativePrompt') ?? ''
        if (negative.length <= LIMITS.negativeMax) value.negativePrompt = negative
        else errors.push(`负向提示词不能超过 ${LIMITS.negativeMax} 字符`)
    }
    for (const [key, label, min, max, integer] of [
        ['numInferenceSteps', '推理步数', LIMITS.stepsMin, LIMITS.stepsMax, true],
        ['guidanceScale', '引导系数', LIMITS.guidanceMin, LIMITS.guidanceMax, false],
    ]) {
        if (!(key in payload)) continue
        const raw = str(key) ?? ''
        if (raw === '') {
            value[key] = ''
            continue
        }
        const number = Number(raw)
        if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
            errors.push(`${label}要在 ${min}–${max} 之间${integer ? '的整数' : ''}`)
        } else {
            value[key] = String(number)
        }
    }
    if ('seedMode' in payload) {
        const mode = str('seedMode') ?? ''
        if (SEED_MODES.includes(mode)) value.seedMode = mode
        else errors.push(`种子模式只能是：${SEED_MODES.join(' / ')}`)
    }
    if ('seed' in payload) {
        const raw = str('seed') ?? ''
        if (raw === '') {
            if (value.seedMode === 'fixed') errors.push('固定种子模式下要填一个种子')
            else value.seed = ''
        } else {
            const number = Number(raw)
            if (!Number.isSafeInteger(number) || number < 0) errors.push('种子要是 0 以上的整数')
            else value.seed = String(number)
        }
    }
    for (const key of ['promptRewrite', 'promptEnglish', 'layoutEnabled', 'promptEnhance', 'outputWatermark']) {
        if (key in payload) value[key] = Boolean(payload[key])
    }
    if ('pathMode' in payload) {
        const mode = str('pathMode') ?? ''
        if (PATH_MODES.includes(mode)) value.pathMode = mode
        else errors.push(`保存位置只能是：${PATH_MODES.join(' / ')}`)
    }
    if ('imagesDir' in payload) {
        const dir = str('imagesDir') ?? ''
        // 模式和目录一起提交时才能交叉校验；只给目录就只查非空。
        const problem = value.pathMode ? imagesDirProblem(value.pathMode, dir) : dir === '' ? '保存目录不能为空' : ''
        if (problem) errors.push(problem)
        else value.imagesDir = dir
    }
    if ('fileNamePattern' in payload) {
        const pattern = str('fileNamePattern') ?? ''
        if (pattern === '') errors.push('文件名模板不能为空')
        else value.fileNamePattern = pattern
    }
    return { value, errors }
}

/** 以 ~ 开头（~ 或 ~/、~\）也算绝对路径：用户填 ~/Pictures 是想要家目录，不是工作区里一个叫 ~ 的文件夹。 */
const HOME_PREFIX = /^~(?=$|[\\/])/u

function looksAbsolute(dir) {
    return HOME_PREFIX.test(dir) || isAbsolute(dir)
}

/** 保存位置和目录对不对得上；对得上返回空串，否则返回给人看的提示。 */
export function imagesDirProblem(mode, dir) {
    const trimmed = typeof dir === 'string' ? dir.trim() : ''
    if (trimmed === '') return '保存目录不能为空'
    if (!PATH_MODES.includes(mode)) return `保存位置只能是：${PATH_MODES.join(' / ')}`
    if (mode === 'absolute' && !looksAbsolute(trimmed)) {
        return `「绝对路径」模式要填完整路径，例如 ~/Pictures/moss；收到的是「${trimmed}」`
    }
    if (mode === 'workspace' && looksAbsolute(trimmed)) {
        return `「相对工作区」模式要填相对路径，例如 images；要存到固定位置，把保存位置切到「绝对路径」`
    }
    return ''
}

/**
 * 按保存位置把目录解析成绝对路径。返回 { ok:true, dir } 或 { ok:false, message }。
 * 相对工作区模式下没有会话（cwd 为空，比如设置页试生成）时 dir 为 undefined：无处可存，由调用方决定不落盘。
 */
export function resolveImagesDir(mode, dir, cwd, home) {
    const problem = imagesDirProblem(mode, dir)
    if (problem) return { ok: false, message: problem }
    const trimmed = dir.trim()
    if (mode === 'absolute') return { ok: true, dir: trimmed.replace(HOME_PREFIX, home) }
    return { ok: true, dir: cwd ? resolve(cwd, trimmed) : undefined }
}

/**
 * 老覆盖层没有 pathMode / seedMode：按旧字段推断一次，升级后行为不变。
 * 设置页再保存一次就会写下显式值，之后不再走这里。
 */
export function upgradeOverrides(overrides) {
    const next = { ...overrides }
    if (next.pathMode === undefined && typeof next.imagesDir === 'string' && looksAbsolute(next.imagesDir.trim())) {
        next.pathMode = 'absolute'
    }
    if (next.seedMode === undefined && typeof next.seed === 'string' && next.seed.trim() !== '') next.seedMode = 'fixed'
    return next
}

const randomSeed = () => Math.floor(Math.random() * 2 ** 32)

/**
 * 决定这张图用哪个种子，并说清来源（explicit / follow / fixed / random）。
 * 优先级：本次指定 > 要求换种子 > 种子模式。follow 模式下本会话还没有上一张时新抽一个。
 */
export function pickSeed({ seed, newSeed, mode, fixed, last, random = randomSeed }) {
    if (seed !== undefined && seed !== null && seed !== '') return { seed, source: 'explicit' }
    if (!newSeed) {
        if (mode === 'fixed' && fixed !== undefined && fixed !== null && fixed !== '') return { seed: fixed, source: 'fixed' }
        if (mode === 'follow' && last !== undefined) return { seed: last, source: 'follow' }
    }
    return { seed: random(), source: 'random' }
}

/** 文件名占位符：{date} {time} {slug} {seed} {width} {height}。 */
export function fileNameFor(pattern, context = {}) {
    const now = context.now instanceof Date ? context.now : new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const slug = (context.slug ?? 'image')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, 40) || 'image'
    const raw = (pattern ?? '{date}-{time}-{slug}')
        .replace(/\{date\}/gu, date)
        .replace(/\{time\}/gu, time)
        .replace(/\{slug\}/gu, slug)
        .replace(/\{seed\}/gu, String(context.seed ?? ''))
        .replace(/\{width\}/gu, String(context.width ?? ''))
        .replace(/\{height\}/gu, String(context.height ?? ''))
    // 去掉各平台的非法文件名字符，也挡住路径穿越。
    const safe = raw.replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, '-').replace(/^\.+/u, '').trim()
    return `${safe || 'image'}.png`
}
