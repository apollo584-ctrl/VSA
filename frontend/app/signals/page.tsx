"use client";

import { SignalsBoard } from "@/components/signals/SignalsBoard";
import { PageHeader } from "@/components/ui/primitives";

export default function SignalsPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader title="Signals" description="Today's setups that held up in the study, and how saved alerts played out. History, not a forecast." />
      <SignalsBoard />
    </div>
  );
}
