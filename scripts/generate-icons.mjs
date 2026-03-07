#!/usr/bin/env node
// One-time script to generate PWA / apple-touch PNG icons from the design source PNGs.
// Usage: node scripts/generate-icons.mjs

import sharp from 'sharp'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const lightSource = resolve(root, 'design/icon.png')
const darkSource = resolve(root, 'design/icon-dark.png')
const publicDir = resolve(root, 'public')

const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon-v2.png', size: 180 },
]

async function main() {
  // Regular icons: resize to exact dimensions
  for (const { name, size } of sizes) {
    await sharp(lightSource)
      .resize(size, size)
      .png()
      .toFile(resolve(publicDir, name))
    console.log(`  ${name} (${size}x${size})`)
  }

  // Maskable icon: 512x512 with 20% safe-zone padding (icon at 80% = 410px)
  // Uses the dark variant since the background is dark green
  const maskableSize = 512
  const iconSize = Math.round(maskableSize * 0.8)
  const resizedIcon = await sharp(darkSource)
    .resize(iconSize, iconSize)
    .png()
    .toBuffer()

  // Extract the dominant background color from the source edges
  // Use a flat green matching the icon's gradient base
  const bgColor = { r: 45, g: 90, b: 39, alpha: 1 } // #2d5a27

  await sharp({
    create: {
      width: maskableSize,
      height: maskableSize,
      channels: 4,
      background: bgColor,
    },
  })
    .composite([{ input: resizedIcon, gravity: 'centre' }])
    .png()
    .toFile(resolve(publicDir, 'icon-512-maskable.png'))
  console.log(`  icon-512-maskable.png (${maskableSize}x${maskableSize}, maskable)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
