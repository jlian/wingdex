import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Apple secret rotation workflow', () => {
  it('updates both production secrets before staging both preview secrets without deploying', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/rotate-apple-secret.yml'), 'utf8')
    const steps = workflow.split(/^ {6}- /m)
    const install = steps.findIndex((step) => step.startsWith('name: Install wrangler\n'))
    expect(install).toBeGreaterThan(-1)
    expect(steps.slice(0, install).join('\n')).not.toMatch(/^ {8}run:/m)
    const rotations = steps.slice(install + 1)
    expect(rotations).toHaveLength(4)

    const dir = mkdtempSync(join(tmpdir(), 'apple-rotation-test-'))
    try {
      const log = join(dir, 'calls')
      writeFileSync(join(dir, 'npx'), '#!/bin/sh\nprintf "%s|%s\\n" "$*" "$(cat)" >> "$ROTATION_LOG"\n', { mode: 0o755 })
      for (const step of rotations) {
        expect(step).not.toMatch(/^ {8}(?:if|uses|continue-on-error|shell|working-directory):/m)
        expect(step.match(/^ {8}run:/gm)).toHaveLength(1)
        const command = step.match(/^ {8}run: (.+)$/m)?.[1]
        expect(command).toMatch(/^printf '%s' "\$APPLE_(?:APP_)?CLIENT_SECRET" \| npx wrangler (?:versions )?secret put APPLE_(?:APP_)?CLIENT_SECRET(?: --env preview)?$/)
        execFileSync('bash', ['-e', '-o', 'pipefail', '-c', command!], {
          env: {
            PATH: `${dir}:/usr/bin:/bin`,
            ROTATION_LOG: log,
            APPLE_CLIENT_SECRET: 'web-test-secret',
            APPLE_APP_CLIENT_SECRET: 'native-test-secret',
          },
        })
      }
      expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
        'wrangler secret put APPLE_CLIENT_SECRET|web-test-secret',
        'wrangler secret put APPLE_APP_CLIENT_SECRET|native-test-secret',
        'wrangler versions secret put APPLE_CLIENT_SECRET --env preview|web-test-secret',
        'wrangler versions secret put APPLE_APP_CLIENT_SECRET --env preview|native-test-secret',
      ])
      for (const [index, secret] of ['CLIENT', 'APP_CLIENT', 'CLIENT', 'APP_CLIENT'].entries()) {
        const output = secret === 'CLIENT' ? 'client_secret' : 'app_client_secret'
        expect(rotations[index]).toContain(`APPLE_${secret}_SECRET: \${{ steps.jwt.outputs.${output} }}`)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
