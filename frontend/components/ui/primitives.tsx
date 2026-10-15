"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown, Info } from "lucide-react";
import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ---------------- Button ----------------
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition-colors disabled:opacity-45 disabled:pointer-events-none select-none",
  {
    variants: {
      variant: {
        default: "bg-surface-2 border-border hover:bg-surface-3 text-fg",
        primary: "bg-accent border-transparent text-white hover:brightness-110 shadow-sm",
        ghost: "bg-transparent border-transparent hover:bg-surface-2 text-muted hover:text-fg",
        outline: "bg-transparent border-border-strong hover:bg-surface-2 text-fg",
      },
      size: { sm: "h-8 px-3 text-xs", md: "h-9 px-4 text-sm", icon: "h-9 w-9 text-sm" },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export function Button({ className, variant, size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button type="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

// ---------------- Badge ----------------
const badgeVariants = cva("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "border-border text-muted bg-surface-2",
      info: "border-transparent text-accent bg-accent-soft",
      warn: "border-transparent text-warn bg-warn/12",
      danger: "border-transparent text-danger bg-danger/12",
      ok: "border-transparent text-ok bg-ok/12",
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
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-72 -translate-x-1/2 rounded-lg border border-border-strong bg-surface-3 px-3 py-2 text-xs font-normal leading-relaxed text-fg opacity-0 shadow-lg transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
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
      <span tabIndex={0} aria-label="More information" className="inline-flex text-subtle hover:text-fg"><Info size={14} aria-hidden /></span>
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
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg bg-surface-2 p-1">
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
            "shrink-0 whitespace-nowrap rounded-md px-3 font-medium transition-colors disabled:opacity-35",
            size === "sm" ? "h-7 text-xs" : "h-7 text-sm",
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
        "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors",
        checked ? "border-border-strong bg-surface-3 text-fg" : "border-border bg-transparent text-subtle hover:text-fg",
      )}
    >
      {swatch && <span aria-hidden className="inline-block h-0 w-3.5 border-t-2" style={{ borderColor: swatch, borderStyle: dashed ? "dashed" : "solid", opacity: checked ? 1 : 0.4 }} />}
      {label}
    </button>
  );
}

// ---------------- Panel (card) ----------------
export function Panel({ title, description, actions, children, className, bodyClassName, collapsible = false, defaultOpen = true, id }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; collapsible?: boolean; defaultOpen?: boolean; id?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section id={id} className={cn("flex min-h-0 flex-col rounded-xl border border-border bg-surface shadow-[var(--shadow)]", className)}>
      {title !== undefined && (
        <header className="flex shrink-0 flex-wrap items-start justify-between gap-x-3 gap-y-2 px-5 pt-4">
          <div className="min-w-0">
            {collapsible ? (
              <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)} className="-ml-1 flex items-center gap-1.5 rounded-md px-1 text-sm font-semibold text-fg hover:text-accent">
                <ChevronDown size={16} aria-hidden className={cn("text-subtle transition-transform", !open && "-rotate-90")} />
                {title}
              </button>
            ) : (
              <h2 className="text-sm font-semibold text-fg">{title}</h2>
            )}
            {description && <p className="mt-0.5 text-xs text-subtle">{description}</p>}
          </div>
          {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {(!collapsible || open) && <div id={bodyId} className={cn("min-h-0 flex-1 px-5 pb-5", title !== undefined ? "pt-3" : "pt-5", bodyClassName)}>{children}</div>}
      {collapsible && !open && <div className="h-4" aria-hidden />}
    </section>
  );
}

/** Page title row: what this screen is, plus page-level actions. */
export function PageHeader({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 text-xs font-semibold text-subtle">{children}</h3>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

export function KeyValue({ k, v, hint }: { k: ReactNode; v: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt className="text-muted">{hint ? <InfoLabel hint={hint}>{k}</InfoLabel> : k}</dt>
      <dd className="num min-w-0 break-all text-right font-medium text-fg">{v}</dd>
    </div>
  );
}

function InfoLabel({ children, hint }: { children: ReactNode; hint: ReactNode }) {
  return <Term hint={hint}>{children}</Term>;
}
