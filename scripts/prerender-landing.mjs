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
  const { render, renderLegalPage } = await import(`../${outDir}/render.mjs`)
  const path = 'dist/client/index.html'
  const html = await readFile(path, 'utf8')
  const marker = '<!--landing-->'
  if (!html.includes(marker)) throw new Error('Landing prerender marker is missing')
  const prerenderedHtml = html.replace(/\s*<!--landing-->\s*/, render()).replace('id="app"', 'id="app" data-prerendered="true"')
  await writeFile(path, prerenderedHtml)

  const stylesheet = prerenderedHtml.match(/<link rel="stylesheet"[^>]+href="([^"]+)"/)?.[1]
  if (!stylesheet) throw new Error('Built stylesheet link is missing')
  const themeBootstrap = `(() => {
  try {
    const stored = localStorage.getItem('theme')
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const theme = stored === 'dark' || stored === 'light'
      ? stored
      : (systemDark ? 'dark' : 'light')
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(theme)
    document.documentElement.style.colorScheme = theme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#262e29' : '#e5ddd0')
  } catch {
    // Keep the default light theme when storage or media queries are unavailable.
  }
})()`

  for (const [filename, title, page] of [
    ['privacy.html', 'Privacy Policy', 'privacy'],
    ['terms.html', 'Terms of Use', 'terms'],
  ]) {
    const document = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>${title} - WingDex</title>
    <link rel="canonical" href="https://wingdex.app/${filename}" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="theme-color" content="#e5ddd0" />
    <script>${themeBootstrap}</script>
    <link rel="stylesheet" crossorigin href="${stylesheet}" />
  </head>
  <body>
    <div id="app">${renderLegalPage(page)}</div>
  </body>
</html>
`
    await writeFile(`dist/client/${filename}`, document)
  }
} finally {
  await rm(outDir, { recursive: true, force: true })
}
