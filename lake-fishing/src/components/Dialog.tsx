import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface DialogProps {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  tone?: "default" | "gold" | "danger";
  onClose?: () => void;
  label?: string;
}

/** Modal pixel panel centered in the app column. */
export function Dialog({ title, children, actions, tone = "default", onClose, label }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!onClose) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="backdrop" role="presentation">
      <div ref={ref} className={`dialog px-panel tone-${tone}`} role="dialog" aria-modal="true" aria-label={label ?? title}>
        <h2 className="dialog-title">{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger,
  onConfirm,
  onCancel
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      title={title}
      tone={danger ? "danger" : "default"}
      onClose={onCancel}
      actions={
        <>
          <button className="btn" data-autofocus onClick={onCancel}>
            取消
          </button>
          <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} data-sfx="none" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
