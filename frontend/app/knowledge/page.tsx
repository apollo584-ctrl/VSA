import { KnowledgeBrowser } from "@/components/knowledge/Knowledge";
import { PageHeader } from "@/components/ui/primitives";

export default function KnowledgePage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader title="Knowledge Explorer" description="Definitions, context and alternative explanations for the concepts the analysis engine uses. Relationships are contextual, not causal guarantees." />
      <KnowledgeBrowser />
    </div>
  );
}
