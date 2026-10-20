import { useEffect, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { t } from "../i18n/index.ts";
import css from "./ui.module.css";
import { cx } from "./cx.ts";
import { Button, IconButton } from "./Button.tsx";

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

const trapStack: HTMLElement[] = [];

/** Odağı bir kapsayıcıda tutar, Esc ve kapanışta eski odağa döner. (Geriye dönük uyum). */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, onEscape?: () => void, autofocus = true) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const prev = document.activeElement as HTMLElement | null;
    if (autofocus) {
      const first = root.querySelector<HTMLElement>("[data-autofocus]") ?? root.querySelector<HTMLElement>(FOCUSABLE.replace("a[href], ", "")) ?? root;
      first.focus({ preventScroll: true });
    }
    trapStack.push(root);
    // Esc: odak pencere dışında kalsa bile (ör. devre dışı düğme) en üstteki katmanı kapatır.
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onEscape && trapStack[trapStack.length - 1] === root && !e.defaultPrevented) {
        onEscape();
      }
    };
    document.addEventListener("keydown", onDocKey);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
        if (items.length === 0) return;
        const first = items[0] as HTMLElement;
        const last = items[items.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    root.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onDocKey);
      trapStack.splice(trapStack.indexOf(root), 1);
      root.removeEventListener("keydown", onKey);
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

interface ModalProps {
  title: string;
  description?: ReactNode;
  size?: "sm" | "md" | "lg";
  onClose: () => void;
  children?: ReactNode;
  actions?: ReactNode;
  /** Karartmaya tıklayınca kapanmasın (form değiştiyse). */
  dismissOnScrim?: boolean;
  className?: string;
}

/** Modal (§6.5): karartma, odak tuzağı, Esc, sağ üst `x` — Radix UI Dialog primitives ile. */
export function Modal({
  title,
  description,
  size = "sm",
  onClose,
  children,
  actions,
  dismissOnScrim = true,
  className,
}: ModalProps) {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={css.scrim} />
        <Dialog.Content
          className={cx(css.modal, css[`m_${size}`], className)}
          onOpenAutoFocus={(e) => {
            const root = e.currentTarget as HTMLElement | null;
            const el = root?.querySelector<HTMLElement>("[data-autofocus]");
            if (el) {
              e.preventDefault();
              el.focus({ preventScroll: true });
            }
          }}
          onPointerDownOutside={(e) => {
            if (!dismissOnScrim) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (!dismissOnScrim) e.preventDefault();
          }}
        >
          <IconButton
            icon={X}
            label={t("common.close")}
            className={css.modalClose}
            onClick={onClose}
            size="sm"
            iconSize="sm"
          />
          <Dialog.Title className={css.modalTitle}>{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className={css.modalDesc}>
              {description}
            </Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">
              {title}
            </Dialog.Description>
          )}
          {children}
          {actions && <div className={css.modalActions}>{actions}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ConfirmProps {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}

/** Onay penceresi: yıkıcı eylemde tehlike düğmesi (§6.5). */
export function ConfirmModal({ title, description, confirmLabel, danger, busy, onConfirm, onClose, children }: ConfirmProps) {
  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button kind={danger ? "danger" : "primary"} busy={busy} onClick={onConfirm} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
