// dsh-moss-image · 图库的文件与元数据层。
// 文件系统是真相：相册就是保存目录下的一层子文件夹；library.json 只补文件系统给不出的东西（提示词、参数）。
// 这里不碰 DSH 服务、不联网，单测能直接跑。
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readdir, readFile, realpath, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
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

const EMPTY_LIBRARY = () => ({ version: 2, files: {}, albums: {} })

/**
 * 读 library.json。v1 是平铺的 { rel: meta }，v2 是 { version: 2, files, albums }；
 * 读到 v1 就当场按 v2 的形状用，下次写入自然升上去（不需要单独的迁移步骤）。
 */
export async function readLibrary(root) {
    try {
        const parsed = JSON.parse(await readFile(join(root, LIBRARY_FILE), 'utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_LIBRARY()
        if (parsed.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files)) {
            return {
                version: 2,
                files: parsed.files,
                albums: parsed.albums && typeof parsed.albums === 'object' ? parsed.albums : {},
            }
        }
        return { version: 2, files: parsed, albums: {} }
    } catch {
        return EMPTY_LIBRARY()
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
        data.files[rel] = { ...(data.files[rel] ?? {}), ...meta }
        await writeLibrary(root, data)
        return data.files[rel]
    })
}

/** 批量删元数据；顺带清掉指向这些文件的相册封面（否则封面会指到不存在的图）。 */
export function dropEntries(root, rels) {
    return serial(async () => {
        const data = await readLibrary(root)
        const gone = new Set(rels)
        for (const rel of gone) delete data.files[rel]
        for (const [name, album] of Object.entries(data.albums)) {
            if (album && typeof album.cover === 'string' && gone.has(album.cover)) {
                delete album.cover
                if (Object.keys(album).length === 0) delete data.albums[name]
            }
        }
        await writeLibrary(root, data)
    })
}

/** 搬文件时把元数据和相册封面一起跟着改键。 */
export function moveEntries(root, pairs) {
    return serial(async () => {
        const data = await readLibrary(root)
        const map = new Map(pairs)
        for (const [from, to] of pairs) {
            if (data.files[from] === undefined) continue
            data.files[to] = data.files[from]
            delete data.files[from]
        }
        for (const album of Object.values(data.albums)) {
            if (album && typeof album.cover === 'string' && map.has(album.cover)) album.cover = map.get(album.cover)
        }
        await writeLibrary(root, data)
    })
}

const isPng = (name) => /\.png$/iu.test(name)
const isHidden = (name) => name.startsWith('.')

/** 一个相册里都有什么：png 数量、总大小、最新一张（没有指定封面时拿它顶）。 */
async function scanAlbum(root, name, savedAlbum) {
    const dir = join(root, name)
    const listings = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const pngs = []
    let size = 0
    for (const entry of listings) {
        if (!entry.isFile() || !isPng(entry.name)) continue
        const info = await stat(join(dir, entry.name)).catch(() => undefined)
        if (!info?.isFile()) continue
        pngs.push({ name: entry.name, mtime: info.mtimeMs })
        size += info.size
    }
    pngs.sort((a, b) => b.mtime - a.mtime)
    const saved = savedAlbum && typeof savedAlbum.cover === 'string' ? savedAlbum.cover : ''
    // 显式封面必须还在这个相册里；图被移走/删掉就自动回退到最新一张。
    const explicit = saved.startsWith(`${name}/`) && pngs.some((png) => `${name}/${png.name}` === saved) ? saved : ''
    const cover = explicit || (pngs.length > 0 ? `${name}/${pngs[0].name}` : '')
    return { name, count: pngs.length, size, coverRel: cover, coverPinned: explicit !== '' }
}

/** 列目录：相册（一层子目录）+ 当前相册里的图。相册为空就是根目录。 */
export async function listLibrary(root, album = '') {
    const where = album === '' ? root : join(root, album)
    let entries
    try {
        entries = await readdir(root, { withFileTypes: true })
    } catch (error) {
        if (error?.code === 'ENOENT') return { ok: true, exists: false, albums: [], items: [], totalSize: 0 }
        throw error
    }
    const data = await readLibrary(root)
    const albums = []
    if (album === '') {
        for (const entry of entries) {
            if (!entry.isDirectory() || isHidden(entry.name)) continue
            albums.push(await scanAlbum(root, entry.name, data.albums[entry.name]))
        }
        albums.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    }

    let names = []
    if (album === '') {
        names = entries.filter((entry) => entry.isFile() && isPng(entry.name)).map((entry) => entry.name)
    } else {
        names = (await readdir(where).catch(() => [])).filter(isPng)
    }
    const items = []
    for (const name of names) {
        const rel = album === '' ? name : `${album}/${name}`
        const info = await stat(join(where, name)).catch(() => undefined)
        if (!info?.isFile()) continue
        items.push({ kind: 'image', rel, name, album, size: info.size, mtime: info.mtimeMs, meta: data.files[rel] })
    }
    items.sort((a, b) => b.mtime - a.mtime)

    const totalSize = items.reduce((sum, item) => sum + item.size, 0) + albums.reduce((sum, entry) => sum + entry.size, 0)
    return { ok: true, exists: true, albums, items, totalSize }
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

/** 相册目录是否存在。 */
async function albumExists(root, name) {
    try {
        const info = await stat(join(root, name))
        return info.isDirectory()
    } catch {
        return false
    }
}

/** 相册改名：目录改名，同时把元数据键和所有指向里面的封面一起改前缀。 */
export async function renameAlbum(root, name, to) {
    const from = typeof name === 'string' ? name.trim() : ''
    const target = typeof to === 'string' ? to.trim() : ''
    if (from === target) return from
    const bad = albumNameProblem(from) || albumNameProblem(target)
    if (bad) throw new Error(bad)
    if (!(await albumExists(root, from))) throw new Error(`找不到相册「${from}」`)
    if (await albumExists(root, target)) throw new Error('已经有同名相册了')
    await rename(join(root, from), join(root, target))
    try {
        await serial(async () => {
            const data = await readLibrary(root)
            const prefix = `${from}/`
            for (const [rel, meta] of Object.entries(data.files)) {
                if (!rel.startsWith(prefix)) continue
                data.files[`${target}/${rel.slice(prefix.length)}`] = meta
                delete data.files[rel]
            }
            const saved = data.albums[from]
            delete data.albums[from]
            if (saved !== undefined) data.albums[target] = saved
            for (const album of Object.values(data.albums)) {
                if (album && typeof album.cover === 'string' && album.cover.startsWith(prefix)) {
                    album.cover = `${target}/${album.cover.slice(prefix.length)}`
                }
            }
            await writeLibrary(root, data)
        })
    } catch (error) {
        // 目录已经改了、元数据没写进去：改回去，别留一半。
        await rename(join(root, target), join(root, from)).catch(() => {})
        throw error
    }
    return target
}

/**
 * 删相册。withFiles=true 时里面的图进废纸篓；否则先把图挪回根目录。
 * 目录里还有非 png 的东西就不删，返回清单让调用方去说清楚。
 */
export async function deleteAlbum(root, name, withFiles) {
    const album = typeof name === 'string' ? name.trim() : ''
    const bad = albumNameProblem(album)
    if (bad) throw new Error(bad)
    if (!(await albumExists(root, album))) throw new Error(`找不到相册「${album}」`)

    const dir = join(root, album)
    const listings = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const pngs = listings.filter((entry) => entry.isFile() && isPng(entry.name)).map((entry) => `${album}/${entry.name}`)
    const leftover = listings.filter((entry) => !(entry.isFile() && isPng(entry.name))).map((entry) => entry.name)

    const result = { album, withFiles: Boolean(withFiles), removed: [], movedToRoot: [], failed: [], leftover }
    if (withFiles) {
        const trashed = await trashEntries(root, pngs)
        result.removed = trashed.removed
        result.failed = trashed.failed
        if (result.failed.length > 0) return result
    } else {
        result.movedToRoot = pngs.length > 0 ? await moveFiles(root, pngs, '') : []
    }
    if (leftover.length > 0) return result

    await serial(async () => {
        const data = await readLibrary(root)
        delete data.albums[album]
        await writeLibrary(root, data)
    })
    await rmdir(dir).catch(() => {})
    result.ok = true
    return result
}

/** 指定相册封面；rel 为空 = 撤掉指定，回到「最新一张」。 */
export async function setAlbumCover(root, album, rel) {
    const name = typeof album === 'string' ? album.trim() : ''
    const bad = albumNameProblem(name)
    if (bad) throw new Error(bad)
    if (!(await albumExists(root, name))) throw new Error(`找不到相册「${name}」`)
    const wanted = typeof rel === 'string' ? rel.trim().replace(/\\/gu, '/') : ''
    if (wanted !== '') {
        if (!wanted.startsWith(`${name}/`)) throw new Error('封面必须是这个相册里的图')
        const problem = relProblem(wanted)
        if (problem) throw new Error(problem)
        const info = await stat(absOf(root, wanted)).catch(() => undefined)
        if (!info?.isFile()) throw new Error('这张图不在相册里了')
    }
    return serial(async () => {
        const data = await readLibrary(root)
        const saved = { ...(data.albums[name] ?? {}) }
        if (wanted === '') delete saved.cover
        else saved.cover = wanted
        if (Object.keys(saved).length === 0) delete data.albums[name]
        else data.albums[name] = saved
        await writeLibrary(root, data)
        return wanted
    })
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
    for (const rel of Object.keys(data.files)) {
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
