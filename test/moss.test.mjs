// 纯逻辑层单测：node --test test/
// 这里只测不联网、不碰 dsh 服务的部分，跑得动就说明校验和错误翻译没写歪。
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import {
    DEFAULT_NEGATIVE_PROMPT,
    LIMITS,
    buildRequest,
    explainError,
    fileNameFor,
    imagesDirProblem,
    parseSize,
    pickSeed,
    readImageUrl,
    resolveConfig,
    resolveImagesDir,
    upgradeOverrides,
    validateSettings,
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

test('validateSettings 归一化合法输入', () => {
    const { value, errors } = validateSettings({
        size: ' 1024x1024 ',
        baseUrl: 'https://api.mosi.cn/',
        model: 'moss-image-base-1.0',
        numInferenceSteps: '30',
        guidanceScale: '7.5',
        seed: '42',
        promptEnhance: true,
    })
    assert.deepEqual(errors, [])
    assert.equal(value.size, '1024x1024')
    assert.equal(value.baseUrl, 'https://api.mosi.cn')
    assert.equal(value.numInferenceSteps, '30')
    assert.equal(value.guidanceScale, '7.5')
    assert.equal(value.seed, '42')
    assert.equal(value.promptEnhance, true)
})

test('validateSettings 拦下越界尺寸和参数', () => {
    const { errors } = validateSettings({
        size: '2048x2048',
        baseUrl: 'ftp://x',
        model: 'nope',
        numInferenceSteps: '0',
        guidanceScale: '11',
        seed: '-1',
        imagesDir: '',
    })
    assert.equal(errors.length, 7, errors.join(' | '))
    assert.ok(errors.some((e) => e.includes('总像素')))
    assert.ok(errors.some((e) => e.includes('http(s)')))
})

test('validateSettings 保留留空语义', () => {
    const { value, errors } = validateSettings({ numInferenceSteps: '', guidanceScale: '', seed: '' })
    assert.deepEqual(errors, [])
    assert.equal(value.numInferenceSteps, '')
    assert.equal(value.guidanceScale, '')
    assert.equal(value.seed, '')
})

test('resolveConfig 分得清「没填」和「填了空」', () => {
    const defaults = { baseUrl: 'https://api.x', negativePrompt: 'nsfw', guidanceScale: '7', size: '1024x1024' }

    // 清空负向词是有效操作，不该被默认值顶回来
    assert.equal(resolveConfig({ negativePrompt: '' }, {}, defaults).negativePrompt, '')
    // 留空步数/系数同样有效
    assert.equal(resolveConfig({ guidanceScale: '' }, {}, defaults).guidanceScale, '')
    // 清空 baseUrl 会让请求打到坏地址，回退默认
    assert.equal(resolveConfig({ baseUrl: '' }, {}, defaults).baseUrl, 'https://api.x')
    // 覆盖值优先于 schema 值
    assert.equal(resolveConfig({ negativePrompt: 'blur' }, { negativePrompt: 'x' }, defaults).negativePrompt, 'blur')
    // 两层都没填就用默认
    assert.equal(resolveConfig({}, {}, defaults).negativePrompt, 'nsfw')
    // schema 有值、覆盖层没填，用 schema 的值
    assert.equal(resolveConfig({}, { size: '864x1152' }, defaults).size, '864x1152')
})

test('imagesDirProblem 要求模式和目录对得上', () => {
    assert.equal(imagesDirProblem('workspace', 'images'), '')
    assert.equal(imagesDirProblem('absolute', '/data/moss'), '')
    assert.equal(imagesDirProblem('absolute', '~/Pictures/moss'), '')
    assert.match(imagesDirProblem('absolute', 'images'), /绝对路径/u)
    assert.match(imagesDirProblem('workspace', '/data/moss'), /相对工作区/u)
    // ~ 开头是家目录，不能当成工作区里叫 ~ 的文件夹
    assert.match(imagesDirProblem('workspace', '~/Pictures'), /相对工作区/u)
    assert.match(imagesDirProblem('workspace', '  '), /不能为空/u)
    assert.match(imagesDirProblem('nope', 'images'), /保存位置/u)
})

test('resolveImagesDir 按模式解析目录', () => {
    assert.deepEqual(resolveImagesDir('workspace', ' images ', '/work', '/home/u'), { ok: true, dir: resolve('/work', 'images') })
    assert.deepEqual(resolveImagesDir('absolute', '~/Pictures/moss', '/work', '/home/u'), { ok: true, dir: '/home/u/Pictures/moss' })
    assert.deepEqual(resolveImagesDir('absolute', '/data/moss', undefined, '/home/u'), { ok: true, dir: '/data/moss' })
    // 没有会话（设置页试生成）：相对工作区模式无处可存，交给调用方不落盘
    assert.deepEqual(resolveImagesDir('workspace', 'images', undefined, '/home/u'), { ok: true, dir: undefined })
    assert.equal(resolveImagesDir('absolute', 'images', '/work', '/home/u').ok, false)
})

test('upgradeOverrides 从旧字段推断新模式，显式值不动', () => {
    assert.equal(upgradeOverrides({ imagesDir: '/data/moss' }).pathMode, 'absolute')
    assert.equal(upgradeOverrides({ imagesDir: 'images' }).pathMode, undefined)
    assert.equal(upgradeOverrides({ imagesDir: '/data/moss', pathMode: 'workspace' }).pathMode, 'workspace')
    assert.equal(upgradeOverrides({ seed: '42' }).seedMode, 'fixed')
    assert.equal(upgradeOverrides({ seed: '' }).seedMode, undefined)
    assert.equal(upgradeOverrides({ seed: '42', seedMode: 'follow' }).seedMode, 'follow')
})

test('pickSeed 按优先级挑种子并标出来源', () => {
    const random = () => 7
    // 本次指定压过一切
    assert.deepEqual(pickSeed({ seed: 1, newSeed: true, mode: 'fixed', fixed: '42', last: 9, random }), { seed: 1, source: 'explicit' })
    // 要求换种子压过模式
    assert.deepEqual(pickSeed({ newSeed: true, mode: 'follow', last: 9, random }), { seed: 7, source: 'random' })
    assert.deepEqual(pickSeed({ newSeed: true, mode: 'fixed', fixed: '42', random }), { seed: 7, source: 'random' })
    // follow：有上一张就沿用，没有就新抽；0 也是合法的上一张
    assert.deepEqual(pickSeed({ mode: 'follow', last: 9, random }), { seed: 9, source: 'follow' })
    assert.deepEqual(pickSeed({ mode: 'follow', last: 0, random }), { seed: 0, source: 'follow' })
    assert.deepEqual(pickSeed({ mode: 'follow', random }), { seed: 7, source: 'random' })
    // fixed：用固定值；固定值没填就退回新抽
    assert.deepEqual(pickSeed({ mode: 'fixed', fixed: '42', last: 9, random }), { seed: '42', source: 'fixed' })
    assert.deepEqual(pickSeed({ mode: 'fixed', fixed: '', random }), { seed: 7, source: 'random' })
    // random：无视上一张
    assert.deepEqual(pickSeed({ mode: 'random', last: 9, random }), { seed: 7, source: 'random' })
})

test('validateSettings 交叉校验保存位置与种子模式', () => {
    assert.deepEqual(validateSettings({ pathMode: 'absolute', imagesDir: '~/Pictures/moss' }).errors, [])
    assert.match(validateSettings({ pathMode: 'absolute', imagesDir: 'images' }).errors.join(), /绝对路径/u)
    assert.match(validateSettings({ pathMode: 'workspace', imagesDir: '/data' }).errors.join(), /相对工作区/u)
    assert.match(validateSettings({ pathMode: 'elsewhere' }).errors.join(), /保存位置/u)
    assert.match(validateSettings({ seedMode: 'fixed', seed: '' }).errors.join(), /固定种子/u)
    assert.deepEqual(validateSettings({ seedMode: 'follow', seed: '' }).errors, [])
    assert.match(validateSettings({ seedMode: 'sometimes' }).errors.join(), /种子模式/u)
})
