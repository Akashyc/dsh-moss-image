// client 半边的冒烟检查：不渲染真实界面，只确保工厂能装、槽位能注册、组件能渲染不炸。
// 起因：重写图库时把侧栏图标函数删了，注册代码还引用它 —— 运行时 ReferenceError，侧栏入口直接消失。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

function loadClient() {
    const source = readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
    return source
}

function fakeReact() {
    const h = (type, props, ...children) => ({ type, props: { ...(props || {}), children: children.length > 1 ? children : children[0] } })
    const React = {
        createElement: h,
        useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
        useCallback: (fn) => fn,
        useEffect: () => {},
        useRef: (initial) => ({ current: initial === undefined ? null : initial }),
        useMemo: (fn) => fn(),
    }
    return { React, h }
}

test('client.js 能装载、槽位能注册、图标和面板能渲染', async () => {
    const source = await loadClient()
    let half
    const { React } = fakeReact()
    const window = {
        __ModuleLoader__: { load: (descriptor) => { half = descriptor } },
        confirm: () => false,
        addEventListener: () => {},
        removeEventListener: () => {},
        innerWidth: 1200,
        innerHeight: 800,
    }
    const require = (name) => {
        if (name === 'react') return React
        throw new Error(`未预期的依赖：${name}`)
    }
    // client.js 是浏览器脚本（不是 ESM），用 Function 装到假 window 上跑
    new Function('window', 'require', 'fetch', 'console', source)(window, require, async () => ({ text: async () => '{}' }), { warn: () => {}, log: () => {}, error: () => {} })

    assert.ok(half, '工厂没有被 __ModuleLoader__ 收到')
    assert.equal(half.id, 'dsh-moss-image')
    const factoryOut = half.factory(require)
    assert.equal(factoryOut.name, 'dsh-moss-image-client')

    const registered = []
    const ctx = {
        slots: {
            inject: (_key, callback) => callback(),
            register: (definition, component) => {
                registered.push({ definition, component })
                return () => {}
            },
        },
    }
    factoryOut.apply(ctx)

    const ids = registered.map((entry) => `${entry.definition.name}:${entry.definition.id || entry.definition.key || ''}`)
    assert.ok(ids.includes('settings.section:dsh-moss-image'), `设置分区没注册：${ids.join(', ')}`)
    assert.ok(ids.includes('sidebar.panellist:moss-gallery'), `侧栏入口没注册：${ids.join(', ')}`)
    assert.ok(ids.includes('main:moss-gallery'), `主面板没注册：${ids.join(', ')}`)
    assert.ok(ids.includes('conversation.input.left:dsh-moss-image'), `输入框按钮没注册：${ids.join(', ')}`)

    // 每个组件都真的调用一次：注册时引用了不存在的函数，这里就会 ReferenceError
    for (const entry of registered) {
        assert.equal(typeof entry.component, 'function', `${entry.definition.name} 的组件不是函数`)
        assert.doesNotThrow(() => entry.component({ size: 18 }), `${entry.definition.name} 渲染时抛错`)
    }
})
