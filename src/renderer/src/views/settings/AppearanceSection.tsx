import * as Tabs from '@radix-ui/react-tabs'
import { Check, FolderOpen, RotateCcw, Search, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { CODE_THEME_IDS, DEFAULT_SETTINGS, type AppSettings, type CodeThemeId } from '@shared/types'
import { BackgroundVideo } from '../../components/BackgroundVideo'
import { CodeView } from '../../components/code/CodeView'
import { Banner, Button, Field, Select, Switch } from '../../components/ui'
import { applyAppearance } from '../../lib/appearance'
import { contrastRatio, isHexColor } from '../../lib/colors'
import { errorMessage } from '../../lib/format'
import {
  ACCENT_PRESETS,
  MONO_FONT_OPTIONS,
  UI_FONT_OPTIONS,
  type FontOption
} from '../../lib/labels'
import { THEMES, themeById, themeTokens, type ThemeDefinition } from '../../lib/themes'
import { useApp } from '../../state/app-context'
import { invoke, useAction } from '../../state/hooks'
import { toast } from '../../state/toasts'
import { SettingsGroup as Group } from './SettingsGroup'

const MIN_FONT_SIZE = 12
const MAX_FONT_SIZE = 18
const MIN_CODE_SIZE = 11
const MAX_CODE_SIZE = 18
const MIN_WINDOW_OPACITY = 40
const MAX_WINDOW_OPACITY = 100
const MIN_ACCENT_CONTRAST = 3
const CUSTOM_FONT = 'custom'

const CODE_SAMPLE = `// Greets each person once
export async function greet(names: string[]) {
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) continue
    seen.add(name)
    await send(\`Hello, \${name}!\`, { retries: 3 })
  }
}`

function RangeField({
  label,
  value,
  min,
  max,
  unit,
  onChange,
  onCommit
}: {
  label: string
  value: number
  min: number
  max: number
  unit: string
  onChange(value: number): void
  /** Runs when the slider is released, for changes too heavy to make while dragging. */
  onCommit?(value: number): void
}): ReactNode {
  return (
    <Field label={`${label}: ${value}${unit}`}>
      {(id) => (
        <input
          id={id}
          className="range"
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          onPointerUp={(event) => onCommit?.(Number(event.currentTarget.value))}
          onKeyUp={(event) => onCommit?.(Number(event.currentTarget.value))}
        />
      )}
    </Field>
  )
}

function FontField({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: FontOption[]
  onChange(value: string): void
}): ReactNode {
  const preset = options.find((option) => option.value === value)
  const [custom, setCustom] = useState(!preset)
  return (
    <Field label={label}>
      {(id) => (
        <div className="stack-small">
          <Select
            id={id}
            value={custom ? CUSTOM_FONT : (preset?.value ?? CUSTOM_FONT)}
            options={[
              ...options.map(({ label: name, value: font }) => ({ value: font, label: name })),
              { value: CUSTOM_FONT, label: 'Custom' }
            ]}
            onChange={(next) => {
              setCustom(next === CUSTOM_FONT)
              if (next !== CUSTOM_FONT) onChange(next)
            }}
          />
          {custom && (
            <input
              className="input"
              aria-label={`${label} name`}
              placeholder="Any font installed on this computer"
              spellCheck={false}
              value={value}
              onChange={(event) => onChange(event.target.value)}
            />
          )}
        </div>
      )}
    </Field>
  )
}

function ThemeCard({
  theme,
  selected,
  onPreview,
  onSelect
}: {
  theme: ThemeDefinition
  selected: boolean
  onPreview(active: boolean): void
  onSelect(): void
}): ReactNode {
  // The card carries the tokens of its theme, so the miniature is drawn with real colors.
  const style = useMemo(() => themeTokens(theme) as CSSProperties, [theme])
  return (
    <button
      type="button"
      className={selected ? 'theme-card theme-card-on' : 'theme-card'}
      aria-pressed={selected}
      aria-label={theme.label}
      onMouseEnter={() => onPreview(true)}
      onMouseLeave={() => onPreview(false)}
      onFocus={() => onPreview(true)}
      onBlur={() => onPreview(false)}
      onClick={onSelect}
    >
      <span className="theme-mini" style={style} aria-hidden="true">
        <span className="theme-mini-side">
          <span className="theme-mini-dot" />
          <span className="theme-mini-line" />
          <span className="theme-mini-line theme-mini-short" />
          <span className="theme-mini-line" />
        </span>
        <span className="theme-mini-main">
          <span className="theme-mini-bubble" />
          <span className="theme-mini-text" />
          <span className="theme-mini-text theme-mini-short" />
          <span className="theme-mini-code">
            <span style={{ background: theme.accent }} />
            <span style={{ background: theme.warning }} />
            <span style={{ background: theme.danger }} />
          </span>
          <span className="theme-mini-composer">
            <span className="theme-mini-send" />
          </span>
        </span>
      </span>
      <span className="theme-card-name">
        {theme.label}
        {selected && <Check size={14} aria-hidden />}
      </span>
    </button>
  )
}

function ThemeGallery(): ReactNode {
  const { settings, updateSettings } = useApp()
  const [query, setQuery] = useState('')

  const preview = (id: ThemeDefinition['id'], active: boolean): void =>
    applyAppearance(active ? { ...settings, theme: id } : settings)

  useEffect(() => () => applyAppearance(settings), [settings])

  const needle = query.trim().toLowerCase()
  const matches = THEMES.filter(({ label }) => label.toLowerCase().includes(needle))
  const groups = [
    { title: 'Dark', themes: matches.filter(({ mode }) => mode === 'dark') },
    { title: 'Light', themes: matches.filter(({ mode }) => mode === 'light') }
  ]

  return (
    <Group title="Choose a theme" description="Hover a theme to try it. Click to keep it.">
      <div className="search-field">
        <Search size={14} aria-hidden />
        <input
          aria-label="Search themes"
          placeholder="Search themes"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {matches.length === 0 && <p className="hint">No theme matches "{query}".</p>}
      {groups.map(
        ({ title, themes }) =>
          themes.length > 0 && (
            <div key={title} className="stack-small">
              <h3 className="group-label">{title}</h3>
              <div className="theme-gallery">
                {themes.map((theme) => (
                  <ThemeCard
                    key={theme.id}
                    theme={theme}
                    selected={settings.theme === theme.id}
                    onPreview={(active) => preview(theme.id, active)}
                    onSelect={() => void updateSettings({ theme: theme.id })}
                  />
                ))}
              </div>
            </div>
          )
      )}
    </Group>
  )
}

function AccentPicker(): ReactNode {
  const { settings, updateSettings } = useApp()
  const theme = themeById(settings.theme)
  const current = settings.accentColor ?? theme.accent
  const [typed, setTyped] = useState(current)
  useEffect(() => setTyped(current), [current])

  const choose = (color: string): void => {
    setTyped(color)
    if (isHexColor(color)) void updateSettings({ accentColor: color.toLowerCase() })
  }
  const lowContrast = contrastRatio(current, theme.bg) < MIN_ACCENT_CONTRAST

  return (
    <Group title="Accent color" description="Used for primary buttons, focus and selection.">
      <div className="accent-row">
        {ACCENT_PRESETS.map(({ label, color }) => (
          <button
            key={color}
            type="button"
            className={
              settings.accentColor === color ? 'accent-swatch accent-swatch-on' : 'accent-swatch'
            }
            style={{ background: color }}
            aria-label={label}
            aria-pressed={settings.accentColor === color}
            onClick={() => choose(color)}
          />
        ))}
        <input
          className="accent-custom"
          type="color"
          aria-label="Custom accent color"
          value={isHexColor(current) ? current : theme.accent}
          onChange={(event) => choose(event.target.value)}
        />
        <input
          className="input input-mono accent-hex"
          aria-label="Accent color hex value"
          spellCheck={false}
          aria-invalid={!isHexColor(typed)}
          value={typed}
          onChange={(event) => choose(event.target.value)}
        />
        <Button
          variant="ghost"
          icon={RotateCcw}
          disabled={settings.accentColor === null}
          onClick={() => void updateSettings({ accentColor: null })}
        >
          Reset
        </Button>
      </div>
      {lowContrast && (
        <Banner tone="warning">This color is hard to see on the {theme.label} background.</Banner>
      )}
    </Group>
  )
}

function CodeSection(): ReactNode {
  const { settings, updateSettings } = useApp()
  const { code } = settings
  const update = (patch: Partial<AppSettings['code']>): void =>
    void updateSettings({ code: { ...code, ...patch } })

  const options = CODE_THEME_IDS.map((id) => ({
    value: id,
    label: id === 'auto' ? 'Auto, matches the app' : themeById(id).label
  }))

  return (
    <>
      <div className="code-sample">
        <CodeView code={CODE_SAMPLE} language="typescript" />
      </div>
      <Group title="Code">
        <div className="grid-two">
          <Field label="Code theme">
            {(id) => (
              <Select
                id={id}
                value={code.theme}
                options={options}
                onChange={(theme) => update({ theme: theme as CodeThemeId })}
              />
            )}
          </Field>
          <FontField
            label="Code font"
            value={settings.monoFont}
            options={MONO_FONT_OPTIONS}
            onChange={(monoFont) => void updateSettings({ monoFont })}
          />
        </div>
        <RangeField
          label="Code size"
          value={code.fontSize}
          min={MIN_CODE_SIZE}
          max={MAX_CODE_SIZE}
          unit="px"
          onChange={(fontSize) => update({ fontSize })}
        />
        <Switch
          label="Line numbers"
          checked={code.lineNumbers}
          onChange={(lineNumbers) => update({ lineNumbers })}
        />
        <Switch
          label="Wrap long lines"
          checked={code.wrapLines}
          onChange={(wrapLines) => update({ wrapLines })}
        />
        <Switch
          label="Ligatures"
          hint="Joins symbols such as => into one glyph, when the font has them."
          checked={code.ligatures}
          onChange={(ligatures) => update({ ligatures })}
        />
      </Group>
    </>
  )
}

function BackgroundSection(): ReactNode {
  const { settings, updateSettings } = useApp()
  const { backgroundVideo, reduceMotion } = settings
  const [failed, setFailed] = useState(false)
  const { busy, run } = useAction()
  const update = (patch: Partial<AppSettings['backgroundVideo']>): void =>
    void updateSettings({ backgroundVideo: { ...backgroundVideo, ...patch } })

  useEffect(() => setFailed(false), [backgroundVideo.customFile])

  const choose = (): Promise<unknown> =>
    run(async () => {
      try {
        const customFile = await invoke('app.pickBackgroundVideo', undefined)
        if (customFile) {
          update({ customFile })
          toast.success('Background video updated.')
        }
      } catch (error) {
        toast.error(errorMessage(error))
      }
    })

  return (
    <>
      <div className="video-preview">
        {backgroundVideo.enabled && (
          <BackgroundVideo
            settings={backgroundVideo}
            active
            reduceMotion={reduceMotion}
            onError={() => setFailed(true)}
          />
        )}
        <div className="video-preview-sample">
          <span className="video-preview-bubble">Why does the job runner retry twice?</span>
          <span className="video-preview-text">
            The retry comes from startJob. The second call runs after catch up.
          </span>
        </div>
      </div>
      {failed && (
        <Banner tone="error">
          This video could not be played. Try an H.264 MP4 or a WebM file.
        </Banner>
      )}
      <Group title="Background">
        <Switch
          label="Show a video behind Home and chats"
          checked={backgroundVideo.enabled}
          onChange={(enabled) => update({ enabled })}
        />
        <RangeField
          label="Video opacity"
          value={backgroundVideo.opacity}
          min={0}
          max={100}
          unit="%"
          onChange={(opacity) => update({ opacity })}
        />
        <RangeField
          label="Blur"
          value={backgroundVideo.blur}
          min={0}
          max={24}
          unit="px"
          onChange={(blur) => update({ blur })}
        />
        <div className="row">
          <Button icon={FolderOpen} disabled={busy} onClick={() => void choose()}>
            Choose video
          </Button>
          <Button
            variant="ghost"
            icon={RotateCcw}
            disabled={
              backgroundVideo.customFile === null &&
              backgroundVideo.opacity === DEFAULT_SETTINGS.backgroundVideo.opacity &&
              backgroundVideo.blur === DEFAULT_SETTINGS.backgroundVideo.blur
            }
            onClick={() => update({ ...DEFAULT_SETTINGS.backgroundVideo, enabled: true })}
          >
            Reset to default
          </Button>
        </div>
        <p className="hint">
          MP4 or WebM, up to 200 MB. With reduced motion it shows a still frame.
        </p>
      </Group>
    </>
  )
}

function WindowSection(): ReactNode {
  const { info, settings, updateSettings } = useApp()
  const [opacity, setOpacity] = useState(settings.windowOpacity)
  useEffect(() => setOpacity(settings.windowOpacity), [settings.windowOpacity])

  return (
    <>
      <Group
        title="Window transparency"
        description="Lets your desktop show through the background. Text stays solid."
      >
        <RangeField
          label="Window opacity"
          value={opacity}
          min={MIN_WINDOW_OPACITY}
          max={MAX_WINDOW_OPACITY}
          unit="%"
          onChange={(value) => {
            setOpacity(value)
            // Only a window that is already see-through can follow the slider while it moves.
            if (settings.windowOpacity < 100 && value < 100) {
              applyAppearance({ ...settings, windowOpacity: value })
            }
          }}
          onCommit={(value) => {
            if (value !== settings.windowOpacity) void updateSettings({ windowOpacity: value })
          }}
        />
        <p className="hint">
          Moving between 100% and anything lower reopens the window once. Running work keeps going.
        </p>
        {info.transparency === 'unknown' && (
          <p className="usage-note">
            <TriangleAlert size={14} aria-hidden />
            On Linux with X11 this needs a compositor. If the background stays solid, your desktop
            does not support it.
          </p>
        )}
      </Group>
      <Group title="Motion">
        <Switch
          label="Reduce motion"
          hint="Turns off transitions and pulsing indicators, and holds the background video still."
          checked={settings.reduceMotion}
          onChange={(reduceMotion) => void updateSettings({ reduceMotion })}
        />
      </Group>
    </>
  )
}

function FontsGroup(): ReactNode {
  const { settings, updateSettings } = useApp()
  return (
    <Group title="Interface text">
      <div className="grid-two">
        <FontField
          label="Interface font"
          value={settings.uiFont}
          options={UI_FONT_OPTIONS}
          onChange={(uiFont) => void updateSettings({ uiFont })}
        />
        <RangeField
          label="Text size"
          value={settings.fontSize}
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          unit="px"
          onChange={(fontSize) => void updateSettings({ fontSize })}
        />
      </div>
    </Group>
  )
}

const TABS = [
  { id: 'theme', label: 'Theme' },
  { id: 'code', label: 'Code' },
  { id: 'background', label: 'Background' },
  { id: 'window', label: 'Window' }
]

export function AppearanceSection(): ReactNode {
  const [tab, setTab] = useState('theme')
  return (
    <Tabs.Root value={tab} onValueChange={setTab} className="appearance">
      <Tabs.List className="appearance-tabs" aria-label="Appearance sections">
        {TABS.map(({ id, label }) => (
          <Tabs.Trigger key={id} value={id} className="appearance-tab">
            {label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value="theme" className="appearance-panel" tabIndex={-1}>
        <ThemeGallery />
        <AccentPicker />
        <FontsGroup />
      </Tabs.Content>
      <Tabs.Content value="code" className="appearance-panel" tabIndex={-1}>
        <CodeSection />
      </Tabs.Content>
      <Tabs.Content value="background" className="appearance-panel" tabIndex={-1}>
        <BackgroundSection />
      </Tabs.Content>
      <Tabs.Content value="window" className="appearance-panel" tabIndex={-1}>
        <WindowSection />
      </Tabs.Content>
    </Tabs.Root>
  )
}
