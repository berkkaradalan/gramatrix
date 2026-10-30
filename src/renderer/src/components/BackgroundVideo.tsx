import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { BackgroundVideoSettings } from '@shared/types'
import defaultVideo from '../assets/backgrounds/matrix-rain.mp4'
import { useHostEvent } from '../state/hooks'

/** Where a paused still frame is taken from, past any fade in at the start. */
const STILL_FRAME_SECONDS = 1.5

function videoSource(customFile: string | null): string {
  return customFile ? `gramatrix-media://backgrounds/${customFile}` : defaultVideo
}

/** The main process knows for certain, where page visibility can miss a hidden window. */
function useWindowVisible(): boolean {
  const [visible, setVisible] = useState(true)
  useHostEvent('window.visibility', (event) => setVisible(event.visible))
  return visible
}

function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (): void => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

/**
 * The video layer behind Home, chat and the settings preview. It never takes focus, and it only
 * plays while it can be seen. With reduced motion it holds a still frame instead.
 */
export function BackgroundVideo({
  settings,
  active,
  reduceMotion,
  onError
}: {
  settings: BackgroundVideoSettings
  /** False keeps the element loaded but paused, so returning to the screen is instant. */
  active: boolean
  reduceMotion: boolean
  onError?(): void
}): ReactNode {
  const video = useRef<HTMLVideoElement>(null)
  const visible = useWindowVisible()
  const systemReduced = useSystemReducedMotion()
  const still = reduceMotion || systemReduced
  const shouldPlay = active && visible && !still

  useEffect(() => {
    const element = video.current
    if (!element) return
    if (shouldPlay) {
      // Play is refused while a new source loads. `canPlay` below starts it then.
      element.play().catch(() => undefined)
    } else {
      element.pause()
    }
  }, [shouldPlay])

  useEffect(() => {
    const element = video.current
    if (still && element && element.readyState >= 1) element.currentTime = STILL_FRAME_SECONDS
  }, [still])

  return (
    <video
      ref={video}
      className={settings.customFile ? 'backdrop-video' : 'backdrop-video backdrop-video-default'}
      style={
        { opacity: settings.opacity / 100, '--video-blur': `${settings.blur}px` } as CSSProperties
      }
      src={videoSource(settings.customFile)}
      muted
      loop
      playsInline
      preload="auto"
      tabIndex={-1}
      aria-hidden="true"
      disablePictureInPicture
      onLoadedMetadata={(event) => {
        if (still) event.currentTarget.currentTime = STILL_FRAME_SECONDS
      }}
      onCanPlay={(event) => {
        if (shouldPlay) event.currentTarget.play().catch(() => undefined)
      }}
      onError={onError}
    />
  )
}
