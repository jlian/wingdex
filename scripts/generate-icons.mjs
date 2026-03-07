#!/usr/bin/env node
// One-time script to generate PWA / apple-touch PNG icons from the design source PNGs.
// Usage: node scripts/generate-icons.mjs

import sharp from 'sharp'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const source = resolve(root, 'design/icon-dark.png')
const publicDir = resolve(root, 'public')

const bgColor = { r: 18, g: 57, b: 27, alpha: 255 } // #12391b

const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-512-maskable.png', size: 512 },
  { name: 'apple-touch-icon-v2.png', size: 180 },
]

async function main() {
  for (const { name, size } of sizes) {
    const iconSize = Math.round(size * 1)
    const resizedIcon = await sharp(source)
      .resize(iconSize, iconSize)
      .png()
      .toBuffer()

    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: bgColor,
      },
    })
      .composite([{ input: resizedIcon, gravity: 'centre' }])
      .png()
      .toFile(resolve(publicDir, name))
    console.log(`  ${name} (${size}x${size})`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
