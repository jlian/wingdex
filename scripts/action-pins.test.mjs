import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function yamlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return yamlFiles(path)
    return /\.ya?ml$/.test(entry.name) ? [path] : []
  })
}

test('third-party Actions are pinned to full commit SHAs', () => {
  const unpinned = yamlFiles(join(root, '.github')).flatMap(file => {
    const content = readFileSync(file, 'utf8')
    return [...content.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)]
      .map(match => match[1])
      .filter(reference => !reference.startsWith('./') && !/@[a-f0-9]{40}$/.test(reference))
      .map(reference => `${file.slice(root.length + 1)}: ${reference}`)
  })
  assert.equal(unpinned.length, 0, `Unpinned Actions:\n${unpinned.join('\n')}`)
})
