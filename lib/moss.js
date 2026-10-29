// dsh-moss-image · Moss 文生图 API 的纯逻辑层。
// 这里不碰 DSH 的任何服务，只做参数校验、请求体拼装和错误翻译，方便本地单测。
// 接口依据：https://platform.mosi.cn/docs/reference/images-generations

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
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
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

    const size = validateSize(input.size)
    if (!size.ok) throw inputError(size.message)
    body.size = size.size

    if (typeof input.prompt_enhance === 'boolean') body.prompt_enhance = input.prompt_enhance

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

    return { body, width: size.width, height: size.height }
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
