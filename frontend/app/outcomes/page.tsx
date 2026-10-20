"use client";

import { OutcomesBoard } from "@/components/outcomes/OutcomesBoard";
import { PageHeader } from "@/components/ui/primitives";

export default function OutcomesPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader title="Pattern Stats" description="How past signals played out on daily bars. Results are historical and not a forecast." />
      <OutcomesBoard />
    </div>
  );
}
