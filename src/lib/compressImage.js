export function compressImage(file, { maxDim = 1600, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const width = Math.round(img.width * scale)
      const height = Math.round(img.height * scale)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(objectUrl)

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('이미지 압축에 실패했습니다'))
            return
          }
          const reader = new FileReader()
          reader.onload = () => {
            resolve({
              base64: reader.result.split(',')[1],
              mediaType: 'image/jpeg',
              previewUrl: URL.createObjectURL(blob),
            })
          }
          reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다'))
          reader.readAsDataURL(blob)
        },
        'image/jpeg',
        quality,
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('이미지를 불러오지 못했습니다'))
    }

    img.src = objectUrl
  })
}
