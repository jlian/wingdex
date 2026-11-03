// Renders App Store header and search creative assets from creative.html.
// Usage: node render.cjs [--video] [--fps 30|60] [--guides]
const path = require('node:path')
const { spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { mkdirSync } = require('node:fs')
const { chromium } = require('playwright')

const args = process.argv.slice(2)
const withVideo = args.includes('--video')
const withGuides = args.includes('--guides')
const fps = Number(args[args.indexOf('--fps') + 1]) || 30
if (![30, 60].includes(fps)) throw new Error('Apple accepts 30 or 60 fps only')

const outputDirectory = path.join(__dirname, '.generated')
mkdirSync(outputDirectory, { recursive: true })
// Search video is encoded at 3600 x 2400 (still 3:2, inside Apple's 1920-3840 range):
// 3840 x 2560 needs H.264 level 6.0, which many decoders refuse; 3600 x 2400 fits level 5.2.
const formats = { header: [3840, 1646], search: [3840, 2560] }
const videoSizes = { header: [3840, 1646], search: [3600, 2400] }
// Stills match the video's first frame, which App Store Connect shows as the default poster.
const posterSeconds = 0

async function open(page, format, seconds) {
  const url = new URL('creative.html', pathToFileURL(`${__dirname}/`))
  url.search = new URLSearchParams({ format, t: seconds })
  await page.goto(url.href)
  await page.evaluate(() => window.ready)
}

async function verifyLoop(page) {
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.row')]
    const frames = window.loopSeconds * 60
    for (let frame = 0; frame < frames; frame++) {
      window.render(frame / 60)
      for (const [index, row] of rows.entries()) {
        const bounds = row.getBoundingClientRect()
        if (bounds.left > 0 || bounds.right < innerWidth) {
          throw new Error(`Row ${index} does not cover the canvas at frame ${frame}`)
        }
      }
    }
    const last = rows.map(row => row.getBoundingClientRect().left)
    window.render(0)
    rows.forEach((row, index) => {
      const pitch = row.children[1].offsetLeft - row.children[0].offsetLeft
      if (Math.abs(row.getBoundingClientRect().left - last[index]) > pitch / frames) {
        throw new Error(`Row ${index} jumps at the loop boundary`)
      }
    })
  })
}

function encode(file, width, height) {
  const ffmpeg = spawn('ffmpeg', [
    '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '14',
    '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-vf', `scale=${width}:${height}:out_color_matrix=bt709:out_range=tv`,
    '-r', String(fps), '-movflags', '+faststart', '-an', file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise((resolve, reject) =>
    ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))))
  return { stdin: ffmpeg.stdin, done }
}

async function render() {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const [format, [width, height]] of Object.entries(formats)) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await open(page, format, posterSeconds)
      if (errors.length) throw new Error(errors.join('\n'))
      await verifyLoop(page)
      await page.evaluate(seconds => window.render(seconds), posterSeconds)
      const still = path.join(outputDirectory, `wingdex-${format}.png`)
      await page.screenshot({ path: still })
      console.log(`${path.basename(still)}: ${width} x ${height}`)

      if (withGuides) {
        await page.evaluate(() => {
          const guide = document.createElement('div')
          const [x, y, w, h] = { 1646: [1098, 494, 1644, 658], 2560: [836, 766, 2166, 1028] }[innerHeight]
          Object.assign(guide.style, {
            position: 'fixed', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`,
            outline: '6px solid #00ff00', zIndex: 9,
          })
          document.body.append(guide)
        })
        await page.screenshot({ path: path.join(outputDirectory, `wingdex-${format}-guides.png`) })
        await open(page, format, posterSeconds)
      }

      if (withVideo) {
        const file = path.join(outputDirectory, `wingdex-${format}-${fps}fps.mp4`)
        const [videoWidth, videoHeight] = videoSizes[format]
        const { stdin, done } = encode(file, videoWidth, videoHeight)
        const frames = await page.evaluate(() => window.loopSeconds) * fps
        for (let frame = 0; frame < frames; frame++) {
          await page.evaluate(seconds => window.render(seconds), frame / fps)
          const ok = stdin.write(await page.screenshot({ type: 'png' }))
          if (!ok) await new Promise(resolve => stdin.once('drain', resolve))
          if (frame % fps === 0) process.stdout.write(`\r${format} ${frame}/${frames}`)
        }
        stdin.end()
        await done
        console.log(`\r${path.basename(file)}: ${videoWidth} x ${videoHeight}, ${frames / fps}s at ${fps} fps`)
      }
      await page.close()
    }
  } finally {
    await browser.close()
  }
}

render().catch(error => {
  console.error(error)
  process.exitCode = 1
})
