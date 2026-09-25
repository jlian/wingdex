import { Camera } from '@phosphor-icons/react'
import './upload-identify-button.css'

export function UploadIdentifyButton({ onClick, onIntent }: { onClick?: () => void; onIntent?: () => void }) {
  return (
    <button type="button" className="upload-identify-button" onClick={onClick}
      onPointerDown={onIntent} onMouseEnter={onIntent} onFocus={onIntent} onTouchStart={onIntent}>
      <span className="upload-identify-icon" aria-hidden="true"><Camera size={20} /></span>
      <span>Identify Birds</span>
    </button>
  )
}
