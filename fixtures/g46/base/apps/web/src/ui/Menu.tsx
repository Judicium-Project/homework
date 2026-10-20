import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { create } from "zustand";
import css from "./ui.module.css";
import { cx } from "./cx.ts";
import { Icon } from "./Icon.tsx";

export type MenuItem =
  | { separator: true; hidden?: boolean }
  | { label: string; icon?: LucideIcon; shortcut?: string; danger?: boolean; disabled?: boolean; hidden?: boolean; onSelect: () => void; checked?: boolean; separator?: false };

interface MenuState {
  open: { x: number; y: number; items: MenuItem[]; anchor?: HTMLElement | null } | null;
  show(x: number, y: number, items: MenuItem[], anchor?: HTMLElement | null): void;
  hide(): void;
}
export const useMenuStore = create<MenuState>((set) => ({
  open: null,
  show: (x, y, items, anchor) => set({ open: { x, y, items: items.filter((i) => !i.hidden), anchor } }),
  hide: () => set({ open: null }),
}));

/** Bağlam menüsü / açılır menü açar (sağ tık ya da tetikleyici düğmenin altı). */
export function openMenu(e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuItem[], anchor?: HTMLElement | null): void {
  e.preventDefault?.();
  useMenuStore.getState().show(e.clientX, e.clientY, items, anchor);
}
export function openMenuAt(el: HTMLElement, items: MenuItem[], align: "start" | "end" = "start"): void {
  const r = el.getBoundingClientRect();
  useMenuStore.getState().show(align === "end" ? r.right - 200 : r.left, r.bottom + 4, items, el);
}

/** Tek menü ana bilgisayarı (kök bileşende bir kez). Radix UI DropdownMenu primitives ile klavye yön tuşları, Esc, ve focus yönetimi (§6.4). */
export function MenuHost() {
  const open = useMenuStore((s) => s.open);
  const hide = useMenuStore((s) => s.hide);

  if (!open) return null;

  return (
    <DropdownMenu.Root open={true} onOpenChange={(isOpen) => { if (!isOpen) hide(); }}>
      <DropdownMenu.Trigger asChild>
        <span
          style={{
            position: "fixed",
            left: `${open.x}px`,
            top: `${open.y}px`,
            width: 0,
            height: 0,
            pointerEvents: "none",
            opacity: 0,
          }}
          tabIndex={-1}
          aria-hidden="true"
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={css.menu}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onCloseAutoFocus={(e) => {
            if (open.anchor) {
              e.preventDefault();
              open.anchor.focus();
            }
          }}
        >
          {open.items.map((it, i) =>
            it.separator ? (
              <DropdownMenu.Separator key={`s${i}`} className={css.menuSep} />
            ) : (
              <DropdownMenu.Item
                key={it.label}
                disabled={it.disabled}
                className={cx(css.menuItem, it.danger && css.menuDanger)}
                onSelect={() => {
                  hide();
                  it.onSelect();
                }}
              >
                {it.icon && <Icon icon={it.icon} size="sm" />}
                <span>{it.label}</span>
                {it.shortcut && <span className={css.menuShortcut}>{it.shortcut}</span>}
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export { DropdownMenu };
export type { ReactNode };
