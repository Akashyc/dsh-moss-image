// dsh-moss-image · 图库的文件与元数据层。
// 文件系统是真相：相册就是保存目录下的一层子文件夹；library.json 只补文件系统给不出的东西（提示词、参数）。
// 这里不碰 DSH 服务、不联网，单测能直接跑。
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, relative, resolve, sep } from 'node:path'

export const LIBRARY_FILE = 'library.json'
const NAME_MAX = 60

/** 相册名：一层子目录，不能有分隔符、控制字符、前导点。 */
export function albumNameProblem(name) {
    const value = typeof name === 'string' ? name.trim() : ''
    if (value === '') return '相册名不能为空'
    if (value.startsWith('.')) return '相册名不能以点开头'
    if (/[\\/:*?"<>|\u0000-\u001f]/u.test(value)) return '相册名不能含路径分隔符或特殊字符'
    if (value.length > NAME_MAX) return `相册名太长（最多 ${NAME_MAX} 字）`
    return ''
}

/**
 * 校验「相册/文件名」这种相对路径：只接受保存目录内、一层的 .png。
 * 路径穿越、绝对路径、多余层级都在这里拦掉。
 */
export function relProblem(rel) {
    if (typeof rel !== 'string') return '路径不对'
    const value = rel.trim().replace(/\\/gu, '/')
    if (value === '') return '路径不能为空'
    if (value.startsWith('/') || /^[a-z]:/iu.test(value)) return '只接受保存目录里的相对路径'
    const parts = value.split('/')
    if (parts.some((part) => part === '' || part === '.' || part === '..')) return '路径里有不允许的片段'
    if (parts.length > 2) return '相册只有一层，路径最多「相册/文件名」'
    if (!/\.png$/iu.test(value)) return '只处理 PNG'
    if (parts.length === 2) {
        const problem = albumNameProblem(parts[0])
        if (problem) return problem
    }
    return ''
}

/** 相对路径 → 绝对路径（调用前先过 relProblem）。 */
export function absOf(root, rel) {
    return resolve(root, rel.trim().replace(/\\/gu, '/'))
}

/**
 * 出图前再确认一次真实路径在保存目录里：符号链接指到外面的，一律不认。
 * 返回绝对路径或抛错。
 */
export async function safeFile(root, rel) {
    const problem = relProblem(rel)
    if (problem) throw new Error(problem)
    const rootReal = await realpath(root)
    const target = await realpath(absOf(root, rel))
    const inside = target === rootReal || target.startsWith(`${rootReal}${sep}`)
    if (!inside) throw new Error('这个文件不在保存目录里')
    const info = await stat(target)
    if (!info.isFile()) throw new Error('不是文件')
    return { path: target, size: info.size, mtimeMs: info.mtimeMs }
}

/** 元数据读写走一条串行队列：同一进程里不会两边同时写坏 library.json。 */
let queue = Promise.resolve()
function serial(task) {
    const next = queue.then(task, task)
    queue = next.catch(() => {})
    return next
}

export async function readLibrary(root) {
    try {
        const parsed = JSON.parse(await readFile(join(root, LIBRARY_FILE), 'utf8'))
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

async function writeLibrary(root, data) {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, LIBRARY_FILE), `${JSON.stringify(data, null, 2)}\n`)
}

/** 记一张图的元数据；已存在就覆盖（移动/重画时用）。 */
export function patchEntry(root, rel, meta) {
    return serial(async () => {
        const data = await readLibrary(root)
        data[rel] = { ...(data[rel] ?? {}), ...meta }
        await writeLibrary(root, data)
        return data[rel]
    })
}

/** 批量删元数据（删除文件、搬走旧路径时用）。 */
export function dropEntries(root, rels) {
    return serial(async () => {
        const data = await readLibrary(root)
        for (const rel of rels) delete data[rel]
        await writeLibrary(root, data)
    })
}

/** 搬文件时把元数据跟着改键。 */
export function moveEntries(root, pairs) {
    return serial(async () => {
        const data = await readLibrary(root)
        for (const [from, to] of pairs) {
            if (data[from] === undefined) continue
            data[to] = data[from]
            delete data[from]
        }
        await writeLibrary(root, data)
    })
}

const isPng = (name) => /\.png$/iu.test(name)
const isHidden = (name) => name.startsWith('.')

/** 列目录：相册（一层子目录）+ 当前相册里的图。相册为空就是根目录。 */
export async function listLibrary(root, album = '') {
    const where = album === '' ? root : join(root, album)
    let entries
    try {
        entries = await readdir(root, { withFileTypes: true })
    } catch (error) {
        if (error?.code === 'ENOENT') return { ok: true, exists: false, albums: [], items: [] }
        throw error
    }
    const meta = await readLibrary(root)
    const albums = []
    for (const entry of entries) {
        if (!entry.isDirectory() || isHidden(entry.name)) continue
        const files = await readdir(join(root, entry.name)).catch(() => [])
        albums.push({ name: entry.name, count: files.filter(isPng).length })
    }
    albums.sort((a, b) => a.name.localeCompare(b.name, 'zh'))

    let files = []
    if (album === '') {
        files = entries.filter((entry) => entry.isFile() && isPng(entry.name)).map((entry) => entry.name)
    } else {
        const names = await readdir(where).catch(() => [])
        files = names.filter(isPng)
    }
    const items = []
    for (const name of files) {
        const rel = album === '' ? name : `${album}/${name}`
        const info = await stat(join(where, name)).catch(() => undefined)
        if (!info?.isFile()) continue
        items.push({
            rel,
            name,
            album,
            size: info.size,
            mtime: info.mtimeMs,
            meta: meta[rel],
        })
    }
    items.sort((a, b) => b.mtime - a.mtime)
    return { ok: true, exists: true, albums, items }
}

/** 建相册目录；重名直接报错，不做静默合并。 */
export async function createAlbum(root, name) {
    const problem = albumNameProblem(name)
    if (problem) throw new Error(problem)
    const dir = join(root, name.trim())
    try {
        await mkdir(dir)
    } catch (error) {
        if (error?.code === 'EEXIST') throw new Error('已经有同名相册了')
        throw error
    }
    return name.trim()
}

/** 目标名被占了就加 -2/-3，绝不覆盖已有文件。 */
async function freeName(dir, name) {
    const stem = name.replace(/\.png$/iu, '')
    for (let n = 1; ; n += 1) {
        const candidate = n === 1 ? name : `${stem}-${n}.png`
        try {
            await stat(join(dir, candidate))
        } catch {
            return join(dir, candidate)
        }
    }
}

/** 把图挪进相册（album 为空 = 根目录）；跨盘走复制再删。 */
export async function moveFiles(root, rels, album) {
    const problem = album === '' ? '' : albumNameProblem(album)
    if (problem) throw new Error(problem)
    const targetDir = album === '' ? root : join(root, album)
    await mkdir(targetDir, { recursive: true })
    const moved = []
    const pairs = []
    for (const rel of rels) {
        const from = rel.trim().replace(/\\/gu, '/')
        const bad = relProblem(from)
        if (bad) throw new Error(`${from}：${bad}`)
        const source = absOf(root, from)
        const parked = await freeName(targetDir, basename(source))
        try {
            await rename(source, parked)
        } catch (error) {
            if (error?.code !== 'EXDEV') throw error
            await copyFile(source, parked)
            await unlink(source)
        }
        const to = `${album === '' ? '' : `${album}/`}${basename(parked)}`
        moved.push(to)
        pairs.push([from, to])
    }
    await moveEntries(root, pairs)
    return moved
}

/**
 * 送进系统废纸篓 / 回收站；送不进去就报错，绝不硬删。
 * mac 走 ~/.Trash；Windows 走 PowerShell 的回收站 API；Linux 先试 gio trash。
 */
export async function trashFile(file) {
    if (process.platform === 'win32') {
        const escaped = file.replace(/'/gu, "''")
        const script = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin')`
        const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' })
        if (result.status !== 0) throw new Error('回收站不可用（PowerShell 调用失败）')
        return
    }
    if (process.platform === 'linux') {
        const result = spawnSync('gio', ['trash', file], { stdio: 'ignore' })
        if (result.status === 0) return
    }
    const home = homedir()
    const bin = process.platform === 'darwin'
        ? join(home, '.Trash')
        : join(home, '.local', 'share', 'Trash', 'files')
    await mkdir(bin, { recursive: true })
    const target = await freeName(bin, basename(file))
    try {
        await rename(file, target)
    } catch (error) {
        if (error?.code !== 'EXDEV') throw error
        await copyFile(file, target)
        await unlink(file)
    }
}

/** 批量删除：一张失败不影响其它，返回失败清单。 */
export async function trashEntries(root, rels) {
    const removed = []
    const failed = []
    for (const rel of rels) {
        const from = rel.trim().replace(/\\/gu, '/')
        const bad = relProblem(from)
        if (bad) {
            failed.push({ rel: from, message: bad })
            continue
        }
        try {
            await trashFile(absOf(root, from))
            removed.push(from)
        } catch (error) {
            failed.push({ rel: from, message: error?.message ?? String(error) })
        }
    }
    if (removed.length > 0) await dropEntries(root, removed)
    return { removed, failed }
}

/** 元数据里没用的键顺手清掉：文件已经不在了的条目留着只会越长越大。 */
export async function pruneLibrary(root) {
    const data = await readLibrary(root)
    const stale = []
    for (const rel of Object.keys(data)) {
        try {
            await stat(absOf(root, rel))
        } catch {
            stale.push(rel)
        }
    }
    if (stale.length > 0) await dropEntries(root, stale)
    return stale.length
}

/** 元数据里的相对路径统一用 /，Windows 也存得可读。 */
export function relOf(root, file) {
    return relative(root, file).split(sep).join('/')
}
