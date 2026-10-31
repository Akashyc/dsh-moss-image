#!/usr/bin/env node
// dsh-moss-image 安装器。默认只打印计划，加 --apply 才动文件。
// 跨平台：不写死路径，DSH_HOME 走环境变量或 os.homedir()。
//
//   node install.mjs                                  # 干跑（默认从 GitHub 装）
//   node install.mjs --apply                          # 真装
//   node install.mjs --from local --apply             # 从本地目录装（开发时用）
//   node install.mjs --profile desktop                # 指定 profile 名（默认 desktop）
//   node install.mjs --pnpm /path/to/pnpm             # 指定 pnpm（默认找 PATH）
//   node install.mjs --uninstall --apply              # 卸掉
import { readFile, writeFile, mkdir, symlink, lstat, unlink, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = 'dsh-moss-image'
const GITHUB_SPEC = 'github:Akashyc/dsh-moss-image'
const HERE = dirname(fileURLToPath(import.meta.url))

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const valueOf = (flag, fallback) => {
    const index = argv.indexOf(flag)
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}

const apply = has('--apply')
const uninstall = has('--uninstall')
const from = valueOf('--from', 'github')
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileName = valueOf('--profile', 'desktop')
const profileDir = join(dshHome, 'profiles', profileName)
const manifestPath = join(profileDir, 'package.json')
const pnpmBin = valueOf('--pnpm', process.env.DSH_PNPM ?? 'pnpm')
const depSpec = from === 'local' ? `file:${resolve(HERE)}` : GITHUB_SPEC

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

function runPnpm(args = ['install']) {
    log(`  $ ${pnpmBin} ${args.join(' ')}  (cwd: ${profileDir})`)
    const result = spawnSync(pnpmBin, args, {
        cwd: profileDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    })
    if (result.error) {
        console.error(`\npnpm 跑不起来：${result.error.message}`)
        console.error('用 --pnpm /path/to/pnpm 指定，或手动在 profile 目录执行 pnpm install。')
        return false
    }
    if (result.status !== 0) {
        console.error(`\npnpm ${args.join(' ')} 退出码 ${result.status}。`)
        return false
    }
    return true
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
log(`安装来源：${depSpec}`)

if (uninstall) {
    log()
    log('将要做（卸载）：')
    log(`  - 从 dependencies 删掉 ${PKG}`)
    log(`  - 从 dsh.profile.bundles 删掉 ${PKG}`)
    log('  - 跑一次 pnpm install 让它把包装掉')
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
    if (runPnpm() === false) process.exit(1)
    const linkPath = join(profileDir, 'node_modules', PKG)
    if (await exists(linkPath)) await rm(linkPath, { recursive: true, force: true })
    log('已卸载。重启 dsh 生效。')
    process.exit(0)
}

const linkPath = join(profileDir, 'node_modules', PKG)
const localMode = from === 'local'

log()
log('将要做（安装）：')
if (deps[PKG] !== depSpec) log(`  - dependencies["${PKG}"] = "${depSpec}"`)
else log(`  - dependencies["${PKG}"] 已经是 "${depSpec}"，不用改`)
if (!bundles.includes(PKG)) log(`  - dsh.profile.bundles 追加 "${PKG}"`)
else log(`  - dsh.profile.bundles 里已有 "${PKG}"`)
if (localMode) log(`  - ${(await exists(linkPath)) ? '替换' : '建立'}软链 node_modules/${PKG} → ${resolve(HERE)}`)
else log('  - 跑一次 pnpm install，再 pnpm update 拉到最新提交')
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

if (localMode) {
    // 原来是 GitHub 装的拷贝或旧软链都要换掉；只看存不存在会空跑还报「装好了」。
    // rm 碰到软链只删链接本身，不会跟进去删本仓库。
    await rm(linkPath, { recursive: true, force: true })
    await mkdir(dirname(linkPath), { recursive: true })
    await symlink(resolve(HERE), linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    log('装好了。重启 dsh 之后：设置 → 插件 里会出现「Moss 生图」页。')
    process.exit(0)
}

if (runPnpm() === false) {
    console.error('\npackage.json 已经写好了，但 pnpm install 没成功。修好 pnpm 后重跑 `pnpm install` 即可。')
    process.exit(1)
}
// lockfile 会把 github 依赖钉在上次的 commit 上，单独 update 一次才能拿到最新。
if (runPnpm(['update', PKG]) === false) {
    log('  ！拉最新失败，按 lockfile 里已有的版本装上了。')
}
if (!(await exists(linkPath))) {
    console.error(`\npnpm 跑完了，但 ${linkPath} 还是不存在。检查 GitHub 仓库是否可访问、包名是否写对。`)
    process.exit(1)
}
log('装好了。重启 dsh 之后：设置 → 插件 里会出现「Moss 生图」页。')
