#!/usr/bin/env node
// dsh-moss-image 安装器。默认只打印计划，加 --apply 才动文件。
// 跨平台：不写死路径，DSH_HOME 走环境变量或 os.homedir()。
//
//   node install.mjs                      # 干跑，只报告要改什么
//   node install.mjs --apply              # 真装（改 profile 的 package.json + 建软链）
//   node install.mjs --profile desktop    # 指定 profile 名（默认 desktop）
//   node install.mjs --uninstall --apply  # 卸掉
import { readFile, writeFile, mkdir, symlink, lstat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = 'dsh-moss-image'
const HERE = dirname(fileURLToPath(import.meta.url))

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const valueOf = (flag, fallback) => {
    const index = argv.indexOf(flag)
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}

const apply = has('--apply')
const uninstall = has('--uninstall')
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileName = valueOf('--profile', 'desktop')
const profileDir = join(dshHome, 'profiles', profileName)
const manifestPath = join(profileDir, 'package.json')

function log(line = '') {
    console.log(line)
}

async function exists(path) {
    try {
        await lstat(path)
        return true
    } catch {
        return false
    }
}

let manifest
try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
} catch (error) {
    console.error(`读不到 profile 的 package.json：${manifestPath}`)
    console.error(String(error?.message ?? error))
    process.exit(1)
}

const deps = manifest.dependencies ?? (manifest.dependencies = {})
const bundles = manifest.dsh?.profile?.bundles ?? []

log(`profile：${profileDir}`)
log(`包路径：${HERE}`)

if (uninstall) {
    log()
    log('将要做（卸载）：')
    log(`  - 从 dependencies 删掉 ${PKG}`)
    log(`  - 从 dsh.profile.bundles 删掉 ${PKG}`)
    log(`  - 删掉 node_modules/${PKG}`)
    if (!apply) {
        log()
        log('这是干跑。确认无误后加 --apply 执行。')
        process.exit(0)
    }
    delete deps[PKG]
    if (manifest.dsh?.profile?.bundles) {
        manifest.dsh.profile.bundles = bundles.filter((name) => name !== PKG)
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const linkPath = join(profileDir, 'node_modules', PKG)
    if (await exists(linkPath)) await unlink(linkPath)
    log('已卸载。重启 dsh 生效。')
    process.exit(0)
}

const linkPath = join(profileDir, 'node_modules', PKG)
const depSpec = `file:${resolve(HERE)}`

log()
log('将要做（安装）：')
if (deps[PKG] !== depSpec) log(`  - dependencies["${PKG}"] = "${depSpec}"`)
if (!bundles.includes(PKG)) log(`  - dsh.profile.bundles 追加 "${PKG}"`)
if (!(await exists(linkPath))) log(`  - 建立软链 node_modules/${PKG} → ${resolve(HERE)}`)
log()
log('注意：本脚本不会自动备份 package.json。要备份的话先自己复制一份。')

if (!apply) {
    log()
    log('这是干跑。确认无误后加 --apply 执行，然后重启 dsh。')
    process.exit(0)
}

deps[PKG] = depSpec
if (manifest.dsh?.profile?.bundles && !bundles.includes(PKG)) {
    manifest.dsh.profile.bundles.push(PKG)
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

if (!(await exists(linkPath))) {
    await mkdir(dirname(linkPath), { recursive: true })
    await symlink(resolve(HERE), linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

log('装好了。重启 dsh 之后：设置 → 插件 里会出现「Moss 生图」页。')
