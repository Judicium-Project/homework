import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Check, CircleAlert, CircleCheck } from "lucide-react";
import css from "./ui.module.css";
import { cx } from "./cx.ts";
import { Icon } from "./Icon.tsx";

interface FieldProps {
  label?: string;
  error?: string | null;
  help?: string;
  ok?: string | null;
  children: (a: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode;
}

/** Etiket + alan + yardım/hata (§6.2): hata = simge + metin, `aria-describedby`. */
export function Field({ label, error, help, ok, children }: FieldProps) {
  const id = useId();
  const msgId = `${id}-m`;
  return (
    <div className={css.field}>
      {label && (
        <label htmlFor={id} className={css.label}>
          {label}
        </label>
      )}
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": error || help || ok ? msgId : undefined })}
      {error ? (
        <p id={msgId} className={css.error} role="alert">
          <Icon icon={CircleAlert} size="sm" />
          {error}
        </p>
      ) : ok ? (
        <p id={msgId} className={cx(css.error, css.ok)}>
          <Icon icon={CircleCheck} size="sm" />
          {ok}
        </p>
      ) : help ? (
        <p id={msgId} className={css.help}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { big?: boolean }>(function TextInput(
  { big, className, ...p },
  ref,
) {
  return <input ref={ref} className={cx(css.input, big && css.input_lg, className)} {...p} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cx(css.input, className)} {...p} />;
});

export function Checkbox({ label, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode }) {
  return (
    <label className={css.check}>
      <input type="checkbox" {...p} />
      <span className={css.box} aria-hidden="true">
        <Check size={14} strokeWidth={3} />
      </span>
      <span>{label}</span>
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={css.switch} onClick={() => onChange(!checked)} />;
}
