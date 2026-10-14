"use client";

import { History as HistoryIcon, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { StateMessage } from "@/components/common/states";
import { Badge, Button, Panel } from "@/components/ui/primitives";
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
    <div className="mx-auto max-w-4xl">
      <Panel
        title="Analysis history"
        actions={items?.length ? <Button size="sm" variant="ghost" onClick={() => { clearHistory(); setItems([]); }}><Trash2 size={12} aria-hidden />Clear</Button> : undefined}
      >
        <p className="mb-3 text-xs text-muted">Analyses you have viewed in this browser. Stored locally only; nothing is uploaded.</p>
        {items === null ? null : items.length === 0 ? (
          <StateMessage icon={HistoryIcon} title="No analyses viewed yet">Select an instrument and its analysis will be listed here.</StateMessage>
        ) : (
          <ul className="space-y-1.5">
            {items.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => open(e)} className="flex w-full flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-left hover:bg-surface-3">
                  <span className="num font-semibold">{e.symbol}</span>
                  <Badge>{e.timeframe} · {e.session}</Badge>
                  <span className="text-xs text-muted">as of {fmtDateTime(e.asOf, true)}</span>
                  <span className="min-w-0 flex-1 truncate text-xs">{e.headline}</span>
                  <span className="text-[11px] text-subtle">viewed {new Date(e.viewedAt).toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
