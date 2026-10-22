"use client";

import { PlanBoard } from "@/components/plan/PlanBoard";
import { PageHeader } from "@/components/ui/primitives";

export default function PlanPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader title="Today's Plan" description="Morning checklist, setup status, position size and your trade journal, in one place." />
      <PlanBoard />
    </div>
  );
}
