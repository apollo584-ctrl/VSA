"use client";

import { AlertTriangle, DatabaseZap, FileWarning, Inbox, Loader2, PlugZap, SearchX, WifiOff, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button, Skeleton } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

export function StateMessage({ icon: Icon = Inbox, title, children, action, tone = "neutral", className }: {
  icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; tone?: "neutral" | "warn" | "danger"; className?: string;
}) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex h-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center", className)}>
      <Icon size={26} aria-hidden className={cn(tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-subtle")} />
      <p className="text-sm font-semibold text-fg">{title}</p>
      {children && <div className="max-w-md text-xs leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export const NoDatasetState = ({ action }: { action?: ReactNode }) => (
  <StateMessage icon={DatabaseZap} title="No dataset selected" action={action}>
    Choose an instrument from the search above to load its bars and analysis. Nothing is shown until a dataset is selected.
  </StateMessage>
);

export const LoadingState = ({ label = "Loading analysis…" }: { label?: string }) => (
  <div role="status" aria-live="polite" className="flex h-full min-h-40 flex-col gap-2 p-3">
    <span className="flex items-center gap-2 text-xs text-muted"><Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />{label}</span>
    <Skeleton className="h-full min-h-32 w-full" />
  </div>
);

export const EmptyChartState = () => (
  <StateMessage icon={SearchX} title="No bars to display">
    The selected instrument, timeframe and date range returned no bars. Try another date or timeframe.
  </StateMessage>
);

export const NoPatternsState = ({ scope = "in this window" }: { scope?: string }) => (
  <StateMessage icon={SearchX} title="No patterns detected">
    The engine did not flag any VSA events {scope}. Absence of a pattern is not a signal in either direction — it only means no defined condition set was satisfied.
  </StateMessage>
);

export const InsufficientDataState = ({ message }: { message?: string | null }) => (
  <StateMessage icon={FileWarning} tone="warn" title="Insufficient data for analysis">
    {message ?? "There are not enough bars to compute profiles or patterns."} The chart may still be viewable, but no analytical conclusions are available and none should be inferred.
  </StateMessage>
);

export const InvalidDataState = ({ message }: { message?: string | null }) => (
  <StateMessage icon={AlertTriangle} tone="danger" title="Invalid data">
    {message ?? "The dataset or service response failed validation."} Analysis has been withheld rather than shown unverified.
  </StateMessage>
);

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const api = error instanceof ApiError ? error : null;
  if (api?.isInvalid) return <InvalidDataState message={api.message} />;
  if (api?.isUnavailable) {
    return (
      <StateMessage icon={WifiOff} tone="danger" title="Analysis service unavailable" action={onRetry && <Button onClick={onRetry}>Retry</Button>}>
        {api.message} No cached or fabricated data is shown in its place.
      </StateMessage>
    );
  }
  return (
    <StateMessage icon={PlugZap} tone="danger" title="Something went wrong" action={onRetry && <Button onClick={onRetry}>Retry</Button>}>
      {error.message}
    </StateMessage>
  );
}

export const MixedEvidenceNotice = () => (
  <div className="rounded-md border border-warn/40 bg-warn/10 p-2 text-xs text-warn" role="note">
    Evidence is mixed: observations point in different directions. Multiple readings remain plausible — see contradictions and scenarios below.
  </div>
);

export const NoRealtimeBadge = () => (
  <span className="text-[11px] text-subtle" title="This application reads historical or fixture data only.">No real-time connection</span>
);

export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="inline-flex h-8 items-center rounded-md border border-border bg-surface-2 px-3 text-xs font-medium hover:bg-surface-3">{children}</Link>;
}
