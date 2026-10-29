"use client";

import { ScanBoard } from "@/components/scan/ScanBoard";
import { PageHeader } from "@/components/ui/primitives";

export default function ScanPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader title="Scanner" description="S&P 500 symbols where several readings line up on hypothesized potential strength or potential weakness. Hypotheses, not signals." />
      <ScanBoard />
    </div>
  );
}
