import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

const PACKAGE_NAME = "@prevalentware/opencode-loop-plugin"

function configDir() {
  if (process.env.XDG_CONFIG_HOME) return resolve(process.env.XDG_CONFIG_HOME, "opencode")
  if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "..", "Local", "opencode")
  const base = process.platform === "win32" ? join(homedir(), "AppData", "Local") : join(homedir(), ".config")
  return join(base, "opencode")
}

function readJson(path) {
  if (!existsSync(path)) return {}
  try {
    const value = JSON.parse(readFileSync(path, "utf8"))
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object")
    return value
  } catch {
    throw new Error(`invalid JSON: ${path}`)
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
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, path)
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

  const targets = []
  if (projectDir) {
    targets.push({ kind: "server(project)", path: join(projectDir, "opencode.json") })
  } else {
    targets.push({ kind: "server(global)", path: join(configDir(), "opencode.json") })
  }
  targets.push({ kind: "tui", path: join(configDir(), "cli.json") })

  const updates = targets.map((target) => {
    if (existsSync(target.path.replace(/\.json$/, ".jsonc"))) {
      throw new Error(`edit the existing JSONC configuration manually: ${target.path.replace(/\.json$/, ".jsonc")}`)
    }
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
