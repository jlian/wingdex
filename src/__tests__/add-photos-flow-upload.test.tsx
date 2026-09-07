import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import AddPhotosFlow from '@/components/flows/AddPhotosFlow'
import type { WingDexDataStore } from '@/hooks/use-wingdex-data'
import { computeFileHash, extractEXIF, preparePhotoImage, PhotoDecodeError } from '@/lib/photo-utils'
import type { Photo } from '@/lib/types'
import * as timezone from '@/lib/timezone'

const reviewPhotos = vi.hoisted(() => vi.fn())

vi.mock('@/lib/photo-utils', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/photo-utils')>(),
  extractEXIF: vi.fn(async () => ({})),
  preparePhotoImage: vi.fn(async (file: File) => ({
    image: file,
    thumbnail: 'data:image/jpeg;base64,fixture',
  })),
  computeFileHash: vi.fn(async (file: File) => `hash-${file.name}`),
}))

vi.mock('@/components/flows/OutingReview', () => ({
  default: ({ cluster }: { cluster: { photos: Photo[] } }) => {
    reviewPhotos(cluster.photos)
    return <div>Photos ({cluster.photos.length})</div>
  },
}))

function createDataStore(): WingDexDataStore {
  return {
    isLoading: false,
    photos: [],
    outings: [],
    observations: [],
    dex: [],
    addPhotos: vi.fn(),
    addOuting: vi.fn(),
    updateOuting: vi.fn(),
    deleteOuting: vi.fn(),
    addObservations: vi.fn(),
    updateObservation: vi.fn(),
    bulkUpdateObservations: vi.fn(),
    updateDex: vi.fn(() => ({ newSpeciesCount: 0 })),
    getOutingObservations: vi.fn(() => []),
    getOutingPhotos: vi.fn(() => []),
    getDexEntry: vi.fn(),
    importDexEntries: vi.fn(),
    clearAllData: vi.fn(),
    refresh: vi.fn(async () => undefined),
  }
}

function createFileList(count: number): FileList {
  const files = Array.from(
    { length: count },
    (_, index) => new File([String(index)], `bird-${index}.jpg`, { type: 'image/jpeg' }),
  )
  const fileList = Object.create(FileList.prototype) as FileList
  Object.defineProperties(fileList, {
    length: { value: files.length },
    item: { value: (index: number) => files[index] ?? null },
    [Symbol.iterator]: { value: files[Symbol.iterator].bind(files) },
  })
  files.forEach((file, index) => {
    Object.defineProperty(fileList, index, { value: file })
  })
  return fileList
}

describe('AddPhotosFlow upload', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // Vitest restores vi.fn(impl) defaults here; clearAllMocks would leave
    // per-test implementation overrides behind when cases run shuffled.
    vi.resetAllMocks()
  })

  it('carries a 200-photo FileList into outing review without truncation', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(file => `blob:${(file as File).name}`)
    render(
      <AddPhotosFlow
        data={createDataStore()}
        onClose={vi.fn()}
        ensureSessionReady={vi.fn(async () => true)}
        userId="user-1"
      />,
    )
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    const files = createFileList(200)

    expect(files).toBeInstanceOf(FileList)
    fireEvent.change(input!, { target: { files } })

    await waitFor(() => {
      expect(screen.getByText('Photos (200)')).toBeInTheDocument()
    })
  })

  it('uses the prepared JPEG for display/ID while retaining RAW metadata and hash', async () => {
    const raw = new File(['raw sensor bytes'], 'camera.ARW')
    const preview = new Blob(['rendered pixels'], { type: 'image/jpeg' })
    vi.mocked(preparePhotoImage).mockResolvedValueOnce({ image: preview, thumbnail: 'thumbnail' })
    vi.mocked(extractEXIF).mockResolvedValueOnce({ timestamp: '2026-08-01 12:00:00' })
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rendered-preview')
    render(
      <AddPhotosFlow data={createDataStore()} onClose={vi.fn()}
        ensureSessionReady={vi.fn(async () => true)} userId="user-1" />,
    )
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [raw] } })
    await waitFor(() => expect(screen.getByText('Photos (1)')).toBeInTheDocument())
    expect(createUrl).toHaveBeenCalledWith(preview)
    expect(extractEXIF).toHaveBeenCalledWith(raw)
    expect(computeFileHash).toHaveBeenCalledWith(raw)
    expect(reviewPhotos).toHaveBeenLastCalledWith([expect.objectContaining({
      fileName: 'camera.ARW',
      fileHash: 'hash-camera.ARW',
      exifTime: '2026-08-01 12:00:00',
      dataUrl: 'blob:rendered-preview',
      thumbnail: 'thumbnail',
    })])
  })

  it('still detects an imported RAW after substituting its rendered image', async () => {
    const raw = new File(['raw sensor bytes'], 'camera.ARW')
    vi.mocked(preparePhotoImage).mockResolvedValueOnce({
      image: new Blob(['rendered pixels'], { type: 'image/jpeg' }),
      thumbnail: 'thumbnail',
    })
    vi.mocked(extractEXIF).mockResolvedValueOnce({ timestamp: '2026-08-01 12:00:00' })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rendered-preview')
    const data = createDataStore()
    data.photos = [{
      fileHash: 'hash-camera.ARW',
      exifTime: '2026-08-01 12:00:00',
    } as Photo]
    render(
      <AddPhotosFlow data={data} onClose={vi.fn()}
        ensureSessionReady={vi.fn(async () => true)} userId="user-1" />,
    )
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [raw] } })
    await waitFor(() => expect(screen.getByText('Duplicate photos found')).toBeInTheDocument())
    expect(computeFileHash).toHaveBeenCalledWith(raw)
  })

  it('reports an unsupported photo and continues importing the readable photos', async () => {
    const error = new PhotoDecodeError()
    vi.mocked(preparePhotoImage).mockRejectedValueOnce(error)
    const notify = vi.spyOn(toast, 'error').mockReturnValue('error-toast')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:readable-photo')
    const onClose = vi.fn()
    render(
      <AddPhotosFlow data={createDataStore()} onClose={onClose}
        ensureSessionReady={vi.fn(async () => true)} userId="user-1" />,
    )
    const bad = new File(['unsupported'], 'unsupported.raw')
    const good = new File(['jpeg'], 'readable.jpg', { type: 'image/jpeg' })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [bad, good] } })
    await waitFor(() => expect(screen.getByText('Photos (1)')).toBeInTheDocument())
    expect(notify).toHaveBeenCalledWith(`unsupported.raw: ${error.message}`)
    expect(vi.mocked(computeFileHash).mock.calls.some(([file]) => file === bad)).toBe(false)
    expect(reviewPhotos).toHaveBeenLastCalledWith([expect.objectContaining({ fileName: 'readable.jpg' })])
    expect(onClose).not.toHaveBeenCalled()
  })

  it.each([new PhotoDecodeError(), new Error('File read failed')])(
    'keeps the picker usable after a failed batch (%s)', async error => {
      vi.mocked(preparePhotoImage).mockRejectedValueOnce(error)
      const notify = vi.spyOn(toast, 'error').mockReturnValue('error-toast')
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:retry-photo')
      const onClose = vi.fn()
      render(
        <AddPhotosFlow data={createDataStore()} onClose={onClose}
          ensureSessionReady={vi.fn(async () => true)} userId="user-1" />,
      )
      fireEvent.change(document.querySelector('input[type="file"]')!, {
        target: { files: [new File(['bad'], 'unreadable.raw')] },
      })
      await waitFor(() => expect(notify).toHaveBeenCalledTimes(1))
      expect(notify).toHaveBeenCalledWith(error instanceof PhotoDecodeError
        ? `unreadable.raw: ${error.message}`
        : 'unreadable.raw: Could not read or process this photo. Try again.')
      await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull())
      expect(onClose).not.toHaveBeenCalled()
      fireEvent.change(document.querySelector('input[type="file"]')!, {
        target: { files: [new File(['jpeg'], 'retry.jpg', { type: 'image/jpeg' })] },
      })
      await waitFor(() => expect(screen.getByText('Photos (1)')).toBeInTheDocument())
    },
  )

  it('releases a prepared image when later metadata processing fails', async () => {
    vi.mocked(extractEXIF).mockResolvedValueOnce({
      timestamp: 'invalid date', gps: { lat: 47.61, lon: -122.33 },
    })
    vi.spyOn(timezone, 'toLocalISOWithOffset').mockImplementation(() => {
      throw new RangeError('Invalid metadata date')
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed-photo')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const notify = vi.spyOn(toast, 'error').mockReturnValue('error-toast')
    render(
      <AddPhotosFlow data={createDataStore()} onClose={vi.fn()}
        ensureSessionReady={vi.fn(async () => true)} userId="user-1" />,
    )
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['image'], 'bad-metadata.raw')] },
    })
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1))
    expect(revoke).toHaveBeenCalledWith('blob:failed-photo')
    await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull())
  })

  it('clears file input value so selecting the same file again triggers change', async () => {
    vi.mocked(preparePhotoImage).mockRejectedValue(new PhotoDecodeError())
    render(
      <AddPhotosFlow data={createDataStore()} onClose={vi.fn()}
        ensureSessionReady={vi.fn(async () => true)} userId="user-1" />,
    )
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    const badFile = new File(['bad'], 'test.raw')
    fireEvent.change(input, { target: { files: [badFile] } })
    await waitFor(() => expect(input.value).toBe(''))
  })
})
