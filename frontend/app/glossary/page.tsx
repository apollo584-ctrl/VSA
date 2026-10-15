import { GlossaryBrowser } from "@/components/knowledge/Glossary";
import { PageHeader } from "@/components/ui/primitives";

export default function GlossaryPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Glossary"
        description="A plain-language reference for the terms, measurements and pattern names used throughout the terminal."
      />
      <GlossaryBrowser />
    </div>
  );
}
