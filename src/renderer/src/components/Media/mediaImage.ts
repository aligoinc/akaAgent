export const IMAGE_FILE_EXTENSION_RE = /\.(apng|avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)(?:[?#].*)?$/i

export const isImageMimeType = (mimeType: unknown): boolean =>
  String(mimeType || '').trim().toLowerCase().startsWith('image/')

export const isImageMediaSource = (mimeType: unknown, ...sources: unknown[]): boolean => {
  if (isImageMimeType(mimeType)) return true
  return sources.some(source => {
    const value = String(source || '').trim()
    return /^data:image\//i.test(value) || IMAGE_FILE_EXTENSION_RE.test(value)
  })
}
