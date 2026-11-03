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

        // ── 图库：侧栏一个入口，主面板当文件夹用（相册是文件夹，图是文件）
        // 性能红线：同屏带 backdrop-filter 的元素 ≤ 3（工具条、右键菜单、浮层）。
        // 磁贴一律不做毛玻璃，几十个磁贴各拖一次背景模糊会直接卡成幻灯片。
        const GLASS_CSS = `
            .mg-root { --mg-line: rgba(127,127,127,0.28); --mg-tint: rgba(99,160,255,0.16); --mg-ink: inherit; }
            .mg-glass {
                background: rgba(127,127,127,0.10);
                -webkit-backdrop-filter: blur(20px) saturate(180%);
                backdrop-filter: blur(20px) saturate(180%);
                box-shadow: inset 0 1px 0 rgba(255,255,255,0.28), 0 8px 24px rgba(0,0,0,0.14);
            }
            .mg-tile {
                transition: transform 120ms cubic-bezier(.2,.8,.2,1), box-shadow 160ms ease, border-color 140ms ease, background 140ms ease;
            }
            .mg-tile:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.16); }
            .mg-tile:active { transform: scale(0.986); }
            .mg-btn { transition: background 120ms ease, transform 100ms ease, border-color 120ms ease; }
            .mg-btn:hover { background: rgba(127,127,127,0.14); }
            .mg-btn:active { transform: scale(0.97); }
            .mg-btn:disabled { opacity: 0.45; cursor: default; transform: none; }
            .mg-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
            .mg-scroll::-webkit-scrollbar-thumb { background: rgba(127,127,127,0.35); border-radius: 6px; border: 2px solid transparent; background-clip: content-box; }
            .mg-scroll::-webkit-scrollbar-track { background: transparent; }
            .mg-input { outline: none; }
            .mg-input:focus { border-color: rgba(99,160,255,0.75); box-shadow: 0 0 0 3px rgba(99,160,255,0.18); }
            .mg-toast { animation: mg-toast-in 150ms cubic-bezier(.2,.8,.2,1); }
            @keyframes mg-toast-in { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
            @media (prefers-reduced-motion: reduce) { .mg-tile, .mg-btn { transition: none; } .mg-toast { animation: none; } }
        `

        function fmtBytes(bytes) {
            if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
            const units = ['B', 'KB', 'MB', 'GB']
            let value = bytes
            let unit = 0
            while (value >= 1024 && unit < units.length - 1) {
                value /= 1024
                unit += 1
            }
            return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
        }

        function FolderGlyph(props) {
            const size = props && props.size ? props.size : 16
            return h('svg', {
                width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
                stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
                'aria-hidden': 'true', style: props && props.style,
            },
                h('path', { d: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5z' }))
        }

        /** 侧栏图标：注册时就要存在（缺了会让整块注册被 catch 吞掉、入口直接消失）。 */
        function GalleryIcon(props) {
            const size = props && props.size ? props.size : 18
            return h('svg', {
                width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
                stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
                'aria-hidden': 'true',
            },
                h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2.5 }),
                h('circle', { cx: 8.6, cy: 10, r: 1.3 }),
                h('path', { d: 'M3.6 16.8l4.4-4.4 3 3 3.4-3.4 5 5' }))
        }

        /** 图库接口都得同源 + 只碰保存目录；这里只负责把请求发出去。 */
        const lib = {
            list: (album) => callJson(`/library/list?album=${encodeURIComponent(album || '')}`),
            post: (path, payload) => callJson(`/library${path}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload || {}),
            }),
        }

        function GalleryPanel() {
            const [album, setAlbum] = React.useState('')
            const [albums, setAlbums] = React.useState([])
            const [items, setItems] = React.useState([])
            const [root, setRoot] = React.useState('')
            const [totalSize, setTotalSize] = React.useState(0)
            const [selected, setSelected] = React.useState(() => new Set())
            const [anchorKey, setAnchorKey] = React.useState('')
            const [sortKey, setSortKey] = React.useState('mtime')
            const [sortDir, setSortDir] = React.useState(-1)
            const [viewerRel, setViewerRel] = React.useState('')
            const [menu, setMenu] = React.useState(null)
            const [menuAlbums, setMenuAlbums] = React.useState(false)
            const [renaming, setRenaming] = React.useState(null)
            const [creating, setCreating] = React.useState(null)
            const [dropping, setDropping] = React.useState(null)
            const [editing, setEditing] = React.useState(null)
            const [marquee, setMarquee] = React.useState(null)
            const [status, setStatus] = React.useState('')
            const [error, setError] = React.useState('')
            const [busy, setBusy] = React.useState('')
            const panelRef = React.useRef(null)

            const load = React.useCallback(async (nextAlbum) => {
                try {
                    const data = await lib.list(nextAlbum)
                    if (!data || !data.ok) {
                        setError((data && data.message) || '读不到图库')
                        return
                    }
                    setAlbums(data.albums || [])
                    setItems(data.items || [])
                    setRoot(data.root || '')
                    setTotalSize(data.totalSize || 0)
                    setError(data.exists === false ? '保存目录还不存在：生成第一张图时会自动建出来。' : '')
                } catch (e) {
                    setError(`读不到图库：${(e && e.message) || e}`)
                }
            }, [])

            React.useEffect(() => { void load(album) }, [album, load])

            // 提示不留在页面里：几秒后自己淡出，免得挤在网格里看着像内容
            React.useEffect(() => {
                if (status === '' && error === '') return undefined
                const timer = setTimeout(() => {
                    setStatus('')
                    setError('')
                }, error === '' ? 3600 : 5500)
                return () => clearTimeout(timer)
            }, [status, error])

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

            const refresh = (nextAlbum) => load(nextAlbum === undefined ? album : nextAlbum)
            const clearSelection = () => setSelected(new Set())
            const goTo = (next) => {
                clearSelection()
                setViewerRel('')
                setMenu(null)
                setAlbum(next)
            }

            // 列表：相册永远排在图片前面（资源管理器的规矩），再按当前排序排图片
            const folders = albums.map((entry) => ({
                key: `album:${entry.name}`,
                kind: 'album',
                name: entry.name,
                count: entry.count,
                size: entry.size,
                coverRel: entry.coverRel,
                coverPinned: entry.coverPinned,
            }))
            const files = items.map((entry) => ({ key: `image:${entry.rel}`, kind: 'image', ...entry }))
            const pick = (a, b) => {
                const dir = sortDir < 0 ? -1 : 1
                if (sortKey === 'name') return dir * String(a.name).localeCompare(String(b.name), 'zh')
                if (sortKey === 'size') return dir * (a.size - b.size)
                return dir * ((a.mtime || 0) - (b.mtime || 0))
            }
            const sortedFolders = [...folders].sort(pick)
            const sortedFiles = [...files].sort(pick)
            const entries = [...sortedFolders, ...sortedFiles]
            const selectedKeys = [...selected]
            const selectedFiles = sortedFiles.filter((entry) => selected.has(entry.key))
            const selectedFolders = sortedFolders.filter((entry) => selected.has(entry.key))
            const viewerIndex = sortedFiles.findIndex((entry) => entry.rel === viewerRel)
            const viewer = viewerIndex >= 0 ? sortedFiles[viewerIndex] : null
            const fileUrl = (rel) => `${BASE}/library/file?rel=${encodeURIComponent(rel)}`

            const toggleKey = (key) => setSelected((previous) => {
                const next = new Set(previous)
                if (next.has(key)) next.delete(key)
                else next.add(key)
                return next
            })

            const onEntryClick = (event, entry) => {
                event.stopPropagation()
                setMenu(null)
                if (event.shiftKey && anchorKey !== '') {
                    const from = entries.findIndex((item) => item.key === anchorKey)
                    const to = entries.findIndex((item) => item.key === entry.key)
                    if (from >= 0 && to >= 0) {
                        const [lo, hi] = from < to ? [from, to] : [to, from]
                        const next = new Set(event.metaKey || event.ctrlKey ? selected : [])
                        for (const item of entries.slice(lo, hi + 1)) next.add(item.key)
                        setSelected(next)
                        return
                    }
                }
                if (event.metaKey || event.ctrlKey) toggleKey(entry.key)
                else setSelected(new Set([entry.key]))
                setAnchorKey(entry.key)
            }

            const onEntryDouble = (entry) => {
                if (entry.kind === 'album') goTo(entry.name)
                else setViewerRel(entry.rel)
            }

            const onBackgroundContext = (event) => {
                if (event.target !== event.currentTarget) return
                event.preventDefault()
                setMenuAlbums(false)
                clearSelection()
                setMenu({ x: event.clientX, y: event.clientY, kind: 'blank', albums: sortedFolders.map((entry) => entry.name) })
            }

            const onEntryContext = (event, entry) => {
                event.preventDefault()
                event.stopPropagation()
                if (!selected.has(entry.key)) setSelected(new Set([entry.key]))
                setMenuAlbums(false)
                setMenu({
                    x: event.clientX,
                    y: event.clientY,
                    kind: entry.kind,
                    entry,
                    albums: sortedFolders.map((item) => item.name),
                })
            }

            // 框选：只在空白处起手，命中用磁贴的 rect 求交；Ctrl/Cmd 拖是追加
            const onBackgroundMouseDown = (event) => {
                if (event.button !== 0) return
                const onBackground = event.target === event.currentTarget || event.target.getAttribute('data-mg-bg') !== null
                if (!onBackground) return
                setMenu(null)
                const startX = event.clientX
                const startY = event.clientY
                const additive = event.metaKey || event.ctrlKey
                const base = additive ? new Set(selected) : new Set()
                if (!additive) setSelected(new Set())
                setMarquee({ x: startX, y: startY, w: 0, h: 0 })
                const move = (moveEvent) => {
                    const x1 = Math.min(startX, moveEvent.clientX)
                    const y1 = Math.min(startY, moveEvent.clientY)
                    const x2 = Math.max(startX, moveEvent.clientX)
                    const y2 = Math.max(startY, moveEvent.clientY)
                    setMarquee({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
                    const next = new Set(base)
                    const node = panelRef.current
                    if (!node) return
                    for (const tile of node.querySelectorAll('[data-mg-key]')) {
                        const rect = tile.getBoundingClientRect()
                        const hit = rect.left < x2 && rect.right > x1 && rect.top < y2 && rect.bottom > y1
                        if (hit) next.add(tile.getAttribute('data-mg-key'))
                    }
                    setSelected(next)
                }
                const up = () => {
                    window.removeEventListener('mousemove', move)
                    window.removeEventListener('mouseup', up)
                    setMarquee(null)
                }
                window.addEventListener('mousemove', move)
                window.addEventListener('mouseup', up)
            }

            const removeFiles = () => run('delete', async () => {
                if (selectedFiles.length === 0) return
                const ok = typeof window.confirm === 'function'
                    && window.confirm(`把选中的 ${selectedFiles.length} 张图放进废纸篓？\n\n它们会进系统的废纸篓 / 回收站，还能捞回来。`)
                if (!ok) return
                const result = await lib.post('/delete', { rels: selectedFiles.map((entry) => entry.rel) })
                setStatus(result.message || (result.ok ? '已删除。' : '删除失败。'))
                if (result.ok !== false) {
                    clearSelection()
                    setViewerRel('')
                    await refresh()
                }
            })

            const moveSelected = (target) => run('move', async () => {
                const rels = selectedFiles.map((entry) => entry.rel)
                if (rels.length === 0) return
                const result = await lib.post('/move', { rels, album: target || '' })
                setStatus(result.message || (result.ok ? '已移动。' : '移动失败。'))
                if (result.ok) {
                    clearSelection()
                    await refresh()
                }
            })

            const openMenuMove = (pointer) => { void pointer; setMenuAlbums(true) }

            const startCreate = () => {
                setMenu(null)
                setCreating({ value: '' })
            }

            const commitCreate = async () => {
                if (creating === null) return
                const name = creating.value.trim()
                if (name === '') { setCreating(null); return }
                await run('album', async () => {
                    const result = await lib.post('/album', { name })
                    setStatus(result.message || (result.ok ? '已建相册。' : '建相册失败。'))
                    if (result.ok) {
                        setCreating(null)
                        await refresh()
                    }
                })
            }

            const commitRename = async () => {
                if (renaming === null) return
                const to = renaming.value.trim()
                if (to === '' || to === renaming.name) { setRenaming(null); return }
                await run('rename', async () => {
                    const result = await lib.post('/album/rename', { name: renaming.name, to })
                    setStatus(result.message || (result.ok ? '已改名。' : '改名失败。'))
                    if (result.ok) {
                        const follow = album === renaming.name ? to : album
                        setRenaming(null)
                        if (follow !== album) goTo(follow)
                        else await refresh()
                    }
                })
            }

            const confirmDeleteAlbum = (name, count) => {
                setMenu(null)
                setDropping({ name, count })
            }

            const deleteAlbum = (withFiles) => run('drop', async () => {
                if (dropping === null) return
                const result = await lib.post('/album/delete', { name: dropping.name, withFiles })
                setStatus(result.message || (result.ok ? '相册已删除。' : '删相册失败。'))
                if (result.ok) {
                    setDropping(null)
                    if (album === dropping.name) goTo('')
                    else await refresh()
                } else if (result.leftover && result.leftover.length > 0) {
                    setDropping(null)
                }
            })

            const setCover = (rel) => run('cover', async () => {
                const owner = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
                if (owner === '') { setStatus('这张图不在相册里，没法当封面。'); return }
                const result = await lib.post('/album/cover', { name: owner, rel })
                setStatus(result.message || (result.ok ? '已设为封面。' : '设封面失败。'))
                if (result.ok) await refresh()
            })

            const startEdit = (rel) => {
                const target = sortedFiles.find((entry) => entry.rel === rel)
                if (!target || !target.meta || !target.meta.prompt) {
                    setStatus('这张图没有记录提示词（旧图或手动放进来的），没法改图。')
                    return
                }
                setEditing({ rel, seed: target.meta.seed, size: target.meta.size, prompt: target.meta.prompt })
            }

            const regenerate = () => run('regen', async () => {
                if (editing === null) return
                const prompt = editing.prompt.trim()
                if (prompt === '') { setStatus('提示词不能为空。'); return }
                const result = await lib.post('/regenerate', { rel: editing.rel, prompt })
                setStatus(result.message || (result.ok ? '已重画。' : '重画失败。'))
                if (result.ok) {
                    setEditing(null)
                    setViewerRel('')
                    if (album !== '') goTo('')
                    else await refresh()
                }
            })

            // 键盘：只在没有焦点在输入框里时接管
            React.useEffect(() => {
                const onKeyDown = (event) => {
                    const tag = event.target && event.target.tagName ? event.target.tagName : ''
                    if (tag === 'INPUT' || tag === 'TEXTAREA' || (event.target && event.target.isContentEditable)) return
                    const meta = event.metaKey || event.ctrlKey
                    if (meta && event.key.toLowerCase() === 'a') {
                        event.preventDefault()
                        setSelected(new Set(entries.map((entry) => entry.key)))
                        return
                    }
                    if (event.key === 'Escape') {
                        if (menu !== null) setMenu(null)
                        else if (viewerRel !== '') setViewerRel('')
                        else clearSelection()
                        return
                    }
                    if (event.key === 'Delete' || event.key === 'Backspace') {
                        if (selectedFiles.length > 0 && !meta) {
                            event.preventDefault()
                            void removeFiles()
                            return
                        }
                    }
                    if (event.key === 'Enter') {
                        const first = entries.find((entry) => selected.has(entry.key))
                        if (first) {
                            event.preventDefault()
                            onEntryDouble(first)
                        }
                        return
                    }
                    if ((event.altKey && event.key === 'ArrowUp') || (event.key === 'Backspace' && selected.size === 0)) {
                        event.preventDefault()
                        if (album !== '') goTo('')
                        return
                    }
                    if (viewerRel !== '') {
                        if (event.key === 'ArrowLeft') setViewerRel(sortedFiles[Math.max(0, viewerIndex - 1)]?.rel || viewerRel)
                        if (event.key === 'ArrowRight') setViewerRel(sortedFiles[Math.min(sortedFiles.length - 1, viewerIndex + 1)]?.rel || viewerRel)
                    }
                }
                window.addEventListener('keydown', onKeyDown)
                return () => window.removeEventListener('keydown', onKeyDown)
            })

            const crumbs = [{ label: 'Moss 图库', album: '' }].concat(album === '' ? [] : [{ label: album, album }])
            const canDeleteSelection = selectedFiles.length > 0 && selectedFolders.length === 0

            const menuStyle = menu === null ? null : {
                position: 'fixed',
                left: Math.min(menu.x, Math.max(8, (window.innerWidth || 1200) - 244)),
                top: Math.min(menu.y, Math.max(8, (window.innerHeight || 800) - 260)),
                minWidth: 210,
                zIndex: 10001,
                borderRadius: 12,
                border: '1px solid var(--mg-line)',
                padding: 6,
                color: 'inherit',
                fontSize: 13,
            }

            const menuItem = (label, onClick, disabled, hint) => h('div', {
                key: label,
                role: 'button',
                onClick: disabled ? undefined : onClick,
                style: {
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                    padding: '6px 10px', borderRadius: 8, cursor: disabled ? 'default' : 'pointer',
                    opacity: disabled ? 0.4 : 1,
                },
                onMouseEnter: (event) => {
                    if (!disabled) event.currentTarget.style.background = 'rgba(127,127,127,0.16)'
                },
                onMouseLeave: (event) => { event.currentTarget.style.background = 'transparent' },
            }, h('span', null, label), hint ? h('span', { style: { opacity: 0.55, fontSize: 11 } }, hint) : null)

            const divider = h('div', { style: { height: 1, margin: '4px 6px', background: 'var(--mg-line)' } })

            const tile = (entry) => {
                const isSelected = selected.has(entry.key)
                const folder = entry.kind === 'album'
                const renamingThis = renaming !== null && renaming.name === entry.name && folder
                return h('div', {
                    key: entry.key,
                    'data-mg-key': entry.key,
                    className: 'mg-tile',
                    style: {
                        position: 'relative', borderRadius: 10, overflow: 'hidden', cursor: 'default',
                        border: `1px solid ${isSelected ? 'rgba(99,160,255,0.9)' : 'var(--mg-line)'}`,
                        background: isSelected ? 'var(--mg-tint)' : 'rgba(127,127,127,0.05)',
                    },
                    onClick: (event) => onEntryClick(event, entry),
                    onDoubleClick: () => onEntryDouble(entry),
                    onContextMenu: (event) => onEntryContext(event, entry),
                },
                    h('div', {
                        style: {
                            position: 'relative', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', overflow: 'hidden', background: 'rgba(127,127,127,0.08)',
                        },
                    },
                        folder
                            ? (entry.coverRel
                                ? h('img', {
                                    src: fileUrl(entry.coverRel), alt: entry.name, loading: 'lazy',
                                    draggable: false,
                                    style: { width: '100%', height: '100%', objectFit: 'cover', opacity: 0.92 },
                                })
                                : h(FolderGlyph, { size: 34, style: { opacity: 0.45 } }))
                            : h('img', {
                                src: fileUrl(entry.rel), alt: entry.name, loading: 'lazy', draggable: false,
                                style: { width: '100%', height: '100%', objectFit: 'cover' },
                            }),
                        folder
                            ? h('span', {
                                style: {
                                    position: 'absolute', left: 6, bottom: 6, display: 'inline-flex', alignItems: 'center', gap: 4,
                                    padding: '2px 7px 2px 5px', borderRadius: 999, fontSize: 11,
                                    background: 'rgba(0,0,0,0.55)', color: '#fff',
                                },
                            }, h(FolderGlyph, { size: 12 }), entry.count)
                            : null),
                    h('div', {
                        style: { padding: '6px 8px', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
                        title: folder ? entry.name : entry.rel,
                    },
                        renamingThis
                            ? h('input', {
                                autoFocus: true,
                                className: 'mg-input',
                                value: renaming.value,
                                onChange: (event) => setRenaming({ ...renaming, value: event.target.value }),
                                onBlur: () => { void commitRename() },
                                onKeyDown: (event) => {
                                    event.stopPropagation()
                                    if (event.key === 'Enter') void commitRename()
                                    if (event.key === 'Escape') setRenaming(null)
                                },
                                onClick: (event) => event.stopPropagation(),
                                onDoubleClick: (event) => event.stopPropagation(),
                                style: {
                                    width: '100%', boxSizing: 'border-box', padding: '2px 6px', borderRadius: 6,
                                    border: '1px solid rgba(99,160,255,0.8)', background: 'transparent',
                                    color: 'inherit', font: 'inherit',
                                },
                            })
                            : (folder ? entry.name : entry.name)),
                    isSelected
                        ? h('span', {
                            style: {
                                position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 999,
                                background: 'rgba(99,160,255,0.95)', color: '#fff', fontSize: 11,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            },
                        }, '✓')
                        : null)
            }

            const creatingTile = creating === null ? null : h('div', {
                key: 'mg-creating',
                style: {
                    borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(99,160,255,0.85)',
                    background: 'rgba(99,160,255,0.10)',
                },
            },
                h('div', {
                    style: {
                        aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(127,127,127,0.08)',
                    },
                }, h(FolderGlyph, { size: 34, style: { opacity: 0.6 } })),
                h('div', { style: { padding: '6px 8px' } }, h('input', {
                    autoFocus: true,
                    className: 'mg-input',
                    placeholder: '新相册名',
                    value: creating.value,
                    onChange: (event) => setCreating({ value: event.target.value }),
                    onBlur: () => { void commitCreate() },
                    onKeyDown: (event) => {
                        event.stopPropagation()
                        if (event.key === 'Enter') void commitCreate()
                        if (event.key === 'Escape') setCreating(null)
                    },
                    style: {
                        width: '100%', boxSizing: 'border-box', padding: '2px 6px', borderRadius: 6,
                        border: '1px solid rgba(99,160,255,0.8)', background: 'transparent',
                        color: 'inherit', font: 'inherit',
                    },
                })))

            const emptyHint = entries.length === 0 && creating === null
                ? h('div', { style: { padding: '56px 0', textAlign: 'center', opacity: 0.6, fontSize: 13 } },
                    album === ''
                        ? '这里还没有东西。让 DeepSeek 画一张；右键空白处也能新建相册。'
                        : '这个相册还是空的。把图移动进来试试。')
                : null

            const statusText = album === ''
                ? `${entries.length} 个项目（${folders.length} 个相册）· 选中 ${selectedKeys.length} 个 · 共 ${fmtBytes(totalSize)}`
                : `${entries.length} 张图 · 选中 ${selectedKeys.length} 个 · 共 ${fmtBytes(totalSize)}`

            return h('div', {
                className: 'mg-root',
                ref: panelRef,
                style: { position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontSize: 13, color: 'inherit' },
            },
                h('style', null, GLASS_CSS),

                // ── 工具条（玻璃）
                h('div', {
                    className: 'mg-glass',
                    style: {
                        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                        padding: '9px 14px', borderBottom: '1px solid var(--mg-line)',
                        position: 'relative', zIndex: 2,
                    },
                },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 120 } },
                        crumbs.map((crumb, index) => h('span', { key: crumb.label + index, style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
                            index > 0 ? h('span', { style: { opacity: 0.4 } }, '›') : null,
                            index === crumbs.length - 1
                                ? h('span', { style: { fontWeight: 600 } }, crumb.label)
                                : h('span', {
                                    role: 'button',
                                    onClick: () => goTo(crumb.album),
                                    style: { cursor: 'pointer', opacity: 0.75, textDecoration: 'underline', textUnderlineOffset: 3 },
                                }, crumb.label)))),
                    album === ''
                        ? null
                        : h('button', {
                            type: 'button', className: 'mg-btn', onClick: () => goTo(''),
                            style: { ...S.btn, padding: '3px 9px' }, title: 'Backspace 也能返回',
                        }, '↑ 上一级'),
                    h('span', { style: { width: 1, height: 18, background: 'var(--mg-line)', margin: '0 2px' } }),
                    h('button', {
                        type: 'button', className: 'mg-btn', onClick: removeFiles,
                        disabled: !canDeleteSelection || busy === 'delete',
                        title: selectedFolders.length > 0 ? '相册请右键删除' : 'Delete',
                        style: { ...S.btn, padding: '3px 10px', fontSize: 12 },
                    }, busy === 'delete' ? '删除中…' : `删除${selectedFiles.length > 0 ? ` ${selectedFiles.length}` : ''}`),
                    h('button', {
                        type: 'button', className: 'mg-btn', onClick: startCreate,
                        style: { ...S.btn, padding: '3px 10px', fontSize: 12 },
                    }, '新建相册'),
                    h('span', { style: { flex: '1 1 auto' } }),
                    h('span', { style: { opacity: 0.6, fontSize: 12 } }, '排序'),
                    h('select', {
                        value: `${sortKey}:${sortDir < 0 ? 'desc' : 'asc'}`,
                        onChange: (event) => {
                            const [key, dir] = event.target.value.split(':')
                            setSortKey(key)
                            setSortDir(dir === 'asc' ? 1 : -1)
                        },
                        style: { ...S.input, flex: '0 0 auto', minWidth: 132, fontSize: 12, padding: '3px 6px' },
                    },
                        h('option', { value: 'mtime:desc' }, '修改时间 ↓'),
                        h('option', { value: 'mtime:asc' }, '修改时间 ↑'),
                        h('option', { value: 'name:asc' }, '名称 A→Z'),
                        h('option', { value: 'name:desc' }, '名称 Z→A'),
                        h('option', { value: 'size:desc' }, '大小 ↓'),
                        h('option', { value: 'size:asc' }, '大小 ↑')),
                    h('button', {
                        type: 'button', className: 'mg-btn',
                        onClick: () => run('load', () => refresh()),
                        disabled: busy === 'load',
                        style: { ...S.btn, padding: '3px 10px' },
                    }, busy === 'load' ? '刷新中…' : '刷新')),

                // ── 内容区
                h('div', {
                    className: 'mg-scroll',
                    onMouseDown: onBackgroundMouseDown,
                    onContextMenu: onBackgroundContext,
                    onClick: (event) => {
                        if (event.target === event.currentTarget || event.target.getAttribute('data-mg-bg') !== null) clearSelection()
                    },
                    style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, position: 'relative' },
                },
                    emptyHint,
                    h('div', {
                        'data-mg-bg': '',
                        style: {
                            display: 'grid', gap: 12,
                            gridTemplateColumns: 'repeat(auto-fill, minmax(158px, 1fr))',
                        },
                    }, creatingTile, ...entries.map(tile))),

                // ── 状态栏（玻璃）
                h('div', {
                    className: 'mg-glass',
                    style: {
                        display: 'flex', gap: 8, alignItems: 'center',
                        padding: '6px 14px', borderTop: '1px solid var(--mg-line)', fontSize: 12, opacity: 0.85,
                        minWidth: 0,
                    },
                },
                    h('span', { style: { flex: '0 0 auto' } }, statusText),
                    root === ''
                        ? null
                        : h('span', {
                            style: {
                                flex: '1 1 auto', minWidth: 0, overflow: 'hidden',
                                textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.72,
                            },
                            title: root,
                        }, '· 保存目录 ', h('span', { style: S.code }, root))),

                // ── 提示浮层：贴在状态栏上方，自动消失
                status === '' && error === '' ? null : h('div', {
                    className: 'mg-toast mg-glass',
                    style: {
                        position: 'absolute', left: '50%', bottom: 44, transform: 'translate(-50%, 0)',
                        padding: '8px 14px', borderRadius: 10, border: '1px solid var(--mg-line)',
                        fontSize: 12, maxWidth: 'min(560px, 86%)', textAlign: 'center',
                        zIndex: 10000, pointerEvents: 'none', color: 'inherit',
                    },
                }, error === '' ? status : error),

                // ── 框选框
                marquee === null ? null : h('div', {
                    style: {
                        position: 'fixed', left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h,
                        border: '1px solid rgba(99,160,255,0.9)', background: 'rgba(99,160,255,0.14)',
                        borderRadius: 4, pointerEvents: 'none', zIndex: 10000,
                    },
                }),

                // ── 右键菜单
                menu === null ? null : h('div', null,
                    h('div', {
                        style: { position: 'fixed', inset: 0, zIndex: 10000 },
                        onClick: () => setMenu(null),
                        onContextMenu: (event) => { event.preventDefault(); setMenu(null) },
                    }),
                    h('div', { className: 'mg-glass', style: menuStyle, onClick: (event) => event.stopPropagation() },
                        menu.kind === 'blank'
                            ? menuItem('新建相册', startCreate)
                            : null,
                        menu.kind === 'album'
                            ? [
                                menuItem('打开', () => { setMenu(null); goTo(menu.entry.name) }),
                                menuItem('重命名', () => { setMenu(null); setRenaming({ name: menu.entry.name, value: menu.entry.name }) }),
                                divider,
                                menuItem('删除相册…', () => confirmDeleteAlbum(menu.entry.name, menu.entry.count), false, `${menu.entry.count} 张`),
                            ]
                            : null,
                        menu.kind === 'image'
                            ? [
                                menuItem('打开', () => { setMenu(null); setViewerRel(menu.entry.rel) }),
                                menuItem('改图…', () => { setMenu(null); startEdit(menu.entry.rel) }, !(menu.entry.meta && menu.entry.meta.prompt), '需要提示词'),
                                menuItem('设为相册封面', () => { setMenu(null); void setCover(menu.entry.rel) }, !menu.entry.rel.includes('/')),
                                menuAlbums
                                    ? null
                                    : menuItem('移到相册 ▸', () => openMenuMove()),
                                menuAlbums
                                    ? [
                                        divider,
                                        menuItem('移回根目录', () => { setMenu(null); void moveSelected('') }, album === ''),
                                        ...menu.albums
                                            .filter((name) => name !== album)
                                            .map((name) => menuItem(`→ ${name}`, () => { setMenu(null); void moveSelected(name) })),
                                    ]
                                    : null,
                                divider,
                                menuItem('删除', () => { setMenu(null); void removeFiles() }, false, '进废纸篓'),
                            ]
                            : null,
                        menu.kind !== 'image' ? null : null)),

                // ── 大图查看器
                viewer === null ? null : h('div', {
                    style: {
                        position: 'fixed', inset: 0, zIndex: 10002, background: 'rgba(0,0,0,0.72)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
                    },
                    onClick: () => setViewerRel(''),
                },
                    h('div', {
                        style: { display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', maxWidth: '92vw' },
                        onClick: (event) => event.stopPropagation(),
                    },
                        h('img', {
                            src: fileUrl(viewer.rel), alt: viewer.name,
                            style: { maxWidth: '90vw', maxHeight: '76vh', borderRadius: 10, background: '#111' },
                        }),
                        h('div', { className: 'mg-glass', style: { display: 'flex', gap: 8, padding: 8, borderRadius: 12, flexWrap: 'wrap', justifyContent: 'center' } },
                            h('button', { type: 'button', className: 'mg-btn', style: S.btn, onClick: () => setViewerRel(sortedFiles[Math.max(0, viewerIndex - 1)].rel) }, '上一张'),
                            h('button', { type: 'button', className: 'mg-btn', style: S.btn, onClick: () => setViewerRel(sortedFiles[Math.min(sortedFiles.length - 1, viewerIndex + 1)].rel) }, '下一张'),
                            h('button', { type: 'button', className: 'mg-btn', style: S.btn, onClick: () => startEdit(viewer.rel), disabled: !(viewer.meta && viewer.meta.prompt) }, '改图'),
                            h('button', { type: 'button', className: 'mg-btn', style: S.btn, onClick: () => void setCover(viewer.rel), disabled: !viewer.rel.includes('/') }, '设为封面'),
                            h('button', { type: 'button', className: 'mg-btn', style: S.btn, onClick: () => setViewerRel('') }, '关闭')),
                        h('div', { style: { color: 'rgba(255,255,255,0.72)', fontSize: 12, maxWidth: 760, textAlign: 'center' } },
                            `${viewer.rel} · ${viewer.meta && viewer.meta.prompt ? viewer.meta.prompt : '（没有提示词记录）'}`))),

                // ── 删相册确认（三选一）
                dropping === null ? null : h('div', {
                    style: {
                        position: 'fixed', inset: 0, zIndex: 10003, background: 'rgba(0,0,0,0.6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
                    },
                    onClick: () => setDropping(null),
                },
                    h('div', {
                        className: 'mg-glass',
                        style: { width: 'min(520px, 92vw)', borderRadius: 14, padding: 18, color: 'inherit' },
                        onClick: (event) => event.stopPropagation(),
                    },
                        h('p', { style: { ...S.cardTitle, marginBottom: 8 } }, `删除相册「${dropping.name}」`),
                        h('p', { style: { ...S.hint, marginBottom: 14 } },
                            `这个相册里有 ${dropping.count} 张图。你想怎么删？`),
                        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                            h('button', {
                                type: 'button', className: 'mg-btn', style: { ...S.btn, textAlign: 'left' },
                                onClick: () => deleteAlbum(false), disabled: busy === 'drop',
                            }, `仅删除相册（${dropping.count} 张图移回根目录）`),
                            h('button', {
                                type: 'button', className: 'mg-btn', style: { ...S.btn, textAlign: 'left' },
                                onClick: () => {
                                    const ok = typeof window.confirm === 'function'
                                        && window.confirm(`连同 ${dropping.count} 张图一起删？\n\n图会进系统废纸篓，还能捞回来。`)
                                    if (ok) void deleteAlbum(true)
                                },
                                disabled: busy === 'drop',
                            }, `相册和 ${dropping.count} 张图一起删（进废纸篓）`),
                            h('button', { type: 'button', className: 'mg-btn', style: { ...S.btn, textAlign: 'left' }, onClick: () => setDropping(null) }, '取消')))),

                // ── 改图
                editing === null ? null : h('div', {
                    style: {
                        position: 'fixed', inset: 0, zIndex: 10003, background: 'rgba(0,0,0,0.6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
                    },
                    onClick: () => setEditing(null),
                },
                    h('div', {
                        className: 'mg-glass',
                        style: { width: 'min(600px, 94vw)', borderRadius: 14, padding: 16, color: 'inherit' },
                        onClick: (event) => event.stopPropagation(),
                    },
                        h('p', { style: { ...S.cardTitle, marginBottom: 8 } }, '改图'),
                        h('p', { style: { ...S.hint, marginBottom: 10 } },
                            `沿用原种子 ${editing.seed === undefined ? '?' : editing.seed} 与尺寸 ${editing.size || '?'} 重画，构图不会大跳。会真的调用接口计费一次。`),
                        h('textarea', {
                            value: editing.prompt, rows: 8,
                            className: 'mg-input',
                            onChange: (event) => setEditing({ ...editing, prompt: event.target.value }),
                            style: { ...S.area, width: '100%', minWidth: 0 },
                        }),
                        h('div', { style: { ...S.row, marginTop: 12 } },
                            h('button', { type: 'button', className: 'mg-btn', style: S.btn, onClick: regenerate, disabled: busy === 'regen' },
                                busy === 'regen' ? '重画中…' : '重画'),
                            h('button', { type: 'button', className: 'mg-btn', style: S.btn, onClick: () => setEditing(null) }, '取消'))))
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