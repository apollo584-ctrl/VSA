import { KnowledgeBrowser } from "@/components/knowledge/Knowledge";

export default function KnowledgePage() {
  return (
    <div className="mx-auto max-w-7xl space-y-3">
      <header>
        <h1 className="text-lg font-semibold">Knowledge Explorer</h1>
        <p className="text-xs text-muted">Definitions, context and alternative explanations for the concepts the analysis engine uses. Relationships are contextual, not causal guarantees.</p>
      </header>
      <KnowledgeBrowser />
    </div>
  );
}
