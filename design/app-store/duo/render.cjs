const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { chromium } = require('playwright')

async function render() {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      viewport: { width: 2853, height: 2007 },
      deviceScaleFactor: 1,
    })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const names = ['overview', 'outings', 'confidence', 'outing-detail', 'life-list']
    for (const [index, name] of names.entries()) {
      await page.goto(`${pathToFileURL(path.join(__dirname, 'artwork.html')).href}?slide=${index}`)
      await page.evaluate(async () => {
        await document.fonts.ready
        await Promise.all(Array.from(document.images, image => image.decode()))
      })
      if (errors.length) throw new Error(errors.join('\n'))
      const fits = await page.evaluate(() => {
        const artwork = document.querySelector('.artwork').getBoundingClientRect()
        return [...document.querySelectorAll('header, h1, p, .screen')].every(element => {
          const rect = element.getBoundingClientRect()
          return rect.left >= 0 && rect.right <= artwork.right &&
            rect.top >= 0 && rect.bottom <= artwork.bottom
        })
      })
      if (!fits) throw new Error(`Slide ${index + 1} overflows`)
      const output = `wingdex-duo-0${index + 1}-${name}.png`
      await page.locator('.artwork').screenshot({ path: path.join(__dirname, output), scale: 'css' })
      console.log(`${output}: 2853 x 2007`)
    }
  } finally {
    await browser.close()
  }
}

render().catch(error => {
  console.error(error)
  process.exitCode = 1
})
