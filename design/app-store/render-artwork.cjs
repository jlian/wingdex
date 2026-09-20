const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { mkdirSync } = require('node:fs')
const { chromium } = require('playwright')

const outputDirectory = path.resolve(process.argv[2] || __dirname)
mkdirSync(outputDirectory, { recursive: true })

async function renderArtwork() {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      viewport: { width: 1320, height: 2868 },
      deviceScaleFactor: 1,
    })
    const artworks = ['01', '02', '03', '04', '05', '06'].map(id => {
      const revised = ['03', '04'].includes(id)
      return {
        name: `${id}-sentences${revised ? '-v2' : ''}`,
        source: `polished-artwork.html?direction=sentences&revision=${revised ? 2 : 1}&slide=${id}`,
      }
    })
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    for (const artwork of artworks) {
      await page.goto(new URL(artwork.source, pathToFileURL(`${__dirname}/`)).href)
      await page.evaluate(async () => {
        await document.fonts.ready
        await Promise.all(Array.from(document.images, image => image.decode()))
      })
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        scale: devicePixelRatio,
      }))
      if (metrics.width !== 1320 || metrics.height !== 2868 || metrics.scale !== 1) {
        throw new Error(`Unexpected rendering scale: ${JSON.stringify(metrics)}`)
      }
      if (pageErrors.length) throw new Error(pageErrors.join('\n'))
      await page.locator('.artwork').screenshot({
        path: path.join(outputDirectory, `wingdex-screenshot-${artwork.name}.png`),
        scale: 'css',
      })
      console.log(`${artwork.name}: 1320 x 2868`)
    }
  } finally {
    await browser.close()
  }
}

renderArtwork().catch(error => {
  console.error(error)
  process.exitCode = 1
})
