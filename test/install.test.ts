import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let directory = ""
let config = ""
const packageName = "@prevalentware/opencode-loop-plugin"

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "loop-install-"))
  config = join(directory, "config", "opencode")
  await mkdir(config, { recursive: true })
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function install(...args: string[]) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../scripts/install.mjs"), ...args], {
    cwd: directory,
    env: { ...process.env, XDG_CONFIG_HOME: join(directory, "config") },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ])
  return { code, stdout, stderr }
}

test("installer writes both V2 configs and preserves pinned entries and options on repeat", async () => {
  const existing = { plugins: [{ package: `${packageName}@0.1.13`, options: { dynamic_restart_mode: "stop" } }], model: "test/model" }
  const original = JSON.stringify(existing)
  await writeFile(join(config, "opencode.json"), original)
  expect((await install("--global")).code).toBe(0)
  expect(await readFile(join(config, "opencode.json"), "utf8")).toBe(original)
  expect(JSON.parse(await readFile(join(config, "cli.json"), "utf8"))).toEqual({ plugins: [packageName] })
  expect((await install("--global")).code).toBe(0)
  expect(JSON.parse(await readFile(join(config, "cli.json"), "utf8"))).toEqual({ plugins: [packageName] })
})

test("project installer changes the project server config and global TUI config", async () => {
  const project = join(directory, "project")
  expect((await install("--project", project)).code).toBe(0)
  expect(JSON.parse(await readFile(join(project, "opencode.json"), "utf8"))).toEqual({ plugins: [packageName] })
  expect(JSON.parse(await readFile(join(config, "cli.json"), "utf8"))).toEqual({ plugins: [packageName] })
  expect(await Bun.file(join(config, "opencode.json")).exists()).toBe(false)
})

test.each(["null", "[]", '"invalid"', '{"plugins":{}}', "{broken"])("installer validates both documents before writing: %s", async (invalid) => {
  const original = '{"model":"test/model"}'
  await writeFile(join(config, "opencode.json"), original)
  await writeFile(join(config, "cli.json"), invalid)
  expect((await install("--global")).code).not.toBe(0)
  expect(await readFile(join(config, "opencode.json"), "utf8")).toBe(original)
  expect(await readFile(join(config, "cli.json"), "utf8")).toBe(invalid)
})

test.each([
  { args: ["--project"] },
  { args: ["--project", "--package", packageName] },
  { args: ["--global", "--project", "."] },
  { args: ["--unknown"] },
])("installer rejects invalid arguments: %j", async ({ args }) => {
  expect((await install(...args)).code).not.toBe(0)
  expect(await Bun.file(join(config, "opencode.json")).exists()).toBe(false)
  expect(await Bun.file(join(config, "cli.json")).exists()).toBe(false)
})

test("installer refuses JSONC before creating a competing JSON configuration", async () => {
  const original = '{\n// keep this comment\n"plugins": []\n}'
  await writeFile(join(config, "cli.jsonc"), original)
  expect((await install("--global")).code).not.toBe(0)
  expect(await readFile(join(config, "cli.jsonc"), "utf8")).toBe(original)
  expect(await Bun.file(join(config, "opencode.json")).exists()).toBe(false)
})
