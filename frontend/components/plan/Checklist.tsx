"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/primitives";
import { CHECKLIST_ITEMS, KEYS, readJson, writeJson } from "@/lib/planStorage";

export function Checklist({ date }: { date: string }) {
  const [ticks, setTicks] = useState<boolean[]>(() => CHECKLIST_ITEMS.map(() => false));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const saved = readJson<boolean[]>(KEYS.checklist(date), []);
    setTicks(CHECKLIST_ITEMS.map((_, i) => saved[i] === true));
    setLoaded(true);
  }, [date]);

  const toggle = (i: number) => {
    const next = ticks.map((t, j) => (j === i ? !t : t));
    setTicks(next);
    if (loaded) writeJson(KEYS.checklist(date), next);
  };
  const done = ticks.filter(Boolean).length;

  return (
    <Panel title="Before the session" description={`${done} of ${CHECKLIST_ITEMS.length} done for ${date}. Your ticks are saved on this device.`}>
      <ul className="flex flex-col gap-2">
        {CHECKLIST_ITEMS.map((text, i) => (
          <li key={text}>
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--color-accent,currentColor)]" checked={ticks[i]} onChange={() => toggle(i)} />
              <span className={ticks[i] ? "text-muted line-through" : ""}>{text}</span>
            </label>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
