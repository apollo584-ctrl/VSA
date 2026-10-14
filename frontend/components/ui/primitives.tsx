"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown, Info } from "lucide-react";
import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ---------------- Button ----------------
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md border text-xs font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none select-none",
  {
    variants: {
      variant: {
        default: "bg-surface-2 border-border hover:bg-surface-3 text-fg",
        primary: "bg-accent border-accent text-[#06101f] hover:opacity-90",
        ghost: "bg-transparent border-transparent hover:bg-surface-2 text-muted hover:text-fg",
        outline: "bg-transparent border-border hover:bg-surface-2 text-fg",
      },
      size: { sm: "h-7 px-2", md: "h-8 px-3", icon: "h-7 w-7" },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export function Button({ className, variant, size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button type="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

// ---------------- Badge ----------------
const badgeVariants = cva("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "border-border-strong text-muted bg-surface-2",
      info: "border-accent/40 text-accent bg-accent-soft",
      warn: "border-warn/50 text-warn bg-warn/10",
      danger: "border-danger/50 text-danger bg-danger/10",
      ok: "border-ok/50 text-ok bg-ok/10",
      hypothesis: "border-dashed border-hyp/60 text-hyp bg-hyp-soft",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export function Badge({ tone, className, children, title }: VariantProps<typeof badgeVariants> & { className?: string; children: ReactNode; title?: string }) {
  return <span title={title} className={cn(badgeVariants({ tone }), className)}>{children}</span>;
}

// ---------------- Tooltip / Term ----------------
/** Accessible hover/focus tooltip. Content is also exposed to assistive tech via aria-describedby. */
export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" }) {
  const id = useId();
  return (
    <span className="group relative inline-flex" aria-describedby={id}>
      {children}
      <span
        role="tooltip"
        id={id}
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-64 -translate-x-1/2 rounded-md border border-border-strong bg-surface-3 px-2 py-1.5 text-[11px] font-normal leading-snug text-fg opacity-0 shadow-lg transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
        )}
      >
        {content}
      </span>
    </span>
  );
}

/** Glossary term with an explanatory tooltip. Keyboard-focusable. */
export function Term({ children, hint }: { children: ReactNode; hint: ReactNode }) {
  return (
    <Tooltip content={hint}>
      <span tabIndex={0} className="cursor-help border-b border-dotted border-subtle">{children}</span>
    </Tooltip>
  );
}

export function InfoTip({ children }: { children: ReactNode }) {
  return (
    <Tooltip content={children}>
      <span tabIndex={0} aria-label="More information" className="inline-flex text-subtle hover:text-fg"><Info size={12} aria-hidden /></span>
    </Tooltip>
  );
}

/** Standard glossary used across screens so specialist terms are explained identically everywhere. */
export const GLOSSARY = {
  POC: "Point of Control: the price with the most TPO counts or volume in the profile.",
  VAH: "Value Area High: upper boundary of the range holding ~70% of activity.",
  VAL: "Value Area Low: lower boundary of the range holding ~70% of activity.",
  HVN: "High-volume node: a price area with concentrated activity (prior acceptance).",
  LVN: "Low-volume node: a price area with little activity (prior rapid movement).",
  IB: "Initial balance: the range of the first period(s) of the session.",
  TPO: "Time Price Opportunity: one unit of time spent at a price.",
  VSA: "Volume Spread Analysis: reading volume together with bar spread and close location.",
} as const;

// ---------------- Segmented control ----------------
export function Segmented<T extends string>({ value, onChange, options, label, size = "md" }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[]; label: string; size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-border bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded px-2 text-xs font-medium transition-colors disabled:opacity-40",
            size === "sm" ? "h-6" : "h-7",
            o.value === value ? "bg-surface-3 text-fg shadow-sm" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------- Toggle ----------------
export function Toggle({ checked, onChange, label, swatch, dashed }: { checked: boolean; onChange: () => void; label: string; swatch?: string; dashed?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors",
        checked ? "border-border-strong bg-surface-3 text-fg" : "border-border bg-transparent text-subtle hover:text-fg",
      )}
    >
      {swatch && <span aria-hidden className="inline-block h-0 w-3 border-t-2" style={{ borderColor: swatch, borderStyle: dashed ? "dashed" : "solid", opacity: checked ? 1 : 0.4 }} />}
      {label}
    </button>
  );
}

// ---------------- Panel ----------------
export function Panel({ title, actions, children, className, bodyClassName, collapsible = false, defaultOpen = true, id }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; collapsible?: boolean; defaultOpen?: boolean; id?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section id={id} className={cn("flex min-h-0 flex-col rounded-lg border border-border bg-surface", className)}>
      {title !== undefined && (
        <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
          {collapsible ? (
            <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted hover:text-fg">
              <ChevronDown size={14} aria-hidden className={cn("transition-transform", !open && "-rotate-90")} />
              {title}
            </button>
          ) : (
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
          )}
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
      )}
      {(!collapsible || open) && <div id={bodyId} className={cn("min-h-0 flex-1 p-3", bodyClassName)}>{children}</div>}
    </section>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">{children}</h3>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

export function KeyValue({ k, v, hint }: { k: ReactNode; v: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className="text-muted">{hint ? <InfoLabel hint={hint}>{k}</InfoLabel> : k}</dt>
      <dd className="num text-right text-fg">{v}</dd>
    </div>
  );
}

function InfoLabel({ children, hint }: { children: ReactNode; hint: ReactNode }) {
  return <Term hint={hint}>{children}</Term>;
}
