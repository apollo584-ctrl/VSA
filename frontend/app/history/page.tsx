"use client";

import { History as HistoryIcon, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { StateMessage } from "@/components/common/states";
import { Badge, Button, PageHeader, Panel } from "@/components/ui/primitives";
import { useWorkspace } from "@/hooks/workspace";
import { fmtDateTime } from "@/lib/formatting";
import { clearHistory, loadHistory, type HistoryEntry } from "@/lib/history";

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryEntry[] | null>(null);
  const { set } = useWorkspace();
  const router = useRouter();
  useEffect(() => setItems(loadHistory()), []);

  const open = (e: HistoryEntry) => {
    set({ symbol: e.symbol, timeframe: e.timeframe, session: e.session, date: e.date, replayTime: null, selectedEventId: null });
    router.push("/");
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Analysis History"
        description="Analyses you have viewed in this browser. Stored locally only; nothing is uploaded."
        actions={items?.length ? <Button size="sm" variant="ghost" onClick={() => { clearHistory(); setItems([]); }}><Trash2 size={14} aria-hidden />Clear history</Button> : undefined}
      />
      <Panel>
        {items === null ? null : items.length === 0 ? (
          <StateMessage icon={HistoryIcon} title="No analyses viewed yet">Select an instrument and its analysis will be listed here.</StateMessage>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((e) => (
              <li key={e.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <button type="button" onClick={() => open(e)} className="group flex min-w-0 flex-1 flex-col gap-1 text-left">
                  <span className="flex flex-wrap items-center gap-3">
                    <span className="text-base font-semibold group-hover:text-accent">{(e.label ?? e.symbol).split(" · ")[0]}</span>
                    <Badge>{e.timeframe} · {e.session}</Badge>
                    <span className="text-sm text-fg">{e.headline}</span>
                  </span>
                  <span className="text-xs text-subtle">As of {fmtDateTime(e.asOf, true)} · viewed {new Date(e.viewedAt).toLocaleString()}</span>
                </button>
                {e.snapshotId && <Link href={`/snapshot/${e.snapshotId}`} className="text-sm font-medium text-accent hover:underline">Open saved snapshot →</Link>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
