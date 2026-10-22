import { Check, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// A first-class sidebar item: icon + label.
// Clicking it opens a flyout panel to the right of the sidebar. The panel is
// portalled to <body> so the sidebar's scroll container doesn't clip it; it
// closes on outside click or Escape.
export function SidebarMenu({
  icon,
  label,
  title,
  children,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  children: (close: () => void) => ReactNode;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;
  const close = () => setPos(null);

  const toggle = () => {
    if (open) return close();
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    const sidebar = buttonRef.current?.closest("aside")?.getBoundingClientRect();
    setPos({ left: (sidebar?.right ?? r.right) + 8, top: Math.max(8, r.top) });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left",
          open ? "bg-panel-2 text-fg" : "text-muted hover:bg-panel-2 hover:text-fg",
        )}
      >
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{label}</span>
        <ChevronRight size={13} className="shrink-0" />
      </button>

      {pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ left: pos.left, top: pos.top, maxHeight: `calc(100vh - ${pos.top + 8}px)` }}
            className="fixed z-50 flex w-96 flex-col overflow-y-auto rounded-lg border border-border bg-panel text-xs shadow-2xl"
          >
            <div className="border-border border-b px-3.5 py-2.5 font-semibold text-fg text-sm">{title}</div>
            <div className="p-1.5">{children(close)}</div>
          </div>,
          document.body,
        )}
    </>
  );
}

export interface ColorOption<K extends string> {
  key: K;
  label: string;
  icon?: ReactNode;
  description: string;
  // What the cool (0) and hot (high) ends of a heat scale mean.
  low?: string;
  high?: string;
}

const STOPS = [0, 0.25, 0.5, 0.75, 1];

// Selectable list of coloring options, each with a description of what its
// colors mean. Heat lists pass `scale` to show the shared 0 → high gradient
// once at the top.
export function ColorOptionList<K extends string>({
  options,
  value,
  onChange,
  scale,
}: {
  options: ColorOption<K>[];
  value: K;
  onChange: (k: K) => void;
  scale?: (t: number) => string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {scale && (
        <div className="flex flex-col gap-1 px-2 pt-1 pb-2 text-[11px] text-muted">
          <div className="flex items-center gap-2">
            0
            <span className="flex h-2.5 flex-1 overflow-hidden rounded-sm">
              {STOPS.map((s) => (
                <span key={s} className="h-full flex-1" style={{ background: scale(s) }} />
              ))}
            </span>
            High
          </div>
          <span className="text-[10px]">
            Colors follow each model's rank, so one extreme model can't wash out the rest.
          </span>
        </div>
      )}
      {options.map((o) => {
        const selected = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={cn(
              "flex items-start gap-2 rounded-md px-2 py-2 text-left",
              selected ? "bg-accent/15 ring-1 ring-accent/40" : "hover:bg-panel-2",
            )}
          >
            <span className={cn("mt-px shrink-0", selected ? "text-accent" : "text-muted")}>{o.icon}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-[11px] text-muted leading-snug">
              <span className="mb-0.5 font-medium text-fg text-xs">{o.label}</span>
              <span>{o.description}</span>
              {o.low && (
                <span>
                  <span className="font-medium text-fg">0</span> = {o.low}
                </span>
              )}
              {o.high && (
                <span>
                  <span className="font-medium text-fg">High</span> = {o.high}
                </span>
              )}
            </span>
            <span className="mt-0.5 w-3.5 shrink-0 text-accent">{selected && <Check size={13} />}</span>
          </button>
        );
      })}
    </div>
  );
}

// On/off switch row: label + description on the left, the switch on the right.
export function SwitchRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-panel-2 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium text-fg">{label}</span>
        <span className="text-[11px] text-muted leading-snug">{description}</span>
      </span>
      <span
        className={cn(
          "mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
          checked ? "bg-accent" : "bg-border",
        )}
      >
        <span
          className={cn(
            "h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}
