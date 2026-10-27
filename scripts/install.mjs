import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

const PACKAGE_NAME = "@prevalentware/opencode-loop-plugin"

function configDir() {
  return resolve(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
}

function readJson(path) {
  if (!existsSync(path)) return {}
  try {
    const value = JSON.parse(readFileSync(path, "utf8"))
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object")
    return value
  } catch {
    throw new Error(`expected a JSON object: ${path}; comments and trailing commas are not supported, edit manually`)
  }
}

function ensurePluginList(value) {
  if (value == null) return []
  if (Array.isArray(value)) return value
  throw new Error(`"plugins" must be an array`)
}

function pluginKey(entry) {
  const spec = typeof entry === "string" ? entry : entry?.package
  if (typeof spec !== "string") return null
  return spec.replace(/^(?:(@[^/]+\/[^@/]+)|([^@./][^@/]*))@.+$/, "$1$2")
}

function addPlugin(list, pkg) {
  if (list.some((entry) => pluginKey(entry) === pluginKey(pkg))) return { list, added: false }
  return { list: [...list, pkg], added: true }
}

function writeJson(path, value) {
  const target = existsSync(path) ? realpathSync(path) : path
  const mode = existsSync(target) ? statSync(target).mode & 0o777 : 0o600
  mkdirSync(dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode })
    renameSync(temporary, target)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function main() {
  const args = process.argv.slice(2)
  let projectDir = null
  let global = false
  let pkg = PACKAGE_NAME
  const seen = new Set()
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (!["--global", "--project", "--package"].includes(flag) || seen.has(flag)) throw new Error(`invalid argument: ${flag}`)
    seen.add(flag)
    if (flag === "--global") {
      global = true
      continue
    }
    const value = args[++index]
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`)
    if (flag === "--project") projectDir = resolve(value)
    else pkg = value
  }
  if (global && projectDir) throw new Error("choose --global or --project")

  const serverPaths = projectDir
    ? [join(projectDir, "opencode.json"), join(projectDir, ".opencode", "opencode.json")]
    : [join(configDir(), "opencode.json")]
  for (const path of [...serverPaths, join(configDir(), "cli.json")]) {
    const jsonc = path.replace(/\.json$/, ".jsonc")
    if (existsSync(jsonc)) throw new Error(`edit the existing JSONC configuration manually: ${jsonc}`)
  }
  const serverConfigs = serverPaths.map((path) => {
    const current = readJson(path)
    return { path, plugins: ensurePluginList(current.plugins) }
  })
  const serverPath = serverConfigs.find(({ plugins }) => plugins.some((entry) => pluginKey(entry) === pluginKey(pkg)))?.path
    ?? serverPaths.find(existsSync) ?? serverPaths[0]
  const targets = []
  targets.push({ kind: projectDir ? "server(project)" : "server(global)", path: serverPath })
  targets.push({ kind: "tui", path: join(configDir(), "cli.json") })

  const updates = targets.map((target) => {
    const current = readJson(target.path)
    const { list, added } = addPlugin(ensurePluginList(current.plugins), pkg)
    return { ...target, current, list, added }
  })

  for (const { kind, path, current, list, added } of updates) {
    if (added) {
      writeJson(path, { ...current, plugins: list })
      console.log(`added ${pkg} to ${kind}: ${path}`)
    } else {
      console.log(`already present in ${kind}: ${path}`)
    }
  }
}

main()
