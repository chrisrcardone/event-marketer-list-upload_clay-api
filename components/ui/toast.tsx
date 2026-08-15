"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle, Info, WarningCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/ui/cn";

type ToastKind = "success" | "info" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<{
  toast: (message: string, kind?: ToastKind) => void;
} | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const kindIcon: Record<ToastKind, ReactNode> = {
  success: <CheckCircle size={18} weight="bold" className="text-lime-200" />,
  info: <Info size={18} weight="bold" className="text-slushie-200" />,
  error: <WarningCircle size={18} weight="bold" className="text-pom-200" />,
};

/**
 * Ink toast, bottom-center, calm house motion, auto-dismisses after 5s.
 * Errors use role=alert; the rest are polite status.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[18px] z-[70] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex items-center gap-[10px] rounded-md bg-oat-500 py-[11px] pl-[14px] pr-[18px] text-[13.5px] font-medium text-oat-100 shadow-lg",
            )}
            style={{ animation: "toastIn 240ms cubic-bezier(.2,0,0,1) both" }}
          >
            {kindIcon[t.kind]}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
