import * as RadixDialog from '@radix-ui/react-dialog'
import * as RadixMenu from '@radix-ui/react-dropdown-menu'
import * as RadixSelect from '@radix-ui/react-select'
import * as RadixSwitch from '@radix-ui/react-switch'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import { Check, ChevronDown, CircleAlert, Copy, Info, TriangleAlert, X } from 'lucide-react'
import {
  forwardRef,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type ReactNode
} from 'react'
import { toast } from '../state/toasts'

type IconType = ComponentType<{ size?: number; 'aria-hidden'?: boolean }>

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  icon?: IconType
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', icon: Icon, className, children, ...props },
  ref
) {
  const classes = ['button', variant !== 'default' && `button-${variant}`, className]
  return (
    <button ref={ref} type="button" className={classes.filter(Boolean).join(' ')} {...props}>
      {Icon && <Icon size={15} aria-hidden />}
      {children}
    </button>
  )
})

export function Tooltip({
  label,
  side,
  children
}: {
  label: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  children: ReactNode
}): ReactNode {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className="tooltip" side={side} sideOffset={6}>
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconType
  label: string
  size?: 'small' | 'medium'
  side?: 'top' | 'right' | 'bottom' | 'left'
}

/** A square button with only an icon. The label becomes its tooltip and accessible name. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 'medium', side, className, ...props },
  ref
) {
  const classes = ['icon-button', size === 'small' && 'icon-button-small', className]
  return (
    <Tooltip label={label} side={side}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={classes.filter(Boolean).join(' ')}
        {...props}
      >
        <Icon size={size === 'small' ? 14 : 16} aria-hidden />
      </button>
    </Tooltip>
  )
})

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }): ReactNode {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <IconButton
      size="small"
      icon={copied ? Check : Copy}
      label={copied ? 'Copied' : label}
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => toast.error('Could not copy to the clipboard.')
        )
      }
    />
  )
}

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: ReactNode
  children: (id: string) => ReactNode
}): ReactNode {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}

export interface SelectOption {
  value: string
  label: string
  hint?: string
  icon?: ReactNode
}

export function Select({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  compact,
  disabled,
  leading
}: {
  id?: string
  value: string
  options: SelectOption[]
  onChange(value: string): void
  ariaLabel?: string
  placeholder?: string
  compact?: boolean
  disabled?: boolean
  leading?: ReactNode
}): ReactNode {
  return (
    <RadixSelect.Root value={value} onValueChange={onChange} disabled={disabled}>
      <RadixSelect.Trigger
        id={id}
        className={compact ? 'select select-compact' : 'select'}
        aria-label={ariaLabel}
      >
        {leading}
        <span className="select-value">
          <RadixSelect.Value placeholder={placeholder} />
        </span>
        <RadixSelect.Icon className="select-chevron">
          <ChevronDown size={14} aria-hidden />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="popover select-content" position="popper" sideOffset={4}>
          <RadixSelect.Viewport>
            {options.map((option) => (
              <RadixSelect.Item key={option.value} value={option.value} className="menu-item">
                {option.icon}
                <span className="menu-item-text">
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  {option.hint && <span className="menu-item-hint">{option.hint}</span>}
                </span>
                <RadixSelect.ItemIndicator className="menu-item-check">
                  <Check size={14} aria-hidden />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}

export function Switch({
  label,
  hint,
  checked,
  disabled,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange(checked: boolean): void
}): ReactNode {
  const id = useId()
  return (
    <div className="switch-row">
      <div className="switch-text">
        <label htmlFor={id}>{label}</label>
        {hint && <p className="hint">{hint}</p>}
      </div>
      <RadixSwitch.Root
        id={id}
        className="switch"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      >
        <RadixSwitch.Thumb className="switch-thumb" />
      </RadixSwitch.Root>
    </div>
  )
}

export interface MenuAction {
  label: string
  icon?: IconType
  danger?: boolean
  disabled?: boolean
  onSelect(): void
}

/** Actions shown from any trigger. Pass a button that forwards its ref as the child. */
export function Menu({
  actions,
  align = 'end',
  children,
  onOpenChange
}: {
  actions: MenuAction[]
  align?: 'start' | 'end'
  children: ReactNode
  onOpenChange?(open: boolean): void
}): ReactNode {
  return (
    <RadixMenu.Root onOpenChange={onOpenChange}>
      <RadixMenu.Trigger asChild>{children}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content className="popover menu" align={align} sideOffset={4}>
          {actions.map(({ label, icon: Icon, danger, disabled, onSelect }) => (
            <RadixMenu.Item
              key={label}
              className={danger ? 'menu-item menu-item-danger' : 'menu-item'}
              disabled={disabled}
              onSelect={onSelect}
            >
              {Icon && <Icon size={15} aria-hidden />}
              <span className="menu-item-text">{label}</span>
            </RadixMenu.Item>
          ))}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  )
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  wide,
  children
}: {
  open: boolean
  onOpenChange(open: boolean): void
  title: ReactNode
  description?: ReactNode
  wide?: boolean
  children: ReactNode
}): ReactNode {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay" />
        <RadixDialog.Content
          className={wide ? 'dialog dialog-wide' : 'dialog'}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <header className="dialog-header">
            <div className="dialog-heading">
              <RadixDialog.Title asChild>
                <h2>{title}</h2>
              </RadixDialog.Title>
              {description && (
                <RadixDialog.Description asChild>
                  <p className="muted">{description}</p>
                </RadixDialog.Description>
              )}
            </div>
          </header>
          <div className="dialog-body">{children}</div>
          {/* Comes last so opening a dialog focuses its content, not this button. */}
          <RadixDialog.Close asChild>
            <IconButton className="dialog-close" icon={X} label="Close" />
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

const BANNER_ICONS = { info: Info, warning: TriangleAlert, error: CircleAlert, success: Check }

export function Banner({
  tone = 'info',
  children,
  action
}: {
  tone?: keyof typeof BANNER_ICONS
  children: ReactNode
  action?: ReactNode
}): ReactNode {
  const Icon = BANNER_ICONS[tone]
  return (
    <div className={`banner banner-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={15} aria-hidden />
      <div className="banner-body">{children}</div>
      {action}
    </div>
  )
}

export function Badge({
  tone = 'neutral',
  children
}: {
  tone?: 'neutral' | 'accent' | 'danger'
  children: ReactNode
}): ReactNode {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function StatusDot({
  tone,
  label
}: {
  tone: 'off' | 'busy' | 'ok' | 'error'
  label?: string
}): ReactNode {
  return <span className={`dot dot-${tone}`} role={label ? 'img' : undefined} aria-label={label} />
}

/** A compact one of many control. Every option stays visible. */
export function Segmented({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange(value: string): void
}): ReactNode {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? 'segment segment-on' : 'segment'}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }): ReactNode {
  return <kbd className="kbd">{children}</kbd>
}

export function Skeleton({ rows = 3 }: { rows?: number }): ReactNode {
  return (
    <div className="skeleton-list" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="skeleton" style={{ width: `${88 - index * 14}%` }} />
      ))}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action
}: {
  icon: IconType
  title: string
  children?: ReactNode
  action?: ReactNode
}): ReactNode {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={20} aria-hidden />
      </span>
      <h2>{title}</h2>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  action
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
}): ReactNode {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {action}
    </header>
  )
}
