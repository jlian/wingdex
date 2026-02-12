export async function extractEXIF(file: File): Promise<{
  timestamp?: string
  gps?: { lat: number; lon: number }
}> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    
    reader.onload = (e) => {
      try {
        const view = new DataView(e.target?.result as ArrayBuffer)
        const exif = parseEXIF(view)
        resolve(exif)
      } catch {
        resolve({})
      }
    }
    
    reader.onerror = () => resolve({})
    reader.readAsArrayBuffer(file.slice(0, 128 * 1024))
  })
}

function parseEXIF(view: DataView): {
  timestamp?: string
  gps?: { lat: number; lon: number }
} {
  if (view.getUint16(0) !== 0xffd8) return {}
  
  let offset = 2
  const result: { timestamp?: string; gps?: { lat: number; lon: number } } = {}
  
  while (offset < view.byteLength) {
    const marker = view.getUint16(offset)
    if (marker === 0xffe1) {
      const size = view.getUint16(offset + 2)
      const exifStart = offset + 4
      
      if (view.getUint32(exifStart) === 0x45786966) {
        const tiffOffset = exifStart + 6
        const littleEndian = view.getUint16(tiffOffset) === 0x4949
        
        try {
          const ifdOffset = view.getUint32(tiffOffset + 4, littleEndian)
          const numEntries = view.getUint16(tiffOffset + ifdOffset, littleEndian)
          
          for (let i = 0; i < numEntries; i++) {
            const entryOffset = tiffOffset + ifdOffset + 2 + i * 12
            const tag = view.getUint16(entryOffset, littleEndian)
            
            if (tag === 0x0132 || tag === 0x9003) {
              const valueOffset = view.getUint32(entryOffset + 8, littleEndian)
              let dateStr = ''
              for (let j = 0; j < 19; j++) {
                const char = view.getUint8(tiffOffset + valueOffset + j)
                if (char === 0) break
                dateStr += String.fromCharCode(char)
              }
              if (dateStr) {
                result.timestamp = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
              }
            }
            
            if (tag === 0x8825) {
              const gpsIfdOffset = view.getUint32(entryOffset + 8, littleEndian)
              const gps = parseGPS(view, tiffOffset, gpsIfdOffset, littleEndian)
              if (gps) result.gps = gps
            }
          }
        } catch {
          
        }
      }
      break
    }
    offset += 2 + view.getUint16(offset + 2)
  }
  
  return result
}

function parseGPS(
  view: DataView,
  tiffOffset: number,
  gpsIfdOffset: number,
  littleEndian: boolean
): { lat: number; lon: number } | null {
  try {
    const numEntries = view.getUint16(tiffOffset + gpsIfdOffset, littleEndian)
    let lat = 0, lon = 0, latRef = '', lonRef = ''
    
    for (let i = 0; i < numEntries; i++) {
      const entryOffset = tiffOffset + gpsIfdOffset + 2 + i * 12
      const tag = view.getUint16(entryOffset, littleEndian)
      const valueOffset = view.getUint32(entryOffset + 8, littleEndian)
      
      if (tag === 1) {
        latRef = String.fromCharCode(view.getUint8(tiffOffset + valueOffset))
      } else if (tag === 3) {
        lonRef = String.fromCharCode(view.getUint8(tiffOffset + valueOffset))
      } else if (tag === 2) {
        const d = view.getUint32(tiffOffset + valueOffset, littleEndian) / view.getUint32(tiffOffset + valueOffset + 4, littleEndian)
        const m = view.getUint32(tiffOffset + valueOffset + 8, littleEndian) / view.getUint32(tiffOffset + valueOffset + 12, littleEndian)
        const s = view.getUint32(tiffOffset + valueOffset + 16, littleEndian) / view.getUint32(tiffOffset + valueOffset + 20, littleEndian)
        lat = d + m / 60 + s / 3600
      } else if (tag === 4) {
        const d = view.getUint32(tiffOffset + valueOffset, littleEndian) / view.getUint32(tiffOffset + valueOffset + 4, littleEndian)
        const m = view.getUint32(tiffOffset + valueOffset + 8, littleEndian) / view.getUint32(tiffOffset + valueOffset + 12, littleEndian)
        const s = view.getUint32(tiffOffset + valueOffset + 16, littleEndian) / view.getUint32(tiffOffset + valueOffset + 20, littleEndian)
        lon = d + m / 60 + s / 3600
      }
    }
    
    if (lat && lon) {
      return {
        lat: latRef === 'S' ? -lat : lat,
        lon: lonRef === 'W' ? -lon : lon
      }
    }
  } catch {
    
  }
  return null
}

export async function generateThumbnail(file: File, maxWidth = 400): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas not supported'))
        return
      }
      
      const scale = Math.min(maxWidth / img.width, 1)
      canvas.width = img.width * scale
      canvas.height = img.height * scale
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.8))
    }
    
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    
    img.src = url
  })
}

export async function downscaleForInference(dataUrl: string, maxDim = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas not supported'))
        return
      }
      
      const scale = Math.min(maxDim / Math.max(img.width, img.height), 1)
      canvas.width = img.width * scale
      canvas.height = img.height * scale
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.75))
    }
    
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = dataUrl
  })
}

export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
