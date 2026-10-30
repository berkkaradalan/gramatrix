import * as Popover from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import {
  Check,
  ChevronDown,
  CircleAlert,
  Plus,
  RefreshCw,
  Search,
  Star,
  WrenchOff
} from 'lucide-react'
import { memo, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ModelInfo, ModelRef, ProviderId, ProviderStatus } from '@shared/types'
import {
  formatContext,
  formatPrice,
  modelKey,
  sameModel,
  searchModels,
  shortModelName,
  toggleModel
} from '../lib/models'
import { useApp } from '../state/app-context'
import { modelStore, useModelEntries, type ModelEntry } from '../state/model-store'
import { useOverlays } from '../state/overlays'
import { ProviderLogo } from './ProviderLogo'
import { Badge, Skeleton, Tooltip } from './ui'

/** Rows rendered per provider before "show all", so huge lists stay fast. */
const GROUP_LIMIT = 40
const SEARCH_GROUP_LIMIT = 30
const RECENT_LIMIT = 5

function unknownModel(id: string): ModelInfo {
  return {
    id,
    name: shortModelName(id),
    contextWindow: null,
    inputPrice: null,
    outputPrice: null,
    supportsTools: true,
    supportsReasoning: false
  }
}

export function findModel(entries: ReadonlyMap<ProviderId, ModelEntry>, ref: ModelRef): ModelInfo {
  const known = entries.get(ref.provider)?.list?.models.find((model) => model.id === ref.model)
  return known ?? unknownModel(ref.model)
}

const ModelRow = memo(function ModelRow({
  provider,
  model,
  favorite,
  selected,
  group,
  showLogo,
  onSelect,
  onToggleFavorite
}: {
  provider: ProviderStatus
  model: ModelInfo
  favorite: boolean
  selected: boolean
  group: string
  /** Pinned rows show their provider. Rows under a provider heading do not need to. */
  showLogo?: boolean
  onSelect(ref: ModelRef): void
  onToggleFavorite(ref: ModelRef): void
}): ReactNode {
  const ref = { provider: provider.id, model: model.id }
  const price = formatPrice(model)
  return (
    <Command.Item
      className="model-row"
      value={`${group}:${modelKey(ref)}`}
      onSelect={() => onSelect(ref)}
    >
      {showLogo && <ProviderLogo logo={provider.logo} size={14} />}
      <span className="model-row-name" title={model.id}>
        {model.name}
      </span>
      {selected && <Check className="model-row-check" size={14} aria-label="Selected" />}
      {!model.supportsTools && (
        <Tooltip label="No tool support. This model cannot edit files or run commands.">
          <span className="model-row-warning">
            <WrenchOff size={13} aria-label="No tool support" />
          </span>
        </Tooltip>
      )}
      <span className="model-row-context">{formatContext(model.contextWindow)}</span>
      <span className="model-row-price">
        {provider.kind === 'plan' ? <Badge>Plan</Badge> : price}
      </span>
      <button
        type="button"
        className={favorite ? 'model-star model-star-on' : 'model-star'}
        aria-label={favorite ? `Remove ${model.name} from favorites` : `Favorite ${model.name}`}
        aria-pressed={favorite}
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onToggleFavorite(ref)
        }}
      >
        <Star size={14} aria-hidden fill={favorite ? 'currentColor' : 'none'} />
      </button>
    </Command.Item>
  )
})

function GroupStatus({
  provider,
  entry
}: {
  provider: ProviderStatus
  entry: ModelEntry
}): ReactNode {
  const refresh = (): void => void modelStore.load(provider.id, true)
  if (entry.error && !entry.list) {
    return (
      <div className="model-group-status">
        <CircleAlert size={13} aria-hidden />
        <span>Could not load models.</span>
        <button type="button" className="link" onClick={refresh}>
          Try again
        </button>
      </div>
    )
  }
  if (entry.list && entry.list.source !== 'live') {
    return (
      <div className="model-group-status">
        <span>Saved list. Live models were not reachable.</span>
        <button type="button" className="link" onClick={refresh}>
          <RefreshCw size={12} aria-hidden /> Refresh
        </button>
      </div>
    )
  }
  return null
}

function ProviderGroup({
  provider,
  entry,
  query,
  value,
  favorites,
  onSelect,
  onToggleFavorite
}: {
  provider: ProviderStatus
  entry: ModelEntry
  query: string
  value: ModelRef | null
  favorites: ModelRef[]
  onSelect(ref: ModelRef): void
  onToggleFavorite(ref: ModelRef): void
}): ReactNode {
  const [showAll, setShowAll] = useState(false)
  const models = useMemo(() => {
    const list = entry.list?.models ?? []
    return query ? searchModels(list, query) : list
  }, [entry.list, query])

  if (query && models.length === 0) return null
  const limit = query ? SEARCH_GROUP_LIMIT : showAll ? models.length : GROUP_LIMIT
  const visible = models.slice(0, limit)
  const hidden = models.length - visible.length
  const ref = (model: ModelInfo): ModelRef => ({ provider: provider.id, model: model.id })

  return (
    <Command.Group
      heading={
        <span className="model-group-heading">
          <ProviderLogo logo={provider.logo} size={12} />
          {provider.label}
          <span className="model-group-count">{entry.list ? models.length : ''}</span>
        </span>
      }
    >
      {entry.loading && !entry.list && <Skeleton rows={3} />}
      <GroupStatus provider={provider} entry={entry} />
      {visible.map((model) => (
        <ModelRow
          key={model.id}
          group={provider.id}
          provider={provider}
          model={model}
          favorite={favorites.some((item) => sameModel(item, ref(model)))}
          selected={sameModel(value, ref(model))}
          onSelect={onSelect}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
      {hidden > 0 && !query && (
        <Command.Item
          className="model-row model-row-more"
          value={`more:${provider.id}`}
          onSelect={() => setShowAll(true)}
        >
          Show {hidden} more models
        </Command.Item>
      )}
      {hidden > 0 && query && (
        <p className="model-group-status">{hidden} more matches. Refine your search.</p>
      )}
    </Command.Group>
  )
}

function PickerBody({
  value,
  onSelect,
  onConnect
}: {
  value: ModelRef | null
  onSelect(ref: ModelRef): void
  onConnect(): void
}): ReactNode {
  const { providers, settings, updateSettings } = useApp()
  const entries = useModelEntries()
  const [search, setSearch] = useState('')
  const query = useDeferredValue(search.trim())
  const connected = useMemo(() => providers.filter(({ configured }) => configured), [providers])
  const { favoriteModels, recentModels } = settings

  const providerFor = (ref: ModelRef): ProviderStatus | undefined =>
    connected.find(({ id }) => id === ref.provider)

  const toggleFavorite = (ref: ModelRef): void =>
    void updateSettings({ favoriteModels: toggleModel(favoriteModels, ref) })

  const pinnedRow = (ref: ModelRef, group: string): ReactNode => {
    const provider = providerFor(ref)
    if (!provider) return null
    return (
      <ModelRow
        key={modelKey(ref)}
        group={group}
        provider={provider}
        model={findModel(entries, ref)}
        favorite={favoriteModels.some((item) => sameModel(item, ref))}
        selected={sameModel(value, ref)}
        showLogo
        onSelect={onSelect}
        onToggleFavorite={toggleFavorite}
      />
    )
  }

  const usableFavorites = favoriteModels.filter((ref) => providerFor(ref))
  const usableRecents = recentModels
    .filter((ref) => providerFor(ref) && !favoriteModels.some((item) => sameModel(item, ref)))
    .slice(0, RECENT_LIMIT)
  const anyMatch = connected.some(
    (provider) => searchModels(entries.get(provider.id)?.list?.models ?? [], query).length > 0
  )

  return (
    <Command className="model-picker" shouldFilter={false} loop label="Choose a model">
      <div className="model-search">
        <Search size={14} aria-hidden />
        <Command.Input
          value={search}
          onValueChange={setSearch}
          placeholder="Search models"
          aria-label="Search models"
        />
      </div>
      <Command.List className="model-list">
        {!query && usableFavorites.length > 0 && (
          <Command.Group heading={<span className="model-group-heading">Favorites</span>}>
            {usableFavorites.map((ref) => pinnedRow(ref, 'favorite'))}
          </Command.Group>
        )}
        {!query && usableRecents.length > 0 && (
          <Command.Group heading={<span className="model-group-heading">Recent</span>}>
            {usableRecents.map((ref) => pinnedRow(ref, 'recent'))}
          </Command.Group>
        )}
        {connected.map((provider) => (
          <ProviderGroup
            key={provider.id}
            provider={provider}
            entry={entries.get(provider.id) ?? { list: null, loading: true, error: null }}
            query={query}
            value={value}
            favorites={favoriteModels}
            onSelect={onSelect}
            onToggleFavorite={toggleFavorite}
          />
        ))}
        {query && !anyMatch && <p className="model-empty">No models match "{query}".</p>}
        {query && (!anyMatch || !/\s/.test(query)) && (
          <Command.Group heading={<span className="model-group-heading">Use a custom id</span>}>
            {connected.map((provider) => (
              <Command.Item
                key={provider.id}
                className="model-row"
                value={`custom:${provider.id}`}
                onSelect={() => onSelect({ provider: provider.id, model: query })}
              >
                <ProviderLogo logo={provider.logo} size={14} />
                <span className="model-row-name">
                  Use <span className="mono">{query}</span> with {provider.label}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {connected.length === 0 && <p className="model-empty">No provider is connected yet.</p>}
      </Command.List>
      <footer className="model-footer">
        <button type="button" className="link-quiet" onClick={onConnect}>
          <Plus size={14} aria-hidden />
          Connect more providers
        </button>
        <span className="model-footer-note">Context, price per 1M tokens in / out</span>
      </footer>
    </Command>
  )
}

/** Searchable model list in a popover. The trigger shows the current logo and short name. */
export function ModelPicker({
  value,
  onChange,
  id,
  ariaLabel = 'Model',
  align = 'start',
  block,
  placeholder = 'Choose a model'
}: {
  value: ModelRef | null
  onChange(model: ModelRef): void
  id?: string
  ariaLabel?: string
  align?: 'start' | 'end' | 'center'
  /** Fills its container, for use as a form field. */
  block?: boolean
  placeholder?: string
}): ReactNode {
  const { providers, reloadProviders } = useApp()
  const { openProviders } = useOverlays()
  const entries = useModelEntries()
  const [open, setOpen] = useState(false)
  const connectedIds = providers
    .filter(({ configured }) => configured)
    .map((provider) => provider.id)
    .join(',')

  useEffect(() => {
    if (open) void reloadProviders()
  }, [open, reloadProviders])

  useEffect(() => {
    if (!open && !value) return
    const ids = open ? connectedIds.split(',').filter(Boolean) : value ? [value.provider] : []
    for (const provider of ids) void modelStore.load(provider as ProviderId)
  }, [open, connectedIds, value])

  const provider = providers.find(({ id: candidate }) => candidate === value?.provider)
  const name = value ? findModel(entries, value).name : placeholder

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          className={block ? 'chip chip-block' : 'chip'}
          aria-label={value ? `${ariaLabel}: ${name}` : ariaLabel}
        >
          {provider && <ProviderLogo logo={provider.logo} size={14} />}
          <span className="chip-label">{name}</span>
          <ChevronDown size={13} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="popover model-popover"
          align={align}
          sideOffset={6}
          collisionPadding={12}
        >
          <PickerBody
            value={value}
            onSelect={(ref) => {
              onChange(ref)
              setOpen(false)
            }}
            onConnect={() => {
              setOpen(false)
              openProviders()
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
