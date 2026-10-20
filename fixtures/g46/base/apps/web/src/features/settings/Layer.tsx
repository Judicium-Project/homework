import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { t } from "../../i18n/index.ts";
import { IconButton, Button } from "../../ui/Button.tsx";
import { useFocusTrap } from "../../ui/Modal.tsx";
import css from "./settings.module.css";

export interface NavEntry { id: string; label: string; danger?: boolean; head?: boolean; onClick?: () => void }

/** Tam ekran ayar katmanı (§6.17): sol gezinme + sağ içerik; Esc kapatır; kaydedilmemiş değişiklik çubuğu. */
export function SettingsLayer({ title, nav, active, onSelect, onClose, children, dirty, onSave, onReset, saving }: {
  title: string; nav: NavEntry[]; active: string; onSelect(id: string): void; onClose(): void; children: ReactNode;
  dirty?: boolean; onSave?: () => void; onReset?: () => void; saving?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => void (document.body.style.overflow = "");
  }, []);
  return (
    <div ref={ref} className={css.layer} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <nav className={css.nav} aria-label={title}>
        <div className={css.navHead}>{title}</div>
        {nav.map((n) =>
          n.head ? (
            <div key={n.id} className={css.navHead}>{n.label}</div>
          ) : (
            <button key={n.id} type="button" aria-current={n.id === active} className={`${css.navItem} ${n.danger ? css.navDanger : ""}`} onClick={() => (n.onClick ? n.onClick() : onSelect(n.id))}>
              {n.label}
            </button>
          ),
        )}
      </nav>
      <div className={css.pane}>
        <div className={css.close}>
          <IconButton icon={X} label={t("common.close")} round kind="secondary" onClick={onClose} />
          <span>Esc</span>
        </div>
        <div className={css.content}>{children}</div>
        {dirty && (
          <div className={css.saveBar} role="status">
            <span>{t("settings.unsaved")}</span>
            <span style={{ display: "flex", gap: "var(--hk-space-2)" }}>
              <Button kind="ghost" onClick={onReset}>{t("settings.reset")}</Button>
              <Button kind="primary" busy={saving} onClick={onSave}>{t("common.save")}</Button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
