// 纯逻辑层单测：node --test test/
// 这里只测不联网、不碰 dsh 服务的部分，跑得动就说明校验和错误翻译没写歪。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    DEFAULT_NEGATIVE_PROMPT,
    LIMITS,
    buildRequest,
    compileLayout,
    explainError,
    fileNameFor,
    imagesDirProblem,
    parseSize,
    pickSeed,
    promptRules,
    readImageUrl,
    resolveConfig,
    resolveImagesDir,
    upgradeOverrides,
    validateSettings,
    validateSize,
} from '../lib/moss.js'
import { STYLES, applyStyle, styleById } from '../lib/styles.js'
import {
    createAlbum,
    listLibrary,
    moveFiles,
    patchEntry,
    readLibrary,
    relProblem,
} from '../lib/library.js'

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

test('imagesDirProblem 只认绝对路径', () => {
    assert.equal(imagesDirProblem('/data/moss'), '')
    assert.equal(imagesDirProblem('~/Pictures/Moss'), '')
    assert.match(imagesDirProblem('images'), /完整路径/u)
    assert.match(imagesDirProblem('  '), /不能为空/u)
})

test('resolveImagesDir 展开 ~，相对路径直接拦下', () => {
    assert.deepEqual(resolveImagesDir('~/Pictures/Moss', '/home/u'), { ok: true, dir: '/home/u/Pictures/Moss' })
    assert.deepEqual(resolveImagesDir(' /data/moss ', '/home/u'), { ok: true, dir: '/data/moss' })
    assert.equal(resolveImagesDir('images', '/home/u').ok, false)
})

test('upgradeOverrides 丢掉旧版 pathMode 与相对目录', () => {
    const migrated = upgradeOverrides({ pathMode: 'absolute', imagesDir: '/data/moss' })
    assert.equal(migrated.pathMode, undefined)
    assert.equal(migrated.imagesDir, '/data/moss')
    // 老配置里的相对目录在新版无处可放：删掉走默认值
    assert.equal(upgradeOverrides({ imagesDir: 'images' }).imagesDir, undefined)
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

test('validateSettings 校验保存目录、画风与种子模式', () => {
    assert.deepEqual(validateSettings({ imagesDir: '~/Pictures/Moss' }).errors, [])
    assert.match(validateSettings({ imagesDir: 'images' }).errors.join(), /完整路径/u)
    assert.deepEqual(validateSettings({ style: '' }).errors, [])
    assert.deepEqual(validateSettings({ style: 'ink-wash' }).errors, [])
    assert.match(validateSettings({ style: 'nope' }).errors.join(), /画风/u)
    assert.match(validateSettings({ seedMode: 'fixed', seed: '' }).errors.join(), /固定种子/u)
    assert.deepEqual(validateSettings({ seedMode: 'follow', seed: '' }).errors, [])
    assert.match(validateSettings({ seedMode: 'sometimes' }).errors.join(), /种子模式/u)
})

// 官方布局生图文档的示例（1024x1024），换成左上角原点的框后应当一字不差地编译回去。
const EXPLORE_LAYOUT = {
    meta: ['poster'],
    caption: 'A minimalist travel poster with a cream background, a blue mountain illustration, and the title EXPLORE at the top.',
    items: [
        { label: 'text', caption: 'Large dark-blue uppercase title centered at the top.', text: 'EXPLORE', box: [128, 96, 896, 224] },
        { label: 'object', caption: 'A flat blue mountain illustration in the lower center.', box: [224, 320, 800, 896] },
    ],
}
const EXPLORE_JSON = '{"summary":{"meta":["poster"],"canvas":"single","caption":"A minimalist travel poster with a cream background, a blue mountain illustration, and the title EXPLORE at the top."},"items":[{"label":"text","caption":"Large dark-blue uppercase title centered at the top.","text":"EXPLORE","bbox":[-416,-384,-288,384]},{"label":"object","caption":"A flat blue mountain illustration in the lower center.","bbox":[-192,-288,384,288]}],"bbox_coord_space":"abs_centralized","bbox_format":"yxyx"}'

test('compileLayout 复现官方文档示例', () => {
    assert.equal(compileLayout(EXPLORE_LAYOUT, 1024, 1024), EXPLORE_JSON)
})

test('compileLayout 按非正方形画布换算中心坐标', () => {
    const json = JSON.parse(compileLayout({ caption: 'x', items: [{ label: 'object', caption: 'y', box: [0, 0, 1248, 1664] }] }, 1248, 1664))
    assert.deepEqual(json.items[0].bbox, [-832, -624, 832, 624])
    assert.equal(json.summary.meta, undefined)
})

test('compileLayout 拦下坏布局', () => {
    const item = { label: 'object', caption: 'y', box: [0, 0, 10, 10] }
    const cases = [
        [null, /对象/u],
        [{ items: [item] }, /caption/u],
        [{ caption: 'x', items: [] }, /至少/u],
        [{ caption: 'x', items: [{ ...item, box: [0, 0, 10] }] }, /4 个数字/u],
        [{ caption: 'x', items: [{ ...item, box: [10, 0, 0, 10] }] }, /x1 < x2/u],
        [{ caption: 'x', items: [{ ...item, box: [0, 0, 2000, 10] }] }, /超出画布/u],
        [{ caption: 'x', items: [{ label: 'text', caption: 'title', box: [0, 0, 10, 10] }] }, /text/u],
    ]
    for (const [layout, keyword] of cases) assert.throws(() => compileLayout(layout, 1024, 1024), keyword)
})

test('buildRequest 用布局时发编译后的 JSON 并关掉智能改写', () => {
    const { body, layout } = buildRequest({ prompt: '海报', layout: EXPLORE_LAYOUT, size: '1024x1024', prompt_enhance: true })
    assert.equal(layout, true)
    assert.equal(body.prompt, EXPLORE_JSON)
    assert.equal(body.prompt_enhance, false)
    assert.equal(buildRequest({ prompt: '海报', size: '1024x1024', prompt_enhance: true }).body.prompt_enhance, true)
})

test('promptRules 四种开关组合写法各不相同，关掉改写就要求原文', () => {
    const both = promptRules({ rewrite: true, english: true })
    assert.match(both, /英文描述/u)
    assert.match(both, /别默认写成白底/u)
    assert.doesNotMatch(promptRules({ rewrite: true, english: false }), /英文/u)
    assert.match(promptRules({ rewrite: false, english: true }), /忠实翻译成英文/u)
    const raw = promptRules({ rewrite: false, english: false })
    assert.match(raw, /原样传入/u)
    assert.match(raw, /一个字都别动/u)
    // 想改措辞必须先问用户：这条是需求里的硬要求，掉了就等于允许模型私自改词
    assert.match(raw, /等用户同意/u)
    assert.doesNotMatch(raw, /扩写成/u)
    // 选了画风就告诉模型别自己再写风格词
    assert.match(promptRules({ rewrite: false, english: false, styleLabel: '水墨' }), /画风由插件设置统一追加（当前：水墨）/u)
})

test('画风目录：拼在最前面，没选就一个字都不动', () => {
    assert.equal(STYLES.length, 4)
    assert.equal(styleById(''), undefined)
    assert.equal(styleById('nope'), undefined)
    assert.equal(styleById('ink-wash').label, '粗墨飞白写意水墨国画风')
    assert.equal(applyStyle('', '一只猫'), '一只猫')
    assert.equal(applyStyle(undefined, '一只猫'), '一只猫')
    assert.equal(applyStyle('ink', '一只猫'), 'ink, 一只猫')
    assert.equal(applyStyle('ink', '  一只猫  '), 'ink, 一只猫')
    assert.equal(applyStyle('ink', ''), 'ink')
})

// 图库只有一层相册 + 平铺文件，元数据跟着文件搬。删图那条会动真废纸篓，这里不测。
test('图库：列表、搬相册、元数据跟着走，越界路径一律拒', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moss-lib-'))
    try {
        await writeFile(join(root, 'a.png'), 'a')
        await writeFile(join(root, 'b.png'), 'b')
        await patchEntry(root, 'a.png', { prompt: '猫', seed: 42 })

        const first = await listLibrary(root, '')
        assert.deepEqual(first.items.map((item) => item.rel).sort(), ['a.png', 'b.png'])
        assert.equal(first.items.find((item) => item.rel === 'a.png').meta.prompt, '猫')

        await createAlbum(root, '风景')
        assert.deepEqual(await moveFiles(root, ['a.png'], '风景'), ['风景/a.png'])
        const meta = await readLibrary(root)
        assert.equal(meta['风景/a.png'].seed, 42)
        assert.equal(meta['a.png'], undefined)

        const inAlbum = await listLibrary(root, '风景')
        assert.deepEqual(inAlbum.items.map((item) => item.rel), ['风景/a.png'])
        assert.deepEqual(inAlbum.albums.map((album) => album.name), ['风景'])

        for (const bad of ['../x.png', '/etc/x.png', 'a/../b.png', 'a/b/c.png', 'x.jpg', '..', '']) {
            assert.notEqual(relProblem(bad), '', `应当拒绝 ${bad}`)
        }
        assert.equal(relProblem('风景/a.png'), '')
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
