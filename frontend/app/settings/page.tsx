"use client";

import { FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { Badge, Button, KeyValue, Panel, Segmented } from "@/components/ui/primitives";
import { useUpload } from "@/hooks/data";
import { useWorkspace, type Theme } from "@/hooks/workspace";
import { API_BASE, API_MODE } from "@/lib/api/client";
import { toApiError } from "@/lib/api/errors";
import type { DetailLevel } from "@/types";

const MAX_BYTES = 25 * 1024 * 1024;

function UploadPanel() {
  const upload = useUpload();
  const input = useRef<HTMLInputElement>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const onFile = (file: File | undefined) => {
    setClientError(null);
    upload.reset();
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) return setClientError("Unsupported file type. Upload a .csv file with time, open, high, low, close, volume columns.");
    if (file.size === 0) return setClientError("The selected file is empty.");
    if (file.size > MAX_BYTES) return setClientError(`File is too large (${(file.size / 1048576).toFixed(1)} MB; limit 25 MB).`);
    upload.mutate(file);
  };

  const err = upload.error ? toApiError(upload.error) : null;
  return (
    <Panel title="Upload dataset">
      <p className="mb-2 text-xs text-muted">CSV with columns <code className="num">time, open, high, low, close, volume</code>. Validation is performed by the backend; this panel only reports its findings.</p>
      <input ref={input} type="file" accept=".csv,.txt,text/csv" className="sr-only" aria-label="Choose dataset file" onChange={(e) => onFile(e.target.files?.[0])} />
      <Button onClick={() => input.current?.click()} disabled={upload.isPending}><FileUp size={13} aria-hidden />{upload.isPending ? "Uploading…" : "Choose file"}</Button>
      <div className="mt-3 space-y-1.5" aria-live="polite">
        {clientError && <p role="alert" className="text-xs text-danger">{clientError}</p>}
        {err && <p role="alert" className="text-xs text-danger">Upload failed: {err.message}</p>}
        {upload.data && (
          <>
            <Badge tone={upload.data.accepted ? "ok" : "danger"}>{upload.data.accepted ? "Accepted" : "Rejected"}</Badge>
            <ul className="space-y-1">{upload.data.issues.map((i) => <li key={i.code} className={i.severity === "error" ? "text-xs text-danger" : "text-xs text-warn"}>{i.message}</li>)}</ul>
          </>
        )}
      </div>
    </Panel>
  );
}

export default function SettingsPage() {
  const { state, set } = useWorkspace();
  return (
    <div className="mx-auto grid max-w-4xl gap-3 md:grid-cols-2">
      <Panel title="Appearance & reading">
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between gap-3"><span>Theme</span><Segmented<Theme> label="Theme" value={state.theme} onChange={(theme) => set({ theme })} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} /></div>
          <div className="flex items-center justify-between gap-3"><span>Default explanation depth</span><Segmented<DetailLevel> label="Explanation depth" value={state.detailLevel} onChange={(detailLevel) => set({ detailLevel })} options={[{ value: "quick", label: "Quick" }, { value: "standard", label: "Standard" }, { value: "deep", label: "Deep" }]} /></div>
          <p className="text-muted">Depth changes how much is shown, not what the engine found.</p>
        </div>
      </Panel>
      <Panel title="Data connection">
        <dl className="text-xs">
          <KeyValue k="API mode" v={<Badge tone={API_MODE === "mock" ? "warn" : "info"}>{API_MODE}</Badge>} />
          <KeyValue k="Backend URL" v={API_MODE === "mock" ? "— (fixtures)" : API_BASE || "not configured"} />
          <KeyValue k="Real-time feed" v="Not connected" />
        </dl>
        <p className="mt-2 text-xs text-muted">Set <code className="num">NEXT_PUBLIC_API_MODE</code> and <code className="num">NEXT_PUBLIC_API_BASE_URL</code> in <code className="num">.env.local</code>. Mock mode uses synthetic fixtures only.</p>
      </Panel>
      <div className="md:col-span-2"><UploadPanel /></div>
    </div>
  );
}
