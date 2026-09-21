import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'

await mkdir('public/landing', { recursive: true })
const bird = 'src/assets/images/Stellers_Jay_eating_cherries_Seattle_backyard.jpg'
await sharp(bird).rotate().resize(1000, 1100, { fit: 'cover' }).webp({ quality: 82 }).toFile('public/landing/jay.webp')
for (const [name, source] of [
  ['mallard', 'Mallard_drake_on_Union_Bay_Natural_Area.jpg'],
  ['scaup', 'Lesser_scaup_hen_on_Union_Bay_Natural_Area.jpg'],
  ['goldfinch', 'American_goldfinch_in_maple_at_Union_Bay_Natural_Area.jpg'],
  ['heron', 'Great_blue_heron_roosting_at_Carkeek_Park.jpg'],
  ['heron-reference', 'Great_blue_heron_with_Mount_Baker_from_Drayton_Harbor.jpg'],
  ['woodpecker', 'Hairy_woodpecker_on_mossy_tree_Carkeek_Park.jpg'],
]) {
  const framing = name === 'mallard'
    ? { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }
    : { fit: 'cover', position: sharp.strategy.attention }
  await sharp(`src/assets/images/${source}`).rotate().resize(480, 480, framing).webp({ quality: 85 }).toFile(`public/landing/${name}.webp`)
}
const background = Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#f4efe5"/>
  <g fill="#243e32" font-family="Georgia, serif">
    <text x="64" y="115" font-size="38">WingDex</text>
    <text x="64" y="265" font-size="70">Bird photos in.</text>
    <text x="64" y="350" font-size="70" font-style="italic">Life list out.</text>
    <text x="64" y="480" font-size="25">Free bird ID. Outings. Sighting history.</text>
  </g>
</svg>`)
await sharp(background).composite([{
  input: await sharp(bird).rotate().resize(420, 630, { fit: 'cover' }).toBuffer(),
  left: 780,
  top: 0,
}]).png().toFile('public/landing/social.png')
