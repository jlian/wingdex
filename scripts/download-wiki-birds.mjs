#!/usr/bin/env node
/**
 * Downloads bird images from Wikipedia User:Lianguanlun page
 * using the Wikimedia Commons API to get original file URLs.
 */
import { writeFileSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'

const DEST = 'src/assets/images'

// All bird image filenames from https://en.wikipedia.org/wiki/User:Lianguanlun#Birds
const WIKI_FILES = [
  'Palm_warbler_on_Lake_Michigan_shore_Chicago.jpg',
  'Dark-eyed_junco_in_foliage_Seattle_Arboretum.jpg',
  "Anna's_hummingbird_in_Seattle_garden.jpg",
  'Black-throated_blue_warbler_in_Chicago_park.jpg',
  'Tufted_puffin_near_Smith_Island_Washington.jpg',
  'Lesser_scaup_hen_on_Union_Bay_Natural_Area.jpg',
  'Belted_kingfisher_above_Puget_Sound_Carkeek_Park.jpg',
  'Sanderling_foraging_Lake_Michigan_Chicago.jpg',
  'Hairy_woodpecker_on_mossy_tree_Carkeek_Park.jpg',
  'American_goldfinch_in_maple_at_Union_Bay_Natural_Area.jpg',
  'Great_blue_heron_roosting_at_Carkeek_Park.jpg',
  'Cormorant_on_mooring_post_Lake_Como.jpg',
  'House_sparrow_bathing_in_mosaic_fountain_Park_Ridge.jpg',
  'Chukar_partridge_near_Haleakala_summit_Maui.jpg',
  'Great_blue_heron_with_Mount_Baker_from_Drayton_Harbor.jpg',
  'Cormorants_on_navigation_marker_Skagit_Bay.jpg',
  'Geese_in_misty_rice_paddies_Dehua_Fujian.jpg',
  'Gulls_on_picnic_tables_Seattle_waterfront.jpg',
  'Mallard_drake_on_Union_Bay_Natural_Area.jpg',
  "Steller's_Jay_eating_cherries_Seattle_backyard.jpg",
  'Cormorants_on_rock_Monterey_Harbor_sunset.jpg',
  'Female_northern_cardinal_in_Chicago_park.jpg',
  'Pigeons_near_Museumplein_Amsterdam.jpg',
]

// Old files that are duplicates of the Wikipedia originals
const OLD_DUPES = [
  'belted-kingfisher.jpg',
  'chukar-partridge.jpg',
  'great-blue-heron.jpg',
  'palm-warbler.jpeg',
  'stellers-jay.jpg',
  'tufted-puffin.jpg',
]

const HEADERS = {
  'User-Agent': 'BirdDexPhotoDownloader/1.0 (https://github.com/jlian/birddex; birddex@example.com)',
}

async function getOriginalUrl(filename) {
  const title = `File:${filename}`
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url',
    format: 'json',
  })
  const url = `https://commons.wikimedia.org/w/api.php?${params}`
  const res = await fetch(url, { headers: HEADERS })
  const data = await res.json()
  const pages = data.query.pages
  const page = Object.values(pages)[0]
  if (!page.imageinfo || page.imageinfo.length === 0) {
    throw new Error(`No imageinfo for ${filename}`)
  }
  return page.imageinfo[0].url
}

async function downloadFile(url, destPath) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  writeFileSync(destPath, buffer)
  return buffer.length
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function downloadWithRetry(filename, destPath, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const url = await getOriginalUrl(filename)
      const size = await downloadFile(url, destPath)
      return size
    } catch (err) {
      if (attempt < retries && err.message.includes('429')) {
        const delay = attempt * 10000
        console.log(`    Rate limited, waiting ${delay/1000}s (attempt ${attempt}/${retries})...`)
        await sleep(delay)
      } else {
        throw err
      }
    }
  }
}

async function main() {
  console.log(`Downloading ${WIKI_FILES.length} bird images...\n`)

  for (const filename of WIKI_FILES) {
    const destPath = join(DEST, filename)
    if (existsSync(destPath)) {
      console.log(`  SKIP (exists): ${filename}`)
      continue
    }
    try {
      console.log(`  Fetching: ${filename}`)
      const size = await downloadWithRetry(filename, destPath)
      console.log(`    -> ${(size / 1024 / 1024).toFixed(1)} MB`)
      // Throttle to avoid 429
      await sleep(3000)
    } catch (err) {
      console.error(`  ERROR: ${filename}: ${err.message}`)
    }
  }

  console.log('\nRemoving old duplicate files...')
  for (const old of OLD_DUPES) {
    const oldPath = join(DEST, old)
    if (existsSync(oldPath)) {
      unlinkSync(oldPath)
      console.log(`  Removed: ${old}`)
    }
  }

  console.log('\nDone!')
}

main().catch(console.error)
