// The pace of the tour lives in site.css: the progress line under the selected tab is an animation,
// and the end of that animation selects the next tab. Pausing the line pauses the tour.

export function startFeatureTour(tour: HTMLElement): void {
  const tabs = [...tour.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const panels = [...tour.querySelectorAll<HTMLElement>('[role="tabpanel"]')]
  let active = 0

  const select = (index: number): void => {
    active = (index + tabs.length) % tabs.length
    tabs.forEach((tab, position) => {
      const selected = position === active
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
      panels[position].dataset.active = String(selected)
    })
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

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  tour.dataset.rotating = 'true'
  new IntersectionObserver(
    ([entry]) => {
      tour.dataset.visible = String(entry.isIntersecting)
    },
    { threshold: 0.4 }
  ).observe(tour)
}
