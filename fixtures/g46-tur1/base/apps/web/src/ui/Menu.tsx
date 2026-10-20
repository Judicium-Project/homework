import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { create } from "zustand";
import css from "./ui.module.css";
import { cx } from "./cx.ts";
import { Icon } from "./Icon.tsx";
import { useAppFloating, type FloatingReference } from "./floating.ts";

export type MenuItem =
  | { separator: true; hidden?: boolean }
  | { label: string; icon?: LucideIcon; shortcut?: string; danger?: boolean; disabled?: boolean; hidden?: boolean; onSelect: () => void; checked?: boolean; separator?: false };

interface MenuState {
  open: {
    items: MenuItem[];
    anchor?: HTMLElement | null;
    reference?: FloatingReference;
    align?: "start" | "end";
    x?: number;
    y?: number;
  } | null;
  show(
    target: { x: number; y: number } | HTMLElement | DOMRect | number,
    itemsOrY: MenuItem[] | number,
    anchorOrItems?: HTMLElement | null | MenuItem[],
    alignOrAnchor?: "start" | "end" | HTMLElement | null,
  ): void;
  hide(): void;
}

export const useMenuStore = create<MenuState>((set) => ({
  open: null,
  show: (a, b, c, d) => {
    // Geriye dönük uyum: show(x, y, items, anchor)
    if (typeof a === "number" && typeof b === "number") {
      const items = (c as MenuItem[]) ?? [];
      const anchor = (d as HTMLElement | null) ?? null;
      set({
        open: {
          x: a,
          y: b,
          reference: { getBoundingClientRect: () => new DOMRect(a, b, 0, 0) },
          items: items.filter((i) => !i.hidden),
          anchor,
          align: "start",
        },
      });
      return;
    }

    const target = a as HTMLElement | DOMRect | { x: number; y: number };
    const items = (b as MenuItem[]) ?? [];
    const anchor = (c as HTMLElement | null) ?? ("nodeType" in target ? (target as HTMLElement) : null);
    const align = (d as "start" | "end") ?? "start";

    let reference: FloatingReference;
    let x: number | undefined;
    let y: number | undefined;

    if ("nodeType" in target) {
      reference = target;
    } else if ("clientX" in target || ("x" in target && "y" in target && !("width" in target))) {
      const pt = target as { x: number; y: number };
      x = pt.x;
      y = pt.y;
      reference = { getBoundingClientRect: () => new DOMRect(pt.x, pt.y, 0, 0) };
    } else {
      reference = target as DOMRect;
    }

    set({
      open: {
        reference,
        anchor,
        items: items.filter((i) => !i.hidden),
        align,
        x,
        y,
      },
    });
  },
  hide: () => set({ open: null }),
}));

/** Bağlam menüsü / açılır menü açar (sağ tık ya da tetikleyici düğmenin altı). */
export function openMenu(e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuItem[], anchor?: HTMLElement | null): void {
  e.preventDefault?.();
  useMenuStore.getState().show({ x: e.clientX, y: e.clientY }, items, anchor);
}

export function openMenuAt(el: HTMLElement, items: MenuItem[], align: "start" | "end" = "start"): void {
  useMenuStore.getState().show(el, items, el, align);
}

/** Tek menü ana bilgisayarı (kök bileşende bir kez). Floating UI tabanlı çarpışmasız akıllı konumlama (§6.4, PLAN-C N5). */
export function MenuHost() {
  const open = useMenuStore((s) => s.open);
  const hide = useMenuStore((s) => s.hide);
  const menuRef = useRef<HTMLDivElement>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const reference = open?.reference ?? (open?.anchor ? open.anchor : open ? { getBoundingClientRect: () => new DOMRect(open.x ?? 0, open.y ?? 0, 0, 0) } : null);

  const { refs, floatingStyles } = useAppFloating({
    reference,
    placement: open?.align === "end" ? "bottom-end" : "bottom-start",
    offsetPx: 4,
    padding: 8,
    open: Boolean(open),
  });

  // Dışarı tıklama ve Esc tuşu ile kapatma
  useEffect(() => {
    if (!open) return;
    setHighlightedIndex(-1);

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        hide();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        hide();
        open.anchor?.focus();
        return;
      }

      const actionableIndices = open.items
        .map((it, idx) => (!it.separator && !it.disabled ? idx : -1))
        .filter((idx) => idx !== -1);

      if (actionableIndices.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((cur) => {
          const nextPos = actionableIndices.indexOf(cur) + 1;
          return nextPos < actionableIndices.length ? actionableIndices[nextPos] : actionableIndices[0];
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((cur) => {
          const prevPos = actionableIndices.indexOf(cur) - 1;
          return prevPos >= 0 ? actionableIndices[prevPos] : actionableIndices[actionableIndices.length - 1];
        });
      } else if (e.key === "Enter" || e.key === " ") {
        if (highlightedIndex >= 0 && highlightedIndex < open.items.length) {
          const it = open.items[highlightedIndex];
          if (it && !it.separator && !it.disabled) {
            e.preventDefault();
            hide();
            it.onSelect();
          }
        }
      }
    };

    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, hide, highlightedIndex]);

  if (!open) return null;

  return createPortal(
    <div
      ref={(node) => {
        refs.setFloating(node);
        (menuRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      role="menu"
      tabIndex={-1}
      className={css.menu}
      style={{
        ...floatingStyles,
        overflowY: "auto",
      }}
      data-testid="menu-host"
    >
      {open.items.map((it, i) =>
        it.separator ? (
          <div key={`s${i}`} role="separator" className={css.menuSep} />
        ) : (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            data-disabled={it.disabled ? "" : undefined}
            data-highlighted={i === highlightedIndex ? "" : undefined}
            className={cx(css.menuItem, it.danger && css.menuDanger)}
            onClick={() => {
              if (it.disabled) return;
              hide();
              it.onSelect();
            }}
            onMouseEnter={() => setHighlightedIndex(i)}
          >
            {it.icon && <Icon icon={it.icon} size="sm" />}
            <span style={{ flex: 1, textAlign: "left" }}>{it.label}</span>
            {it.shortcut && <span className={css.menuShortcut}>{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

export { DropdownMenu };
export type { ReactNode };
