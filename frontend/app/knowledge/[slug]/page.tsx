import { ConceptDetail } from "@/components/knowledge/Knowledge";

export default async function ConceptPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ConceptDetail slug={slug} />;
}
