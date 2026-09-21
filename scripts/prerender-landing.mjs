import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile, writeFile, rm } from 'node:fs/promises'

const outDir = 'node_modules/.tmp/wingdex-landing'
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
try {
  await build({
    configFile: false,
    define: { APP_VERSION: JSON.stringify(version) },
    resolve: { tsconfigPaths: true },
    plugins: [react()],
    build: {
      ssr: 'src/landing-render.tsx',
      outDir,
      emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: 'render.mjs' } },
    },
  })
  const { render } = await import(`../${outDir}/render.mjs`)
  const path = 'dist/client/index.html'
  const html = await readFile(path, 'utf8')
  const marker = '<!--landing-->'
  if (!html.includes(marker)) throw new Error('Landing prerender marker is missing')
  await writeFile(path, html.replace(/\s*<!--landing-->\s*/, render()).replace('id="app"', 'id="app" data-prerendered="true"'))
} finally {
  await rm(outDir, { recursive: true, force: true })
}
