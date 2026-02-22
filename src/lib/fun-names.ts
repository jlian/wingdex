const adjectives = [
  'bold', 'brave', 'bright', 'brisk', 'calm', 'cheerful', 'clever',
  'cozy', 'cosmic', 'crafty', 'crisp', 'curious', 'daring', 'dazzling',
  'eager', 'earnest', 'fancy', 'fearless', 'feisty', 'fierce', 'fleet',
  'gentle', 'gleeful', 'golden', 'grand', 'happy', 'hardy', 'hasty',
  'hearty', 'hidden', 'humble', 'hushed', 'jolly', 'keen', 'kind',
  'lively', 'lone', 'lucky', 'merry', 'mighty', 'nimble', 'noble',
  'pale', 'patient', 'plucky', 'proud', 'quick', 'quiet', 'rosy',
  'rustic', 'sage', 'savvy', 'scrappy', 'secret', 'shrewd', 'shy',
  'silent', 'sleek', 'sneaky', 'snug', 'spry', 'steady', 'stout',
  'swift', 'tender', 'tiny', 'vivid', 'warm', 'wary', 'watchful',
  'whimsy', 'wild', 'wily', 'wise', 'witty', 'zappy', 'zesty',
  'dank', 
]

const modifiers = [
  'alpine', 'arctic', 'autumn', 'bamboo', 'canyon', 'cedar', 'cliff',
  'cloud', 'coastal', 'coral', 'creek', 'crystal', 'dawn', 'delta',
  'desert', 'drift', 'dune', 'dusky', 'elm', 'fern', 'field', 'fir',
  'fjord', 'forest', 'frost', 'garden', 'glacier', 'glen', 'grove',
  'harbor', 'heath', 'hedge', 'highland', 'hollow', 'island', 'ivy',
  'jungle', 'kelp', 'lake', 'linden', 'maple', 'marsh', 'meadow',
  'mesa', 'mist', 'misty', 'moon', 'moss', 'mountain', 'oak', 'ocean',
  'palm', 'peak', 'pebble', 'pine', 'pond', 'prairie', 'rain', 'reef',
  'ridge', 'river', 'sage', 'shore', 'sky', 'slate', 'snow', 'spring',
  'spruce', 'star', 'stone', 'storm', 'stream', 'summit', 'sunset',
  'thorn', 'tide', 'trail', 'tundra', 'valley', 'vine', 'willow',
]

const birds = [
  'bunting', 'cardinal', 'crane', 'dove', 'eagle', 'egret', 'falcon',
  'finch', 'flamingo', 'grouse', 'hawk', 'heron', 'ibis', 'jay',
  'kestrel', 'kinglet', 'lark', 'loon', 'magpie', 'merlin', 'osprey',
  'owl', 'parrot', 'pelican', 'penguin', 'pipit', 'plover', 'quail',
  'raven', 'robin', 'sparrow', 'starling', 'stork', 'swift', 'tanager',
  'tern', 'thrush', 'toucan', 'warbler', 'wren',
]

const birdEmojiMap: Record<string, string> = {
  eagle: '🦅', falcon: '🦅', hawk: '🦅', kestrel: '🦅', merlin: '🦅', osprey: '🦅',
  owl: '🦉',
  parrot: '🦜', toucan: '🦜', tanager: '🦜', jay: '🦜', magpie: '🦜',
  penguin: '🐧',
  loon: '🦆', grouse: '🦆', quail: '🦆', plover: '🦆', dove: '🦆',
  flamingo: '🦩', ibis: '🦩', egret: '🦩', heron: '🦩', stork: '🦩', crane: '🦩', pelican: '🦩',
  finch: '🐤', sparrow: '🐤', wren: '🐤', warbler: '🐤', bunting: '🐤', pipit: '🐤', kinglet: '🐤', robin: '🐤',
  cardinal: '🐦', lark: '🐦', raven: '🐦', starling: '🐦', swift: '🐦', tern: '🐦', thrush: '🐦',
}

/** Return a random kebab-case bird name like "sneaky-meadow-warbler". */
export function generateBirdName(): string {
  const a = adjectives[Math.floor(Math.random() * adjectives.length)]
  const m = modifiers[Math.floor(Math.random() * modifiers.length)]
  const b = birds[Math.floor(Math.random() * birds.length)]
  return `${a}-${m}-${b}`
}

/** Return the emoji that best matches the bird word in a kebab-case name. */
export function emojiForBirdName(name: string): string {
  const lastWord = name.split('-').pop() ?? ''
  return birdEmojiMap[lastWord] ?? '🐦'
}

const emojiColors: Record<string, string> = {
  '🐦': 'bg-sky-100 dark:bg-sky-900/40',
  '🦉': 'bg-amber-100 dark:bg-amber-900/40',
  '🦜': 'bg-emerald-100 dark:bg-emerald-900/40',
  '🐧': 'bg-slate-100 dark:bg-slate-900/40',
  '🦆': 'bg-teal-100 dark:bg-teal-900/40',
  '🦩': 'bg-pink-100 dark:bg-pink-900/40',
  '🦅': 'bg-orange-100 dark:bg-orange-900/40',
  '🐤': 'bg-yellow-100 dark:bg-yellow-900/40',
}

export function emojiAvatarDataUrl(emoji: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="44">${emoji}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** Return the Tailwind color class for an emoji avatar data-URL, or '' if not an emoji avatar. */
export function getEmojiAvatarColor(imageUrl: string | undefined | null): string {
  if (!imageUrl?.startsWith('data:image/svg+xml')) return ''
  const decoded = decodeURIComponent(imageUrl)
  for (const [emoji, color] of Object.entries(emojiColors)) {
    if (decoded.includes(emoji)) return color
  }
  return ''
}
