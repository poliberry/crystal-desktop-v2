"use client"

import * as React from "react"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"
import { ContextMenu as ContextMenuPrimitive, Slot } from "radix-ui"

import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

/*
 * On a phone, a context menu is a bottom drawer (shadcn's Drawer), opened by a long-press, with large
 * tap targets and submenus that expand in place. The same components render it, so every menu in the
 * app gets this without changes: the root decides, and the parts below follow its lead through
 * `MobileMenu`. On anything bigger it is the Radix context menu, unchanged.
 */
type MobileMenuValue = { open: boolean; setOpen: (open: boolean) => void }
const MobileMenu = React.createContext<MobileMenuValue | null>(null)
const MobileSub = React.createContext<{ expanded: boolean; toggle: () => void } | null>(null)
const MobileRadio = React.createContext<{ value?: string; onValueChange?: (value: string) => void } | null>(null)

const LONG_PRESS_MS = 450
const MOVE_TOLERANCE = 10

/** What a Radix item's `onSelect` receives, close enough for callers that only call preventDefault. */
function selectEvent(): Event {
  return new Event("select", { cancelable: true })
}

const mobileItemClass =
  "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] active:bg-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5 [&_svg:not([class*='text-'])]:text-muted-foreground"

/** Runs an item's handlers like Radix would, then closes the sheet unless the handler said not to. */
function useMobileSelect(menu: MobileMenuValue | null, props: { onSelect?: (event: Event) => void; onClick?: React.MouseEventHandler<HTMLElement> }) {
  return (event: React.MouseEvent<HTMLButtonElement>) => {
    props.onClick?.(event as unknown as React.MouseEvent<HTMLElement>)
    const select = selectEvent()
    props.onSelect?.(select)
    if (!select.defaultPrevented && !event.defaultPrevented) menu?.setOpen(false)
  }
}

function ContextMenu({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  const mobile = useIsMobile()
  const [open, setOpenState] = React.useState(false)
  const { onOpenChange } = props
  const setOpen = React.useCallback((next: boolean) => {
    setOpenState(next)
    onOpenChange?.(next)
  }, [onOpenChange])
  const value = React.useMemo(() => ({ open, setOpen }), [open, setOpen])
  if (mobile) return <MobileMenu.Provider value={value}>{props.children}</MobileMenu.Provider>
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  const menu = React.useContext(MobileMenu)
  const timer = React.useRef<number | null>(null)
  const start = React.useRef<{ x: number; y: number } | null>(null)
  if (!menu) {
    return (
      <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
    )
  }
  const { asChild, disabled, children, ...rest } = props
  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    start.current = null
  }
  const handlers = {
    // Android (and a mouse) send `contextmenu` for a long-press; iOS doesn't, so the timer covers it.
    onContextMenu: (event: React.MouseEvent) => {
      if (disabled) return
      event.preventDefault()
      cancel()
      menu.setOpen(true)
    },
    onPointerDown: (event: React.PointerEvent) => {
      if (disabled || event.pointerType === "mouse") return
      start.current = { x: event.clientX, y: event.clientY }
      timer.current = window.setTimeout(() => {
        timer.current = null
        navigator.vibrate?.(10)
        menu.setOpen(true)
      }, LONG_PRESS_MS)
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (!start.current) return
      if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > MOVE_TOLERANCE) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  }
  const Comp = asChild ? Slot.Root : "span"
  return (
    <Comp data-slot="context-menu-trigger" {...(rest as React.HTMLAttributes<HTMLElement>)} {...handlers}>
      {children}
    </Comp>
  )
}

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  const menu = React.useContext(MobileMenu)
  if (menu) {
    return (
      <Drawer open={menu.open} onOpenChange={menu.setOpen}>
        <DrawerContent className="gap-0 rounded-t-2xl px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] data-[vaul-drawer-direction=bottom]:max-h-[85dvh]">
          <DrawerTitle className="sr-only">Options</DrawerTitle>
          <div role="menu" className="mt-2 flex min-h-0 flex-col overflow-y-auto overscroll-contain">{props.children}</div>
        </DrawerContent>
      </Drawer>
    )
  }
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(
          "z-50 max-h-(--radix-context-menu-content-available-height) min-w-[8rem] origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  const menu = React.useContext(MobileMenu)
  const onMobileClick = useMobileSelect(menu, props as { onSelect?: (e: Event) => void; onClick?: React.MouseEventHandler<HTMLElement> })
  if (menu) {
    const { children, disabled, asChild } = props
    if (asChild) return <Slot.Root role="menuitem" className={cn(mobileItemClass, className)} onClick={onMobileClick as unknown as React.MouseEventHandler<HTMLElement>}>{children}</Slot.Root>
    return (
      <button type="button" role="menuitem" disabled={disabled} onClick={onMobileClick} className={cn(mobileItemClass, inset && "pl-11", variant === "destructive" && "text-destructive [&_svg]:!text-destructive", className)}>
        {children}
      </button>
    )
  }
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground data-[variant=destructive]:*:[svg]:text-destructive!",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
  const menu = React.useContext(MobileMenu)
  const { onCheckedChange, onSelect, disabled } = props
  if (menu) {
    return (
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={checked === true}
        disabled={disabled}
        onClick={() => {
          onCheckedChange?.(checked !== true)
          const select = selectEvent()
          onSelect?.(select)
          if (!select.defaultPrevented) menu.setOpen(false)
        }}
        className={cn(mobileItemClass, className)}
      >
        <span className="flex size-5 items-center justify-center">{checked === true && <CheckIcon className="size-5 !text-foreground" />}</span>
        {children}
      </button>
    )
  }
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  )
}

function ContextMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioGroup>) {
  const menu = React.useContext(MobileMenu)
  if (menu) {
    return (
      <MobileRadio.Provider value={{ value: props.value, onValueChange: props.onValueChange }}>
        <div role="group">{props.children}</div>
      </MobileRadio.Provider>
    )
  }
  return (
    <ContextMenuPrimitive.RadioGroup data-slot="context-menu-radio-group" {...props} />
  )
}

function ContextMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem>) {
  const menu = React.useContext(MobileMenu)
  const radio = React.useContext(MobileRadio)
  if (menu) {
    const selected = radio?.value === props.value
    return (
      <button
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        disabled={props.disabled}
        onClick={() => {
          radio?.onValueChange?.(props.value)
          const select = selectEvent()
          props.onSelect?.(select)
          if (!select.defaultPrevented) menu.setOpen(false)
        }}
        className={cn(mobileItemClass, className)}
      >
        <span className="flex size-5 items-center justify-center">{selected && <CircleIcon className="size-2.5 fill-current !text-foreground" />}</span>
        {children}
      </button>
    )
  }
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  )
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
  inset?: boolean
}) {
  const menu = React.useContext(MobileMenu)
  if (menu) return <div className={cn("px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground", className)}>{props.children}</div>
  return (
    <ContextMenuPrimitive.Label
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn("px-2 py-1.5 text-sm font-medium data-[inset]:pl-8", className)}
      {...props}
    />
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  const menu = React.useContext(MobileMenu)
  if (menu) return <div role="separator" className="mx-3 my-1.5 h-px bg-border" />
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function ContextMenuSub({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  const menu = React.useContext(MobileMenu)
  const [expanded, setExpanded] = React.useState(false)
  if (menu) return <MobileSub.Provider value={{ expanded, toggle: () => setExpanded((v) => !v) }}>{props.children}</MobileSub.Provider>
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  const menu = React.useContext(MobileMenu)
  const sub = React.useContext(MobileSub)
  if (menu && sub) {
    return (
      <button type="button" aria-expanded={sub.expanded} disabled={props.disabled} onClick={sub.toggle} className={cn(mobileItemClass, inset && "pl-11", className)}>
        {children}
        <ChevronRightIcon className={cn("ml-auto size-5 transition-transform", sub.expanded && "rotate-90")} />
      </button>
    )
  }
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[inset]:pl-8 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </ContextMenuPrimitive.SubTrigger>
  )
}

function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  const menu = React.useContext(MobileMenu)
  const sub = React.useContext(MobileSub)
  // In place, under its trigger: a second sheet on top of the first is one layer too many on a phone.
  if (menu) return sub?.expanded ? <div className="mb-1 ml-4 flex flex-col border-l border-border pl-1">{props.children}</div> : null
  return (
    <ContextMenuPrimitive.SubContent
      data-slot="context-menu-sub-content"
      className={cn(
        "z-50 min-w-[8rem] origin-(--radix-context-menu-content-transform-origin) overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  // Keyboard shortcuts mean nothing on a touch screen.
  if (React.useContext(MobileMenu)) return null
  return <span data-slot="context-menu-shortcut" className={cn("text-muted-foreground ml-auto pl-6 text-xs tracking-widest", className)} {...props} />
}

export {
  ContextMenu,
  ContextMenuShortcut,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
}
