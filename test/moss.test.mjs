// 纯逻辑层单测：node --test test/
// 这里只测不联网、不碰 dsh 服务的部分，跑得动就说明校验和错误翻译没写歪。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
    DEFAULT_NEGATIVE_PROMPT,
    LIMITS,
    buildRequest,
    explainError,
    fileNameFor,
    parseSize,
    readImageUrl,
    validateSize,
} from '../lib/moss.js'

test('parseSize 接受常见写法', () => {
    assert.deepEqual(parseSize('1024x1024'), { width: 1024, height: 1024 })
    assert.deepEqual(parseSize(' 1280X720 '), { width: 1280, height: 720 })
    assert.deepEqual(parseSize('1024×1536'), { width: 1024, height: 1536 })
})

test('parseSize 拒绝垃圾输入', () => {
    for (const bad of ['', '1024', 'axb', '1024x', undefined, null, 1024]) {
        assert.equal(parseSize(bad), undefined, `应当拒绝 ${String(bad)}`)
    }
})

test('validateSize 放过合规尺寸', () => {
    for (const size of ['1024x1024', '1280x720', '2048x1024', '1024x2048', '512x512']) {
        const result = validateSize(size)
        assert.equal(result.ok, true, `${size} 应当合规：${result.message ?? ''}`)
    }
})

test('validateSize 拦下越界和不对齐', () => {
    const cases = [
        ['2048x2048', '总像素'],
        ['1000x1000', '倍数'],
        ['128x128', '范围'],
        ['4096x1024', '范围'],
        ['abc', '格式'],
    ]
    for (const [size, keyword] of cases) {
        const result = validateSize(size)
        assert.equal(result.ok, false, `${size} 应当被拦下`)
        assert.match(result.message, new RegExp(keyword, 'u'), `${size} 的提示要提到「${keyword}」`)
    }
})

test('buildRequest 补默认值并锁死不可变项', () => {
    const { body } = buildRequest({ prompt: '一只橘猫', model: 'moss-image-base-1.0', size: '1024x1024' })
    assert.equal(body.n, 1)
    assert.equal(body.response_format, 'url')
    assert.equal(body.prompt, '一只橘猫')
    assert.equal(body.size, '1024x1024')
    assert.equal(body.seed, undefined)
})

test('buildRequest 修剪 prompt 并拒绝空 prompt', () => {
    assert.equal(buildRequest({ prompt: '  橘猫  ', size: '1024x1024' }).body.prompt, '橘猫')
    assert.throws(() => buildRequest({ prompt: '   ', size: '1024x1024' }), /prompt 不能为空/u)
})

test('buildRequest 保留负向词与显式的 0', () => {
    const { body } = buildRequest({
        prompt: '海报',
        size: '1024x1024',
        negative_prompt: DEFAULT_NEGATIVE_PROMPT,
        guidance_scale: 0,
        seed: 42,
        num_inference_steps: 30,
        prompt_enhance: true,
        output_watermark: false,
    })
    assert.equal(body.negative_prompt, DEFAULT_NEGATIVE_PROMPT)
    assert.equal(body.guidance_scale, 0)
    assert.equal(body.seed, 42)
    assert.equal(body.num_inference_steps, 30)
    assert.equal(body.prompt_enhance, true)
    assert.deepEqual(body.output_watermark, { enabled: false })
})

test('buildRequest 拦下越界参数', () => {
    assert.throws(() => buildRequest({ prompt: 'x', size: '1024x1024', seed: -1 }), /seed/u)
    assert.throws(() => buildRequest({ prompt: 'x', size: '1024x1024', seed: 1.5 }), /seed/u)
    assert.throws(() => buildRequest({ prompt: 'x', size: '1024x1024', num_inference_steps: 0 }), /num_inference_steps/u)
    assert.throws(() => buildRequest({ prompt: 'x', size: '1024x1024', num_inference_steps: 101 }), /num_inference_steps/u)
    assert.throws(() => buildRequest({ prompt: 'x', size: '1024x1024', guidance_scale: 11 }), /guidance_scale/u)
    assert.throws(() => buildRequest({ prompt: 'x'.repeat(LIMITS.promptMax + 1), size: '1024x1024' }), /太长/u)
})

test('explainError 把常见错误翻成人话', () => {
    const forbidden = explainError(403, { error: { code: 'forbidden' } })
    assert.match(forbidden.text, /API Key/u)
    assert.equal(forbidden.retryable, false)

    const blocked = explainError(403, { error: { code: 'safety_guardrail_blocked' } })
    assert.match(blocked.text, /安全审核/u)

    const limited = explainError(429, { error: { code: 'rate_limit_exceeded' } })
    assert.equal(limited.retryable, true)

    const unknown = explainError(418, { message: 'teapot' })
    assert.match(unknown.text, /HTTP 418/u)
    assert.match(unknown.text, /teapot/u)
})

test('readImageUrl 拿到地址，坏结构就报错', () => {
    assert.equal(readImageUrl({ data: [{ url: 'https://x/y.png' }] }), 'https://x/y.png')
    assert.throws(() => readImageUrl({ data: [] }), /没有返回图片 URL/u)
})

test('fileNameFor 填占位符并清洗非法字符', () => {
    const name = fileNameFor('{date}-{time}-{slug}', {
        now: new Date(2026, 9, 29, 8, 5, 3),
        slug: 'a/b:c d',
    })
    assert.equal(name, '20261029-080503-a-b-c-d.png')
})

test('fileNameFor 挡住路径穿越', () => {
    const name = fileNameFor('{slug}', { slug: '../../etc/passwd' })
    assert.doesNotMatch(name, /\//u)
    assert.doesNotMatch(name, /\.\./u)
    assert.match(name, /\.png$/u)
})
