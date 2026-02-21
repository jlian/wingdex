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

/** Return a random kebab-case bird name like "sneaky-meadow-warbler". */
export function generateBirdName(): string {
  const a = adjectives[Math.floor(Math.random() * adjectives.length)]
  const m = modifiers[Math.floor(Math.random() * modifiers.length)]
  const b = birds[Math.floor(Math.random() * birds.length)]
  return `${a}-${m}-${b}`
}
