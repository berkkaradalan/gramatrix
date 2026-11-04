// The pace of the tour lives in site.css: the progress line under the selected tab is an animation,
// and the end of that animation selects the next tab. Pausing the line pauses the tour. A video
// panel sets its own pace instead: its line follows the video, and the end of the video moves on.

interface TourVideo {
  /** Plays while the panel is selected and on screen, and starts over each time it is selected. */
  update(selected: boolean, visible: boolean): void
}

/**
 * Connects the video of a panel and its play button. The video has no sound. Pressing pause keeps
 * it paused, and people who prefer less motion start it themselves.
 */
function connectVideo(
  frame: HTMLElement,
  tab: HTMLElement,
  reducedMotion: boolean,
  onEnded: () => void
): TourVideo | undefined {
  const video = frame.querySelector('video')
  const toggle = frame.querySelector<HTMLButtonElement>('[data-tour-video-toggle]')
  if (!video || !toggle) return undefined

  let pausedByPerson = reducedMotion
  let wasSelected = false

  const show = (): void => {
    const playing = !video.paused
    frame.toggleAttribute('data-playing', playing)
    toggle.setAttribute('aria-label', playing ? 'Pause video' : 'Play video')
  }
  video.addEventListener('play', show)
  video.addEventListener('pause', show)
  video.addEventListener('timeupdate', () => {
    if (video.duration)
      tab.style.setProperty('--progress', String(video.currentTime / video.duration))
  })
  video.addEventListener('ended', onEnded)

  // Browsers may refuse to play, for example in power saving mode. The button stays usable then.
  const play = (): void => {
    void video.play().catch(show)
  }

  toggle.addEventListener('click', () => {
    pausedByPerson = !video.paused
    if (pausedByPerson) video.pause()
    else play()
  })

  return {
    update(selected, visible) {
      if (selected && !wasSelected) {
        video.currentTime = 0
        tab.style.setProperty('--progress', '0')
      }
      wasSelected = selected
      if (selected && visible && !pausedByPerson) play()
      else video.pause()
    }
  }
}

export function startFeatureTour(tour: HTMLElement): void {
  const tabs = [...tour.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const panels = [...tour.querySelectorAll<HTMLElement>('[role="tabpanel"]')]
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let active = 0
  let visible = false

  const videos = new Map<number, TourVideo>()
  panels.forEach((panel, position) => {
    const frame = panel.querySelector<HTMLElement>('[data-tour-video]')
    const video =
      frame &&
      connectVideo(frame, tabs[position], reducedMotion, () => {
        // After someone picked a tab, the video stays on its last frame.
        if (tour.dataset.rotating) select(position + 1)
      })
    if (video) videos.set(position, video)
  })

  const updateVideos = (): void => {
    videos.forEach((video, position) => video.update(position === active, visible))
  }

  const select = (index: number): void => {
    active = (index + tabs.length) % tabs.length
    tabs.forEach((tab, position) => {
      const selected = position === active
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
      panels[position].dataset.active = String(selected)
    })
    updateVideos()
  }

  // Once someone picks a tab, the tour stays there so nothing changes while they read.
  const stopRotating = (): void => {
    delete tour.dataset.rotating
  }

  tabs.forEach((tab, position) => {
    tab.addEventListener('click', () => {
      stopRotating()
      select(position)
    })
  })

  tour.querySelector('[role="tablist"]')?.addEventListener('keydown', (event) => {
    const { key } = event as KeyboardEvent
    const targets: Record<string, number> = {
      ArrowRight: active + 1,
      ArrowLeft: active - 1,
      Home: 0,
      End: tabs.length - 1
    }
    if (!(key in targets)) return
    event.preventDefault()
    stopRotating()
    select(targets[key])
    tabs[active].focus()
  })

  tour.addEventListener('animationend', (event) => {
    if (event.animationName === 'tour-progress') select(active + 1)
  })

  // Below the hero only part of the tour shows on a short screen, so it counts as on screen from a
  // quarter on. Videos need to know this even when the tour does not rotate.
  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting
      tour.dataset.visible = String(visible)
      updateVideos()
    },
    { threshold: 0.25 }
  ).observe(tour)

  if (!reducedMotion) tour.dataset.rotating = 'true'
}
