import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { cleanupPreviews } = require('../.github/scripts/cleanup-preview.cjs')
const repo = { owner: 'owner', repo: 'repo' }

function fixture({ names = [], state = 'closed', deployments = [], deleteError, statusError } = {}) {
  const calls = []
  const logs = []
  const warnings = []
  const repos = {
    getAllEnvironments: 'environments',
    listDeployments: 'deployments',
    async createDeploymentStatus(params) {
      calls.push(['status', params])
      if (statusError) throw statusError
    },
    async deleteAnEnvironment(params) {
      calls.push(['delete', params])
      if (deleteError) throw deleteError
    },
  }
  return {
    calls, logs, warnings,
    options: {
      context: { repo },
      core: { info: message => logs.push(message), warning: message => warnings.push(message) },
      dryRun: false,
      deleteEnvironments: true,
      github: {
        rest: {
          repos,
          pulls: {
            async get(params) {
              calls.push(['pull', params])
              return { data: { state: typeof state === 'function' ? state(params.pull_number) : state } }
            },
          },
        },
        async paginate(endpoint, params) {
          assert.equal(params.per_page, 100)
          calls.push([endpoint, params])
          return endpoint === 'environments' ? names.map(name => ({ name })) : deployments
        },
      },
    },
  }
}

test('closed PR cleanup uses the numbered environment and all paginated deployments', async () => {
  const deployments = Array.from({ length: 205 }, (_, id) => ({ id: id + 1 }))
  const f = fixture({ deployments })
  await cleanupPreviews({ ...f.options, prNumber: '458' })
  assert.equal(f.calls.some(([name]) => name === 'environments'), false)
  assert.deepEqual(f.calls.find(([name]) => name === 'deployments')[1], {
    ...repo, environment: 'preview (#458)', per_page: 100,
  })
  const statuses = f.calls.filter(([name]) => name === 'status')
  assert.equal(statuses.length, 205)
  assert.deepEqual(statuses.at(-1)[1], {
    ...repo, deployment_id: 205, state: 'inactive', auto_inactive: false,
  })
  assert.deepEqual(f.calls.at(-1), ['delete', { ...repo, environment_name: 'preview (#458)' }])
})

test('backlog cleanup touches only exact numbered preview names for closed PRs', async () => {
  const f = fixture({
    names: ['production', 'dev', 'preview (branch)', 'preview (#0)', 'preview (#2) extra', 'preview (#1)', 'preview (#2)'],
    state: number => number === 1 ? 'closed' : 'open',
    deployments: [{ id: 10 }],
  })
  await cleanupPreviews(f.options)
  assert.deepEqual(f.calls.filter(([name]) => name === 'pull').map(([, params]) => params.pull_number), [1, 2])
  assert.deepEqual(f.calls.filter(([name]) => name === 'delete').map(([, params]) => params.environment_name), ['preview (#1)'])
  assert.equal(f.calls.filter(([name]) => name === 'status').length, 1)
  assert.ok(f.logs.includes('Skipping preview (#2): PR is open.'))
})

test('dry run discovers closed candidates without writing statuses or environments', async () => {
  const f = fixture({ names: ['preview (#1)'], deployments: [{ id: 1 }] })
  await cleanupPreviews({ ...f.options, dryRun: true })
  assert.equal(f.calls.some(([name]) => name === 'status' || name === 'delete'), false)
  assert.ok(f.logs.some(message => message.includes('Would deactivate 1')))
  assert.ok(f.logs.some(message => message.includes('Would delete preview (#1)')))
})

test('a reopened PR is skipped even for a targeted close-event cleanup', async () => {
  const f = fixture({ state: 'open', deployments: [{ id: 1 }] })
  await cleanupPreviews({ ...f.options, prNumber: '1' })
  assert.deepEqual(f.calls.map(([name]) => name), ['pull'])
})

test('the built-in token deactivates deployments and explicitly warns about retained environments', async () => {
  const f = fixture({ deployments: [{ id: 1 }] })
  await cleanupPreviews({ ...f.options, prNumber: '1', deleteEnvironments: false })
  assert.equal(f.calls.filter(([name]) => name === 'status').length, 1)
  assert.equal(f.calls.some(([name]) => name === 'delete'), false)
  assert.match(f.warnings[0], /Administration: write/)
})

test('an empty environment can be deleted and an already absent environment is harmless', async () => {
  const f = fixture({ deleteError: Object.assign(new Error('Not found'), { status: 404 }) })
  await cleanupPreviews({ ...f.options, prNumber: '1' })
  assert.ok(f.logs.includes('Deactivating 0 deployment(s) for preview (#1).'))
  assert.ok(f.logs.includes('preview (#1) is already absent.'))
})

test('permission failures are surfaced instead of reporting cleanup success', async () => {
  const error = Object.assign(new Error('Forbidden'), { status: 403 })
  const f = fixture({ deleteError: error })
  await assert.rejects(cleanupPreviews({ ...f.options, prNumber: '1' }), error)
})

test('failed deployment deactivation prevents environment deletion', async () => {
  const error = new Error('Status creation failed')
  const f = fixture({ deployments: [{ id: 1 }], statusError: error })
  await assert.rejects(cleanupPreviews({ ...f.options, prNumber: '1' }), error)
  assert.equal(f.calls.some(([name]) => name === 'delete'), false)
})

test('invalid manual PR numbers fail before any API calls', async () => {
  for (const prNumber of ['0', '-1', '1.5', '1; echo nope', '01', '9007199254740992']) {
    const f = fixture()
    await assert.rejects(cleanupPreviews({ ...f.options, prNumber }), /pr_number must/)
    assert.equal(f.calls.length, 0)
  }
})

test('CI and close cleanup serialize on the same PR and cleanup checks out trusted code', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const cleanup = readFileSync(new URL('../.github/workflows/cleanup-preview.yml', import.meta.url), 'utf8')
  const deployJob = ci.split('  build-and-test:')[1]
  assert.ok(ci.includes('group: ci-preview-${{ github.event.pull_request.number }}'))
  assert.ok(deployJob.includes('group: preview-${{ github.event.pull_request.number }}'))
  assert.match(deployJob, /cancel-in-progress: false/)
  assert.ok(cleanup.includes("group: preview-${{ github.event.pull_request.number || inputs.pr_number || 'backlog' }}"))
  assert.match(cleanup, /cancel-in-progress: false/)
  assert.match(cleanup, /pull_request_target:\n\s+types: \[closed\]/)
  assert.ok(cleanup.includes('ref: ${{ github.event.repository.default_branch }}'))
  assert.match(cleanup, /dry_run:[\s\S]*?default: true/)
})

test('late CI publication rechecks the PR before creating a deployment', async () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const block = ci.split('      - name: Branch preview deployment')[1].split('      - name: Report workflow runtime')[0]
  const script = block.split('          script: |\n')[1].replace(/^ {12}/gm, '')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const publish = new AsyncFunction('github', 'context', 'core', script)
  let created = 0
  for (const state of ['closed', 'open']) {
    await publish({
      rest: {
        pulls: { get: async () => ({ data: { state } }) },
        repos: {
          createDeployment: async () => { created++; return { data: { id: 1 } } },
          createDeploymentStatus: async () => {},
        },
      },
    }, { repo, payload: { pull_request: { number: 1 } } }, { info: () => {} })
    assert.equal(created, state === 'closed' ? 0 : 1)
  }
})
