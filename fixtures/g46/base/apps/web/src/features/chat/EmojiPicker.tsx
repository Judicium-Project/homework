import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n/index.ts";
import { TextInput } from "../../ui/Form.tsx";
import { EMOJI, QUICK_REACTIONS, searchEmoji } from "./emoji.ts";
import css from "./chat.module.css";

/** Emoji seçici açılır penceresi; Esc ya da dışarı tık kapatır. `anchor` düğmenin ekran dikdörtgeni. */
export function EmojiPicker({ anchor, onPick, onClose }: { anchor: DOMRect; onPick(e: string): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const list = q.trim() ? searchEmoji(q, 40) : EMOJI;
  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    document.addEventListener("mousedown", away, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", away, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  const width = 260;
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
  const above = anchor.top > 280;
  return createPortal(
    <div ref={ref} role="dialog" aria-label={t("emoji.picker")} className={css.picker} style={{ left, ...(above ? { bottom: window.innerHeight - anchor.top + 4 } : { top: anchor.bottom + 4 }) }}>
      <TextInput autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("emoji.search")} aria-label={t("emoji.search")} />
      {!q && (
        <div className={css.pickerGrid} aria-label={t("emoji.quick")}>
          {QUICK_REACTIONS.map((e) => (
            <button key={`q${e}`} type="button" className={css.pickerBtn} onClick={() => onPick(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
      <div className={css.pickerGrid}>
        {list.map((x) => (
          <button key={x.e} type="button" className={css.pickerBtn} title={x.n} aria-label={x.n} onClick={() => onPick(x.e)}>
            {x.e}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
