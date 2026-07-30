import { useCallback, useState, type DragEvent } from 'react'

type Props = {
  onFile: (file: File) => void
  disabled?: boolean
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml'

export function Dropzone({ onFile, disabled }: Props) {
  const [active, setActive] = useState(false)

  const takeFile = useCallback(
    (file: File | undefined | null) => {
      if (!file || disabled) return
      if (!file.type.startsWith('image/')) return
      onFile(file)
    },
    [disabled, onFile],
  )

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    setActive(false)
    takeFile(e.dataTransfer.files?.[0])
  }

  return (
    <label
      className={`dropzone ${active ? 'active' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault()
        if (!disabled) setActive(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setActive(false)}
      onDrop={onDrop}
    >
      <strong>Drop an image</strong>
      <p>or click to upload PNG, JPG, WebP</p>
      <input
        type="file"
        accept={ACCEPT}
        hidden
        disabled={disabled}
        onChange={(e) => {
          takeFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </label>
  )
}
