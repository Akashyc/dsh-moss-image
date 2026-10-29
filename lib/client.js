// dsh-moss-image · client 半边。
// 只做两件事：设置页里一个「Moss 生图」小面板（填密钥、测连通、试一张），
// 以及输入框左侧一个「生图」按钮（把提示词模板塞进草稿）。
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
            wrap: { padding: 4, maxWidth: 720, fontSize: 13, lineHeight: 1.6, color: 'inherit' },
            hint: { margin: '0 0 10px', opacity: 0.65, fontSize: 12 },
            card: { border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12, marginBottom: 12 },
            row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
            label: { minWidth: 76, opacity: 0.8 },
            input: {
                flex: 1, minWidth: 200, padding: '5px 8px', borderRadius: 6,
                border: `1px solid ${BORDER}`, background: 'transparent', color: 'inherit', font: 'inherit',
            },
            btn: {
                padding: '5px 12px', borderRadius: 6, border: `1px solid ${BORDER}`,
                background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer',
            },
            code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, opacity: 0.85 },
            status: { minHeight: 20, fontSize: 12, opacity: 0.8 },
        }

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
            const [keyValue, setKeyValue] = React.useState('')
            const [status, setStatus] = React.useState('')
            const [busy, setBusy] = React.useState('')
            const [size, setSize] = React.useState('')
            const [preview, setPreview] = React.useState('')
            const [error, setError] = React.useState('')

            const refresh = React.useCallback(async () => {
                try {
                    const next = await callJson('/state')
                    setState(next)
                    if (!size && next.size) setSize(next.size)
                } catch (e) {
                    setError(`读不到插件状态：${e && e.message}`)
                }
            }, [size])

            React.useEffect(() => { void refresh() }, [refresh])

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

            const saveKey = () => run('save', async () => {
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

            const clearKey = () => run('clear', async () => {
                const result = await callJson('/key', { method: 'DELETE' })
                setStatus(result.ok ? '已清除。' : `清除失败：${result.message}`)
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
                    body: JSON.stringify({ size: size || undefined }),
                })
                if (result.ok) {
                    setStatus(`✓ 成功，耗时 ${(result.elapsedMs / 1000).toFixed(1)}s；已存到 ${result.path}`)
                    setPreview(result.url)
                } else {
                    setStatus(`✗ ${result.message}`)
                }
            })

            if (error !== '' && state === null) return h('div', { style: S.wrap }, h('p', { style: S.hint }, error))

            const configured = Boolean(state && state.configured)
            const sizes = (state && state.sizes) || []
            const models = (state && state.models) || []

            return h('div', { style: S.wrap, 'data-dsh-moss-image': '' },
                h('p', { style: S.hint },
                    '密钥只写进 dsh 的凭据服务，不进配置文件、不回显。其余参数在「设置 → 插件 → dsh-moss-image」里改。'),

                h('div', { style: S.card },
                    h('div', { style: { ...S.row, marginBottom: 6 } },
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
                        h('button', { type: 'button', style: S.btn, onClick: saveKey, disabled: busy === 'save' }, busy === 'save' ? '保存中…' : '保存'),
                        h('button', { type: 'button', style: S.btn, onClick: clearKey, disabled: !configured || busy === 'clear' }, '清除')),
                    h('div', { style: { ...S.hint, margin: '8px 0 0' } },
                        '凭据键名：', h('span', { style: S.code }, (state && state.credentialKey) || 'MOSS_API_KEY'),
                        ' · 接口：', h('span', { style: S.code }, (state && state.baseUrl) || '')),

                    h('div', { style: { ...S.row, marginTop: 10 } },
                        h('button', { type: 'button', style: S.btn, onClick: probe, disabled: !configured || busy === 'probe' },
                            busy === 'probe' ? '测试中…' : '测试连接'),
                        h('span', { style: { opacity: 0.6, fontSize: 12 } }, '只查模型列表，不产生生图费用'))),

                h('div', { style: S.card },
                    h('div', { style: { ...S.row, marginBottom: 6 } },
                        h('span', { style: S.label }, '试生成'),
                        h('select', {
                            value: size,
                            onChange: (e) => setSize(e.target.value),
                            style: { ...S.input, flex: '0 0 auto', minWidth: 140 },
                        }, sizes.map((s) => h('option', { key: s, value: s }, s)))),
                    h('div', { style: S.row },
                        h('button', { type: 'button', style: S.btn, onClick: tryOne, disabled: !configured || busy === 'try' },
                            busy === 'try' ? '生成中（可能要几十秒）…' : '生成一张测试图'),
                        h('span', { style: { opacity: 0.6, fontSize: 12 } }, '会真的调用接口并计费，一次一张')),
                    preview === '' ? null : h('div', { style: { marginTop: 10 } },
                        h('img', { src: preview, alt: '测试生成的图片', style: { maxWidth: '100%', borderRadius: 6 } }))),

                h('p', { style: S.status }, status),

                h('div', { style: { ...S.hint, marginTop: 4 } },
                    '当前模型：', h('span', { style: S.code }, (state && state.model) || '—'),
                    ' · 尺寸：', h('span', { style: S.code }, (state && state.size) || '—'),
                    ' · 落盘：', h('span', { style: S.code }, (state && state.saveToWorkspace) ? (state.imagesDir || 'images') : '关闭'),
                    ' · 可选模型：', h('span', { style: S.code }, models.length > 0 ? models.join(' / ') : '—')))
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
