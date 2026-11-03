// dsh-moss-image · client 半边。
// 三块：设置侧栏里的「Moss 生图」一节（密钥、模型、参数、画风、落盘、测连通、试一张）；
// 侧栏里的「Moss 图库」入口与主面板（放大、改图、删除、多选、相册）；
// 输入框左侧的「生图」按钮（把提示词模板塞进草稿）。
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
            'guidanceScale', 'seedMode', 'seed', 'promptRewrite', 'promptEnglish', 'layoutEnabled',
            'promptEnhance', 'outputWatermark', 'imagesDir', 'fileNamePattern', 'style',
        ]

        const SEED_MODE_LABELS = { follow: '沿用上一张（迭代时图不跳）', random: '每张随机', fixed: '固定值' }

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
                    const where = result.path ? `已存到 ${result.path}` : '没落盘，只在预览里'
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

                    row('画风', h('select', {
                        value: form.style,
                        onChange: (e) => patch('style', e.target.value),
                        style: { ...S.input, flex: '0 1 300px', minWidth: 220 },
                    },
                        h('option', { key: 'none', value: '' }, '不追加画风'),
                        (state.styles || []).map((style) => h('option', { key: style.id, value: style.id }, style.label))),
                        '选中的画风提示词会拼在你写的描述最前面'),

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

                    check('让 DeepSeek 优化提示词', 'promptRewrite', '关掉就把你的描述原样传过去'),
                    check('转成英文提示词', 'promptEnglish', 'MOSS-Image 英文训练数据最多；画面里的文字保留原语言'),
                    check('开启布局生图', 'layoutEnabled', '海报、精确文字位置时，模型给出元素坐标（实验性）'),
                    check('服务端智能改写', 'promptEnhance', '同一次请求内完成；布局生图时自动关闭'),
                    form.promptRewrite && form.promptEnhance
                        ? h('p', { style: { ...S.hint, margin: '0 0 6px 22px' } }, '两层改写会互相限制：DeepSeek 先定下的构图，服务端改写就动不了了。建议只开一个。')
                        : null,
                    check('给图片加可见水印', 'outputWatermark')),

                // ── 落盘
                h('div', { style: S.card },
                    h('p', { style: S.cardTitle }, '落盘'),
                    row('目录', h('input', {
                        type: 'text',
                        value: form.imagesDir,
                        placeholder: '~/Pictures/Moss',
                        onChange: (e) => patch('imagesDir', e.target.value),
                        style: S.input,
                    }), '完整路径（可用 ~ 开头）；所有会话、所有相册都在这里'),
                    (state.imagesRoot || '') === '' ? null : h('p', { style: { ...S.hint, margin: '-2px 0 8px 104px' } },
                        '当前解析到：', h('span', { style: S.code }, state.imagesRoot)),
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
                    ' · 画风：', h('span', { style: S.code }, (state.styles || []).find((style) => style.id === live.style)?.label || '不追加'),
                    ' · 落盘：', h('span', { style: S.code }, live.imagesDir)))
        }

        // ── 图库：侧栏一个入口，主面板里看点、放大、改图、删除、多选、归档
        const G = {
            panel: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontSize: 13, color: 'inherit' },
            bar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', borderBottom: `1px solid ${BORDER}` },
            body: { flex: 1, overflowY: 'auto', padding: 14, minHeight: 0 },
            grid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' },
            card: (selected) => ({
                position: 'relative', borderRadius: 8, overflow: 'hidden', cursor: 'zoom-in',
                border: `1px solid ${selected ? 'rgba(64,144,240,0.95)' : BORDER}`,
                background: selected ? 'rgba(64,144,240,0.1)' : 'transparent',
            }),
            thumb: { display: 'block', width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', background: 'rgba(127,127,127,0.08)' },
            name: { padding: '6px 8px', fontSize: 11, opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
            overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
            zoom: { maxWidth: '90vw', maxHeight: '78vh', borderRadius: 8, background: '#111' },
            dialog: { width: 'min(580px, 92vw)', background: '#1c1c20', color: '#eee', border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' },
            empty: { opacity: 0.6, padding: '48px 0', textAlign: 'center' },
        }

        function GalleryIcon(props) {
            const size = props && props.size ? props.size : 18
            return h('svg', {
                width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
                stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
                'aria-hidden': 'true',
            },
                h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }),
                h('circle', { cx: 8.5, cy: 10, r: 1.3 }),
                h('path', { d: 'M3.6 16.8l4.4-4.4 3 3 3.4-3.4 5 5' }))
        }

        function GalleryPanel() {
            const [items, setItems] = React.useState([])
            const [albums, setAlbums] = React.useState([])
            const [root, setRoot] = React.useState('')
            const [album, setAlbum] = React.useState('')
            const [selected, setSelected] = React.useState(() => new Set())
            const [zoom, setZoom] = React.useState(-1)
            const [editing, setEditing] = React.useState(null)
            const [newAlbum, setNewAlbum] = React.useState('')
            const [target, setTarget] = React.useState('')
            const [status, setStatus] = React.useState('')
            const [error, setError] = React.useState('')
            const [busy, setBusy] = React.useState('')

            const load = async (nextAlbum) => {
                try {
                    const data = await callJson(`/library/list?album=${encodeURIComponent(nextAlbum || '')}`)
                    if (!data || !data.ok) {
                        setError((data && data.message) || '读不到图库')
                        return
                    }
                    setItems(data.items || [])
                    setAlbums(data.albums || [])
                    setRoot(data.root || '')
                    setError(data.exists === false ? '保存目录还不存在：生成第一张图时会自动建出来。' : '')
                } catch (e) {
                    setError(`读不到图库：${(e && e.message) || e}`)
                }
            }

            React.useEffect(() => { void load(album) }, [album])

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

            const post = (path, payload) => callJson(path, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload || {}),
            })

            const toggle = (rel) => setSelected((previous) => {
                const next = new Set(previous)
                if (next.has(rel)) next.delete(rel)
                else next.add(rel)
                return next
            })
            const clear = () => setSelected(new Set())
            const chosen = [...selected]

            const remove = () => run('delete', async () => {
                if (chosen.length === 0) return
                const ok = typeof window.confirm === 'function'
                    && window.confirm(`把选中的 ${chosen.length} 张图放进废纸篓？\n
它们会进系统的废纸篓 / 回收站，还能捞回来。`)
                if (!ok) return
                const result = await post('/library/delete', { rels: chosen })
                setStatus(result.message || (result.ok ? '已删除。' : '删除失败。'))
                if (result.ok !== false) {
                    clear()
                    setZoom(-1)
                    await load(album)
                }
            })

            const moveTo = () => run('move', async () => {
                if (chosen.length === 0) return
                const result = await post('/library/move', { rels: chosen, album: target })
                setStatus(result.message || (result.ok ? '已移动。' : '移动失败。'))
                if (result.ok) {
                    clear()
                    await load(album)
                }
            })

            const makeAlbum = () => run('album', async () => {
                const name = newAlbum.trim()
                if (name === '') return
                const result = await post('/library/album', { name })
                setStatus(result.message || (result.ok ? '已建相册。' : '建相册失败。'))
                if (result.ok) {
                    setNewAlbum('')
                    await load(album)
                }
            })

            const startEdit = (item) => {
                if (!item || !item.meta || !item.meta.prompt) {
                    setStatus('这张图没有记录提示词（旧图或手动放进来的），没法改图。')
                    return
                }
                setEditing({ rel: item.rel, prompt: item.meta.prompt, seed: item.meta.seed, size: item.meta.size })
            }

            const regenerate = () => run('regen', async () => {
                if (!editing) return
                const prompt = editing.prompt.trim()
                if (prompt === '') { setStatus('提示词不能为空。'); return }
                const result = await post('/library/regenerate', { rel: editing.rel, prompt })
                setStatus(result.message || (result.ok ? '已重画。' : '重画失败。'))
                if (result.ok) {
                    setEditing(null)
                    setZoom(-1)
                    // 新图落在保存目录根：跳回去才能看见它。
                    if (album !== '') setAlbum('')
                    else await load('')
                }
            })

            const thumbUrl = (item) => `${BASE}/library/file?rel=${encodeURIComponent(item.rel)}`
            const current = zoom >= 0 && zoom < items.length ? items[zoom] : null

            return h('div', { style: G.panel, 'data-dsh-moss-gallery': '' },
                h('div', { style: G.bar },
                    h('span', { style: { fontWeight: 600, marginRight: 4 } }, 'Moss 图库'),
                    h('select', {
                        value: album,
                        onChange: (e) => { clear(); setZoom(-1); setAlbum(e.target.value) },
                        style: { ...S.input, flex: '0 1 200px', minWidth: 130 },
                    },
                        h('option', { value: '' }, '根目录'),
                        albums.map((entry) => h('option', { key: entry.name, value: entry.name }, `${entry.name}（${entry.count}）`))),
                    h('button', { type: 'button', style: S.btn, onClick: () => run('load', () => load(album)), disabled: busy === 'load' }, busy === 'load' ? '刷新中…' : '刷新')),

                h('div', { style: { ...G.bar, borderBottom: 'none' } },
                    h('button', { type: 'button', style: S.btn, onClick: () => setSelected(new Set(items.map((item) => item.rel))) }, '全选'),
                    h('button', { type: 'button', style: S.btn, onClick: clear, disabled: chosen.length === 0 }, `取消选择${chosen.length > 0 ? `（${chosen.length}）` : ''}`),
                    h('select', {
                        value: target,
                        onChange: (e) => setTarget(e.target.value),
                        style: { ...S.input, flex: '0 1 180px', minWidth: 120 },
                    },
                        h('option', { value: '' }, '移到根目录'),
                        albums.map((entry) => h('option', { key: entry.name, value: entry.name }, `移到「${entry.name}」`))),
                    h('button', { type: 'button', style: S.btn, onClick: moveTo, disabled: chosen.length === 0 || busy === 'move' }, busy === 'move' ? '移动中…' : '移动'),
                    h('button', { type: 'button', style: S.btn, onClick: remove, disabled: chosen.length === 0 || busy === 'delete' }, busy === 'delete' ? '删除中…' : `删除选中${chosen.length > 0 ? `（${chosen.length}）` : ''}`),
                    h('span', { style: { flex: '1 1 auto' } }),
                    h('input', {
                        type: 'text',
                        value: newAlbum,
                        placeholder: '新相册名',
                        onChange: (e) => setNewAlbum(e.target.value),
                        style: { ...S.input, flex: '0 1 140px', minWidth: 100 },
                    }),
                    h('button', { type: 'button', style: S.btn, onClick: makeAlbum, disabled: busy === 'album' || newAlbum.trim() === '' }, '建相册')),

                h('div', { style: G.body },
                    items.length === 0
                        ? h('div', { style: G.empty }, album === '' ? '这里还没有图。让 DeepSeek 画一张，点刷新就能看见。' : '这个相册还是空的。')
                        : h('div', { style: G.grid }, items.map((item, index) => h('div', {
                            key: item.rel,
                            style: G.card(selected.has(item.rel)),
                            onClick: () => setZoom(index),
                        },
                            h('img', { src: thumbUrl(item), alt: item.name, loading: 'lazy', style: G.thumb }),
                            h('input', {
                                type: 'checkbox',
                                checked: selected.has(item.rel),
                                onClick: (event) => event.stopPropagation(),
                                onChange: () => toggle(item.rel),
                                style: { position: 'absolute', top: 8, left: 8, cursor: 'pointer' },
                            }),
                            h('div', { style: G.name, title: item.rel }, item.name)))),

                    root === '' ? null : h('p', { style: { ...S.hint, marginTop: 12 } }, '保存目录：', h('span', { style: S.code }, root)),
                    status === '' ? null : h('p', { style: S.status }, status),
                    error === '' ? null : h('p', { style: { ...S.status, opacity: 0.9 } }, error)),

                current === null ? null : h('div', { style: G.overlay, onClick: () => setZoom(-1) },
                    h('div', {
                        style: { display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', maxWidth: '92vw' },
                        onClick: (event) => event.stopPropagation(),
                    },
                        h('img', { src: thumbUrl(current), alt: current.name, style: G.zoom }),
                        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' } },
                            h('button', { type: 'button', style: { ...S.btn, color: '#eee', borderColor: 'rgba(255,255,255,0.35)' }, onClick: () => setZoom(Math.max(0, zoom - 1)) }, '上一张'),
                            h('button', { type: 'button', style: { ...S.btn, color: '#eee', borderColor: 'rgba(255,255,255,0.35)' }, onClick: () => setZoom(Math.min(items.length - 1, zoom + 1)) }, '下一张'),
                            h('button', { type: 'button', style: { ...S.btn, color: '#eee', borderColor: 'rgba(255,255,255,0.35)' }, onClick: () => startEdit(current) }, '改图'),
                            h('button', { type: 'button', style: { ...S.btn, color: '#eee', borderColor: 'rgba(255,255,255,0.35)' }, onClick: () => toggle(current.rel) }, selected.has(current.rel) ? '取消选择' : '选中'),
                            h('button', { type: 'button', style: { ...S.btn, color: '#eee', borderColor: 'rgba(255,255,255,0.35)' }, onClick: () => setZoom(-1) }, '关闭')),
                        h('div', { style: { color: 'rgba(255,255,255,0.7)', fontSize: 12, maxWidth: 760, textAlign: 'center' } },
                            `${current.rel} · ${current.meta && current.meta.prompt ? current.meta.prompt : '（没有提示词记录）'}`))),

                editing === null ? null : h('div', { style: G.overlay, onClick: () => setEditing(null) },
                    h('div', { style: G.dialog, onClick: (event) => event.stopPropagation() },
                        h('p', { style: { ...S.cardTitle, color: '#eee' } }, '改图'),
                        h('p', { style: { opacity: 0.7, fontSize: 12, margin: '0 0 10px' } },
                            `沿用原种子 ${editing.seed === undefined ? '?' : editing.seed} 与尺寸 ${editing.size || '?'} 重画，构图不会大跳。会真的调用接口计费一次。`),
                        h('textarea', {
                            value: editing.prompt,
                            rows: 8,
                            onChange: (e) => setEditing({ ...editing, prompt: e.target.value }),
                            style: { ...S.area, width: '100%', minWidth: 0, color: '#eee', borderColor: 'rgba(255,255,255,0.3)' },
                        }),
                        h('div', { style: { ...S.row, marginTop: 12 } },
                            h('button', { type: 'button', style: { ...S.btn, color: '#eee', borderColor: 'rgba(255,255,255,0.35)' }, onClick: regenerate, disabled: busy === 'regen' }, busy === 'regen' ? '重画中…' : '重画'),
                            h('button', { type: 'button', style: { ...S.btn, color: '#eee', borderColor: 'rgba(255,255,255,0.35)' }, onClick: () => setEditing(null) }, '取消'))))
            )
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
                // 设置侧栏里自己一节，不再挤在「插件」标签里。
                try {
                    ctx.slots.inject('settings.section', () => ctx.slots.register(
                        { name: 'settings.section', id: 'dsh-moss-image', order: 45, label: 'Moss 生图' },
                        SettingsTab,
                    ))
                } catch (e) {
                    console.warn('[dsh-moss-image] settings section disabled:', e)
                }
                // 侧栏入口 + 同名主面板：点侧栏那一项就打开图库。
                try {
                    ctx.slots.inject('main', () => ctx.slots.inject('sidebar.panellist', () => {
                        const stopMain = ctx.slots.register({ name: 'main', key: 'moss-gallery' }, GalleryPanel)
                        const stopIcon = ctx.slots.register(
                            { name: 'sidebar.panellist', id: 'moss-gallery', order: 42, label: 'Moss 图库' },
                            GalleryIcon,
                        )
                        return () => {
                            try { if (typeof stopIcon === 'function') stopIcon() } catch {}
                            try { if (typeof stopMain === 'function') stopMain() } catch {}
                        }
                    }))
                } catch (e) {
                    console.warn('[dsh-moss-image] gallery panel disabled:', e)
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