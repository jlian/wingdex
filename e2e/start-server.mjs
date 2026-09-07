import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { rmSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import { preview } from 'vite'

// Use the production bundle, but never the developer's database or .dev.vars.
const deployment = JSON.parse(await readFile('.wrangler/deploy/config.json', 'utf8'))
const buildConfigPath = resolve('.wrangler/deploy', deployment.configPath)
const build = JSON.parse(await readFile(buildConfigPath, 'utf8'))
const buildDirectory = dirname(buildConfigPath)
await mkdir('.wrangler', { recursive: true })
const directory = await mkdtemp(resolve('.wrangler/e2e-'))
// Vite also handles termination and may exit before our async finally resumes.
process.once('exit', () => rmSync(directory, { recursive: true, force: true }))
const configPath = resolve(directory, 'wrangler.json')
const statePath = resolve(directory, 'state')
const live = process.env.PLAYWRIGHT_LIVE === 'true'
const port = process.env.PLAYWRIGHT_PORT || '5100'
const config = {
  name: 'wingdex-e2e',
  main: resolve(buildDirectory, build.main),
  compatibility_date: build.compatibility_date,
  compatibility_flags: build.compatibility_flags,
  no_bundle: true,
  rules: build.rules,
  assets: { ...build.assets, directory: resolve(buildDirectory, build.assets.directory) },
  d1_databases: build.d1_databases.map(database => ({
    ...database,
    migrations_dir: resolve(buildDirectory, database.migrations_dir),
    remote: false,
  })),
  r2_buckets: [{ binding: 'PLACES', bucket_name: 'wingdex-places-preview', remote: live }],
  ratelimits: build.ratelimits,
  vars: {
    BETTER_AUTH_SECRET: 'wingdex-local-test-secret-not-used-outside-tests',
    GITHUB_CLIENT_ID: 'test-client',
    GITHUB_CLIENT_SECRET: 'test-secret',
    LOG_LEVEL: 'error',
  },
}

let child
let interrupted = false
let finish
const stopped = new Promise(resolve => { finish = resolve })
function stop(signal) {
  interrupted = true
  child?.kill(signal)
  finish()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

async function run(args) {
  child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  })
  const [code, signal] = await once(child, 'exit')
  child = undefined
  if (!interrupted && code !== 0) {
    throw new Error(`Wrangler ${args[0]} failed (${signal || code})`)
  }
}

try {
  await writeFile(configPath, JSON.stringify(config))
  await run(['d1', 'migrations', 'apply', 'DB', '--config', configPath, '--local', '--persist-to', statePath])
  if (!interrupted) {
    const deployDirectory = resolve(directory, '.wrangler/deploy')
    await mkdir(deployDirectory, { recursive: true })
    await writeFile(resolve(deployDirectory, 'config.json'), JSON.stringify({
      configPath, auxiliaryWorkers: [],
    }))
    // Vite's Cloudflare preview serves the same bundle without Wrangler's
    // fatal ProxyWorker disconnect bug (cloudflare/workers-sdk#15451).
    const server = await preview({
      root: directory,
      configFile: false,
      plugins: cloudflare({
        persistState: { path: statePath },
        remoteBindings: live,
        inspectorPort: false,
      }),
      build: { outDir: resolve(buildDirectory, build.assets.directory) },
      preview: { host: '127.0.0.1', port: Number(port), strictPort: true },
    })
    await stopped
    await server.close()
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
