import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

import type { ColorToken } from "../lib/types";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function habitColor(token: ColorToken | string): string {
  return `var(--h-${token})`;
}

/* -------------------------------------------------------------------- button */

type Variant = "primary" | "secondary" | "quiet" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent border-transparent hover:opacity-90 active:opacity-100",
  secondary: "bg-surface text-ink border-rule-strong hover:bg-sunk",
  quiet: "bg-transparent text-ink-soft border-transparent hover:bg-sunk hover:text-ink",
  danger: "bg-transparent text-danger-ink border-rule hover:bg-danger hover:text-white",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  loading?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md border font-medium",
        "transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-9.5 px-4 text-sm",
        VARIANTS[variant],
        className,
      )}
    >
      {loading && (
        <span
          aria-hidden
          className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}

/* --------------------------------------------------------------------- field */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-danger-ink">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-faint">{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL =
  "w-full rounded-md border border-rule-strong bg-surface px-3 text-sm text-ink " +
  "placeholder:text-ink-faint focus:border-accent focus:outline-none " +
  "focus:ring-2 focus:ring-accent/25 disabled:opacity-60";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(CONTROL, "h-9.5", className)} />;
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(CONTROL, "h-9.5 pr-8", className)}>
      {children}
    </select>
  );
}

/* ---------------------------------------------------------------- segmented */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-rule-strong bg-sunk p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cx(
              "rounded-[5px] px-2.5 py-1 text-[13px] font-medium transition-colors",
              active
                ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
                : "text-ink-faint hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------- modal */

export function Modal({
  open,
  title,
  onClose,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Focus moves into the dialog so keyboard and screen-reader users land inside it.
    panelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[8vh]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="fixed inset-0 bg-[rgb(28_26_23/0.35)]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cx(
          "relative w-full rounded-xl border border-rule bg-surface shadow-pop outline-none",
          width,
        )}
      >
        <div className="flex items-center justify-between border-b border-rule px-5 py-3.5">
          <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-ink"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
              <path
                d="M3.5 3.5l8 8m0-8l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- toasts */

interface Toast {
  id: number;
  message: string;
  tone: "info" | "error" | "celebrate";
  action?: { label: string; run: () => void };
}

interface ToastApi {
  notify: (message: string, action?: Toast["action"]) => void;
  error: (message: string) => void;
  celebrate: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback(
    (message: string, tone: Toast["tone"], action?: Toast["action"]) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-2), { id, message, tone, action }]);
      window.setTimeout(
        () => setToasts((current) => current.filter((t) => t.id !== id)),
        action ? 7000 : tone === "celebrate" ? 6000 : 4000,
      );
    },
    [],
  );

  const value = useMemo<ToastApi>(
    () => ({
      notify: (message, action) => push(message, "info", action),
      error: (message) => push(message, "error"),
      celebrate: (message) => push(message, "celebrate"),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx(
              "pointer-events-auto flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm shadow-pop",
              "motion-safe:animate-[toast-in_180ms_ease-out]",
              toast.tone === "error"
                ? "border-danger bg-surface text-danger-ink"
                : toast.tone === "celebrate"
                  ? "border-fire bg-fire-soft text-ink"
                  : "border-rule-strong bg-surface text-ink",
            )}
          >
            {toast.tone === "celebrate" && (
              <span aria-hidden className="text-base leading-none">
                🔥
              </span>
            )}
            <span>{toast.message}</span>
            {toast.action && (
              <button
                onClick={() => {
                  toast.action?.run();
                  setToasts((current) => current.filter((t) => t.id !== toast.id));
                }}
                className="font-medium text-accent-ink underline underline-offset-2"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside a ToastProvider");
  return value;
}

/* ------------------------------------------------------------------ stepper */

export function Stepper({
  value,
  target,
  unit,
  onChange,
  label,
}: {
  value: number;
  target: number;
  unit?: string | null;
  onChange: (value: number) => void;
  label: string;
}) {
  const step = (delta: number) =>
    onChange(Math.max(0, Math.min(target * 5, value + delta)));

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label={`One fewer for ${label}`}
        disabled={value <= 0}
        onClick={() => step(-1)}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-rule-strong text-ink-soft transition-colors hover:bg-sunk hover:text-ink disabled:opacity-35"
      >
        <span aria-hidden>&minus;</span>
      </button>
      <span className="tnum w-14 text-center text-[13px] text-ink">
        {value}
        <span className="text-ink-faint">/{target}</span>
      </span>
      <button
        type="button"
        aria-label={`One more for ${label}`}
        onClick={() => step(1)}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-rule-strong text-ink-soft transition-colors hover:bg-sunk hover:text-ink"
      >
        <span aria-hidden>+</span>
      </button>
      {unit && <span className="text-[11px] text-ink-faint">{unit}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------- drawer */

export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-[rgb(28_26_23/0.3)]"
        onClick={onClose}
        aria-hidden
      />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l border-rule bg-surface shadow-pop motion-safe:animate-[drawer-in_200ms_ease-out]">
        <div className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3">
          <div>
            <h2 className="font-display text-[16px] text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-ink"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
              <path
                d="M3.5 3.5l8 8m0-8l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- animated number */

/**
 * Counts from the previous value to the new one, so a figure that changes reads
 * as having moved rather than simply being different.
 */
export function AnimatedNumber({
  value,
  format = (n) => String(Math.round(n)),
  duration = 550,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const frame = useRef<number>(undefined);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      from.current = value;
      return;
    }

    const start = performance.now();
    const origin = from.current;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // decelerate into the final figure
      setShown(origin + (value - origin) * eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame.current = requestAnimationFrame(tick);

    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      from.current = value;
    };
  }, [value, duration]);

  return <>{format(shown)}</>;
}

/* --------------------------------------------------------------- empty state */

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div
        aria-hidden
        className="mb-4 h-10 w-10 rounded-full border-2 border-dashed border-rule-strong"
      />
      <h3 className="mb-1 text-base font-semibold text-ink">{title}</h3>
      <p className="mb-5 max-w-sm text-sm text-ink-soft">{body}</p>
      {action}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-faint">
      <span
        aria-hidden
        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-rule-strong border-t-accent"
      />
      {label}
    </div>
  );
}
