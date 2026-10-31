// dsh-moss-image · client 半边。
// 设置页里一个「Moss 生图」面板：密钥、模型、生图参数、落盘、测连通、试一张；
// 外加输入框左侧一个「生图」按钮（把提示词模板塞进草稿）。
// 这个文件必须永不抛异常：client 插件崩了会把整个 Web 界面刷白。
window.__ModuleLoader__.load({
    id: 'dsh-moss-image',
    factory(require) {
        const React = require('react')
        const h = React.createElement
        const BASE = '/x-moss-image'
        const TEMPLATE = '画一张图：\n'

        const BORDER = 'rgba(127,127,127,0.35)'
        const S = {
            wrap: { padding: 4, maxWidth: 760, fontSize: 13, lineHeight: 1.6, color: 'inherit' },
            hint: { margin: '0 0 10px', opacity: 0.65, fontSize: 12 },
            card: { border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12, marginBottom: 12 },
            cardTitle: { margin: '0 0 10px', fontSize: 12, fontWeight: 600, opacity: 0.75, letterSpacing: '0.02em' },
            row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
            label: { minWidth: 96, opacity: 0.8, flex: '0 0 auto' },
            input: {
                flex: 1, minWidth: 200, padding: '5px 8px', borderRadius: 6,
                border: `1px solid ${BORDER}`, background: 'transparent', color: 'inherit', font: 'inherit',
            },
            area: {
                flex: 1, minWidth: 260, minHeight: 56, padding: '6px 8px', borderRadius: 6, resize: 'vertical',
                border: `1px solid ${BORDER}`, background: 'transparent', color: 'inherit', font: 'inherit',
            },
            small: { flex: '0 0 auto', width: 118, padding: '5px 8px', borderRadius: 6, border: `1px solid ${BORDER}`, background: 'transparent', color: 'inherit', font: 'inherit' },
            btn: {
                padding: '5px 12px', borderRadius: 6, border: `1px solid ${BORDER}`,
                background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer',
            },
            code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, opacity: 0.85 },
            status: { minHeight: 20, fontSize: 12, opacity: 0.85 },
            check: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, cursor: 'pointer' },
        }

        const FIELDS = [
            'baseUrl', 'model', 'size', 'negativePrompt', 'numInferenceSteps',
            'guidanceScale', 'seedMode', 'seed', 'promptEnhance', 'outputWatermark',
            'pathMode', 'imagesDir', 'fileNamePattern',
        ]

        const SEED_MODE_LABELS = { follow: '沿用上一张（迭代时图不跳）', random: '每张随机', fixed: '固定值' }
        const PATH_MODE_LABELS = { workspace: '相对工作区', absolute: '绝对路径' }

        async function callJson(path, options) {
            const response = await fetch(BASE + path, options)
            const text = await response.text()
            try {
                return JSON.parse(text)
            } catch {
                return { ok: false, message: `返回的不是 JSON：${text.slice(0, 200)}` }
            }
        }

        function SettingsTab() {
            const [state, setState] = React.useState(null)
            const [form, setForm] = React.useState({})
            const [models, setModels] = React.useState([])
            const [sizeOptions, setSizeOptions] = React.useState([])
            const [keyValue, setKeyValue] = React.useState('')
            const [status, setStatus] = React.useState('')
            const [busy, setBusy] = React.useState('')
            const [preview, setPreview] = React.useState('')
            const [error, setError] = React.useState('')

            const refresh = React.useCallback(async () => {
                try {
                    const next = await callJson('/state')
                    if (!next || !next.value) {
                        setError(`读不到参数：${(next && next.message) || '返回结构不对'}`)
                        return
                    }
                    setState(next)
                    setModels(next.models || [])
                    setSizeOptions(next.sizeOptions || [])
                    const value = {}
                    for (const key of FIELDS) value[key] = next.value[key]
                    setForm(value)
                } catch (e) {
                    setError(`读不到插件状态：${e && e.message}`)
                }
            }, [])

            React.useEffect(() => { void refresh() }, [refresh])

            const patch = (key, value) => setForm((previous) => ({ ...previous, [key]: value }))

            const run = async (name, task) => {
                setBusy(name)
                setStatus('')
                setError('')
                try {
                    await task()
                } catch (e) {
                    setError(String((e && e.message) || e))
                } finally {
                    setBusy('')
                }
            }

            const saveKey = () => run('key-save', async () => {
                const value = keyValue.trim()
                if (value === '') { setStatus('先粘贴 API Key 再保存。'); return }
                const result = await callJson('/key', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ value }),
                })
                if (result.ok) { setKeyValue(''); setStatus(`已保存（${result.keyHint}）。`) } else setStatus(`保存失败：${result.message}`)
                await refresh()
            })

            const clearKey = () => run('key-clear', async () => {
                const result = await callJson('/key', { method: 'DELETE' })
                setStatus(result.ok ? '已清除。' : `清除失败：${result.message}`)
                await refresh()
            })

            const saveConfig = () => run('config-save', async () => {
                const body = {}
                for (const key of FIELDS) body[key] = form[key]
                const result = await callJson('/config', {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                })
                setStatus(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`)
                if (result.ok) await refresh()
            })

            const resetConfig = () => run('config-reset', async () => {
                const result = await callJson('/config', { method: 'DELETE' })
                setStatus(result.ok ? '✓ 已恢复默认值。' : `✗ ${result.message}`)
                await refresh()
            })

            const probe = () => run('probe', async () => {
                const result = await callJson('/probe')
                setStatus(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`)
            })

            const tryOne = () => run('try', async () => {
                setPreview('')
                const result = await callJson('/try', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ size: form.size || undefined }),
                })
                if (result.ok) {
                    const where = result.path ? `已存到 ${result.path}` : '相对工作区模式下试生成只预览、不落盘'
                    const failed = result.saveError ? `没存进保存目录（${result.saveError}），` : ''
                    setStatus(`✓ 成功，耗时 ${(result.elapsedMs / 1000).toFixed(1)}s；${failed}${where}`)
                    setPreview(result.url)
                } else {
                    setStatus(`✗ ${result.message}`)
                }
            })

            if (state === null) return h('div', { style: S.wrap }, h('p', { style: S.hint }, error !== '' ? error : '加载中…'))

            const configured = Boolean(state.configured)
            const live = state.value
            const dirty = FIELDS.some((key) => form[key] !== live[key])
            const presetSizes = sizeOptions.flatMap((option) => [option.low, option.high])

            const row = (label, control, extra) => h('div', { style: { ...S.row, marginBottom: 8 } },
                h('span', { style: S.label }, label),
                control,
                extra === undefined ? null : h('span', { style: { opacity: 0.6, fontSize: 12 } }, extra))

            const check = (label, key, note) => h('label', { style: S.check },
                h('input', {
                    type: 'checkbox',
                    checked: Boolean(form[key]),
                    onChange: (e) => patch(key, e.target.checked),
                }),
                h('span', null, label),
                note === undefined ? null : h('span', { style: { opacity: 0.55, fontSize: 12 } }, note))

            return h('div', { style: S.wrap, 'data-dsh-moss-image': '' },
                h('p', { style: S.hint },
                    '这里的改动保存后立即生效，不用重启；密钥只进 dsh 的凭据服务，不进配置文件、不回显。'),

                // ── 连接
                h('div', { style: S.card },
                    h('p', { style: S.cardTitle }, '连接'),
                    h('div', { style: { ...S.row, marginBottom: 8 } },
                        h('span', { style: S.label }, 'API Key'),
                        h('span', { style: { opacity: 0.7, fontSize: 12 } },
                            configured ? `已配置（${(state && state.keyHint) || '已保存'}）` : '未配置')),
                    h('div', { style: S.row },
                        h('input', {
                            type: 'password',
                            value: keyValue,
                            placeholder: configured ? '要更换就粘贴新的，留空不动' : '粘贴 MOSS API Key',
                            onChange: (e) => setKeyValue(e.target.value),
                            style: S.input,
                            autoComplete: 'off',
                        }),
                        h('button', { type: 'button', style: S.btn, onClick: saveKey, disabled: busy === 'key-save' }, busy === 'key-save' ? '保存中…' : '保存'),
                        h('button', { type: 'button', style: S.btn, onClick: clearKey, disabled: !configured || busy === 'key-clear' }, '清除')),
                    h('div', { style: { ...S.hint, margin: '8px 0 0' } },
                        '凭据键名：', h('span', { style: S.code }, (state && state.credentialKey) || 'MOSS_API_KEY')),

                    row('接口地址', h('input', {
                        type: 'text',
                        value: form.baseUrl,
                        onChange: (e) => patch('baseUrl', e.target.value),
                        style: S.input,
                    }), 'http(s)，默认官方地址'),

                    h('div', { style: S.row },
                        h('button', { type: 'button', style: S.btn, onClick: probe, disabled: !configured || busy === 'probe' },
                            busy === 'probe' ? '测试中…' : '测试连接'),
                        h('span', { style: { opacity: 0.6, fontSize: 12 } }, '只查模型列表，不产生生图费用'))),

                // ── 模型与参数
                h('div', { style: S.card },
                    h('p', { style: S.cardTitle }, '模型与生图参数'),
                    row('默认模型', h('select', {
                        value: form.model,
                        onChange: (e) => patch('model', e.target.value),
                        style: { ...S.input, flex: '0 1 320px' },
                    }, models.map((model) => h('option', { key: model, value: model }, model))), '带日期的快照版用于固定版本'),

                    row('尺寸', h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1 } },
                        h('select', {
                            value: presetSizes.includes(form.size) ? form.size : '',
                            onChange: (e) => { if (e.target.value !== '') patch('size', e.target.value) },
                            style: { ...S.input, flex: '0 1 240px', minWidth: 180 },
                        },
                            sizeOptions.flatMap((option) => [
                                h('option', { key: option.low, value: option.low }, `${option.ratio} · ${option.low}（低）`),
                                h('option', { key: option.high, value: option.high }, `${option.ratio} · ${option.high}（高）`),
                            ]),
                            h('option', { key: 'custom', value: '' }, '自定义…')),
                        h('input', {
                            type: 'text',
                            value: form.size,
                            onChange: (e) => patch('size', e.target.value),
                            style: S.small,
                            placeholder: '宽x高',
                        })), '每边 256–2048、16 的倍数、总像素 ≤ 2097152'),

                    row('负向提示词', h('textarea', {
                        value: form.negativePrompt,
                        onChange: (e) => patch('negativePrompt', e.target.value),
                        style: S.area,
                        rows: 2,
                    })),

                    h('div', { style: { ...S.row, marginBottom: 8 } },
                        h('span', { style: S.label }, '推理步数'),
                        h('input', {
                            type: 'text', value: form.numInferenceSteps, placeholder: '留空=服务端默认',
                            onChange: (e) => patch('numInferenceSteps', e.target.value), style: S.small,
                        }),
                        h('span', { style: S.label }, '引导系数'),
                        h('input', {
                            type: 'text', value: form.guidanceScale, placeholder: '0–10，留空=默认',
                            onChange: (e) => patch('guidanceScale', e.target.value), style: S.small,
                        })),

                    row('种子', h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1 } },
                        h('select', {
                            value: form.seedMode,
                            onChange: (e) => patch('seedMode', e.target.value),
                            style: { ...S.input, flex: '0 1 240px', minWidth: 180 },
                        }, Object.keys(SEED_MODE_LABELS).map((mode) => h('option', { key: mode, value: mode }, SEED_MODE_LABELS[mode]))),
                        form.seedMode === 'fixed' ? h('input', {
                            type: 'text', value: form.seed, placeholder: '整数',
                            onChange: (e) => patch('seed', e.target.value), style: S.small,
                        }) : null), '对话里说「换一张」就会换新种子'),

                    check('先增强提示词再生图', 'promptEnhance', '同一次请求内完成'),
                    check('给图片加可见水印', 'outputWatermark')),

                // ── 落盘
                h('div', { style: S.card },
                    h('p', { style: S.cardTitle }, '落盘'),
                    row('保存位置', h('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
                        Object.keys(PATH_MODE_LABELS).map((mode) => h('label', { key: mode, style: { ...S.check, marginBottom: 0 } },
                            h('input', {
                                type: 'radio',
                                name: 'dsh-moss-image-path-mode',
                                checked: form.pathMode === mode,
                                onChange: () => patch('pathMode', mode),
                            }),
                            h('span', null, PATH_MODE_LABELS[mode]))))),
                    row('目录', h('input', {
                        type: 'text',
                        value: form.imagesDir,
                        placeholder: form.pathMode === 'absolute' ? '~/Pictures/moss' : 'images',
                        onChange: (e) => patch('imagesDir', e.target.value),
                        style: S.input,
                    }), form.pathMode === 'absolute' ? '完整路径，可用 ~ 开头；所有会话都存这里' : '相对当前会话的工作区；设置页试生成不落盘'),
                    row('文件名', h('input', {
                        type: 'text',
                        value: form.fileNamePattern,
                        onChange: (e) => patch('fileNamePattern', e.target.value),
                        style: S.input,
                    }), '可用 {date} {time} {slug} {seed} {width} {height}')),

                // ── 保存
                h('div', { style: { ...S.row, marginBottom: 12 } },
                    h('button', {
                        type: 'button',
                        onClick: saveConfig,
                        disabled: busy === 'config-save',
                        style: { ...S.btn, fontWeight: 600 },
                    }, busy === 'config-save' ? '保存中…' : '保存参数'),
                    h('button', { type: 'button', onClick: resetConfig, disabled: busy === 'config-reset', style: S.btn }, '恢复默认'),
                    h('span', { style: { opacity: 0.6, fontSize: 12 } },
                        dirty ? '有未保存的改动' : '与当前生效值一致')),

                // ── 试生成
                h('div', { style: S.card },
                    h('p', { style: S.cardTitle }, '试生成'),
                    h('div', { style: S.row },
                        h('button', { type: 'button', style: S.btn, onClick: tryOne, disabled: !configured || busy === 'try' },
                            busy === 'try' ? '生成中（可能要几十秒）…' : '用当前尺寸生成一张'),
                        h('span', { style: { opacity: 0.6, fontSize: 12 } }, '会真的调用接口并计费，一次一张')),
                    preview === '' ? null : h('div', { style: { marginTop: 10 } },
                        h('img', { src: preview, alt: '测试生成的图片', style: { maxWidth: '100%', borderRadius: 6 } }))),

                h('p', { style: S.status }, status),
                error === '' ? null : h('p', { style: { ...S.status, color: 'inherit', opacity: 0.9 } }, error),

                h('div', { style: { ...S.hint, marginTop: 4 } },
                    '当前生效：', h('span', { style: S.code }, `${live.model} · ${live.size}`),
                    ' · 落盘：', h('span', { style: S.code }, live.pathMode === 'absolute' ? live.imagesDir : `<工作区>/${live.imagesDir}`)))
        }

        /** 输入框左侧的小按钮：把生图模板塞进草稿，不动用户已经写的内容。 */
        function ComposerButton(props) {
            const readDraft = props.useInput || ((selector) => selector({ draft: '' }))
            const draft = readDraft((state) => state.draft)
            const onClick = () => {
                try {
                    const actions = props.inputActions
                    if (!actions || typeof actions.setDraft !== 'function') return
                    const current = typeof draft === 'string' ? draft.trimStart() : ''
                    actions.setDraft(current === '' ? TEMPLATE : `画一张图：${current}\n`)
                } catch (e) {
                    // 按钮只是方便，失败就算了。
                    console.warn('[dsh-moss-image] insert prompt template failed:', e)
                }
            }
            return h('button', {
                type: 'button',
                onClick,
                title: '插入生图提示词模板',
                'aria-label': '生图',
                style: {
                    padding: '2px 8px', borderRadius: 6, border: `1px solid ${BORDER}`,
                    background: 'transparent', color: 'inherit', font: 'inherit',
                    fontSize: 12, lineHeight: 1.6, cursor: 'pointer', whiteSpace: 'nowrap',
                },
            }, '生图')
        }

        return {
            name: 'dsh-moss-image-client',
            inject: ['slots'],
            apply(ctx) {
                try {
                    ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
                        { name: 'settings.plugins.tab', id: 'dsh-moss-image', order: 60, label: 'Moss 生图' },
                        SettingsTab,
                    ))
                } catch (e) {
                    console.warn('[dsh-moss-image] settings tab disabled:', e)
                }
                try {
                    ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
                        { name: 'conversation.input.left', id: 'dsh-moss-image', order: 90, label: '生图' },
                        ComposerButton,
                    ))
                } catch (e) {
                    console.warn('[dsh-moss-image] composer button disabled:', e)
                }
            },
        }
    },
})