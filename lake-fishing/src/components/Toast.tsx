import { useEffect } from "react";
import type { Toast as ToastData } from "../game/state";

export function Toast({ toast, onDone }: { toast: ToastData | null; onDone: (id: number) => void }) {
  const id = toast?.id;
  useEffect(() => {
    if (id === undefined) return;
    const timer = window.setTimeout(() => onDone(id), 3200);
    return () => window.clearTimeout(timer);
  }, [id, onDone]);
  if (!toast) return null;
  return (
    <div className="toast px-panel" role="status" aria-live="polite" key={toast.id}>
      {toast.text}
    </div>
  );
}
