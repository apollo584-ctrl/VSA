"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { Badge, Button, KeyValue, Panel, Segmented } from "@/components/ui/primitives";
import { useUpload } from "@/hooks/data";
import { useWorkspace, type Theme } from "@/hooks/workspace";
import { API_BASE, API_MODE } from "@/lib/api/client";
import { toApiError } from "@/lib/api/errors";
import type { DetailLevel } from "@/types";

const MAX_BYTES = 10 * 1024 * 1024; // backend limit: 10 MiB

interface Meta {
  instrument: string;
  timeframe_minutes: number;
  session_mode: "regular" | "extended";
  timestamp_convention: "bar_start" | "bar_end";
  timezone: string;
  price_adjustment: "unadjusted" | "split_adjusted";
  volume_adjustment: "raw" | "split_adjusted";
  source_name: string;
  is_demo: boolean;
}

const DEFAULT_META: Meta = {
  instrument: "", timeframe_minutes: 5, session_mode: "regular", timestamp_convention: "bar_start", timezone: "America/New_York",
  price_adjustment: "unadjusted", volume_adjustment: "raw", source_name: "", is_demo: false,
};

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-subtle">{hint}</span>}
    </label>
  );
}
const inputCls = "h-8 rounded-md border border-border bg-surface-2 px-2 text-xs";

function UploadPanel() {
  const upload = useUpload();
  const qc = useQueryClient();
  const { selectInstrument } = useWorkspace();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<Meta>(DEFAULT_META);
  const [clientError, setClientError] = useState<string | null>(null);
  const set = <K extends keyof Meta>(k: K, v: Meta[K]) => setMeta((m) => ({ ...m, [k]: v }));

  const choose = (f: File | undefined) => {
    setClientError(null);
    upload.reset();
    if (!f) return setFile(null);
    if (!/\.(csv|txt)$/i.test(f.name)) { setFile(null); return setClientError("Unsupported file type. Upload a UTF-8 .csv with the header timestamp,open,high,low,close,volume."); }
    if (f.size === 0) { setFile(null); return setClientError("The selected file is empty."); }
    if (f.size > MAX_BYTES) { setFile(null); return setClientError(`File is too large (${(f.size / 1048576).toFixed(1)} MB; the limit is 10 MiB).`); }
    setFile(f);
  };

  const submit = () => {
    if (!file) return;
    if (!meta.instrument.trim() || !meta.source_name.trim()) return setClientError("Instrument and source name are required.");
    if ((meta.price_adjustment === "split_adjusted") !== (meta.volume_adjustment === "split_adjusted")) return setClientError("Prices and volume must share the same split-adjustment basis.");
    setClientError(null);
    upload.mutate({ file, metadata: { ...meta, instrument: meta.instrument.trim().toUpperCase(), source_name: meta.source_name.trim(), exchange: "XNYS" } }, {
      onSuccess: (r) => { if (r.accepted) void qc.invalidateQueries({ queryKey: ["instruments"] }); },
    });
  };

  const err = upload.error ? toApiError(upload.error) : null;
  const result = upload.data;
  return (
    <Panel title="Upload dataset">
      <p className="mb-3 text-xs text-muted">
        UTF-8 CSV with the exact header <code className="num">timestamp,open,high,low,close,volume</code>; each row is one completed bar. Nothing is resampled or filled.
        Source and adjustment details are <b>uploader-declared</b> and are not independently verified.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Instrument"><input aria-label="Instrument" className={inputCls} value={meta.instrument} onChange={(e) => set("instrument", e.target.value)} placeholder="DEMO" /></Field>
        <Field label="Bar interval (minutes)">
          <select aria-label="Bar interval" className={inputCls} value={meta.timeframe_minutes} onChange={(e) => set("timeframe_minutes", Number(e.target.value))}>{[1, 5, 15, 30, 60].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </Field>
        <Field label="Session mode">
          <select aria-label="Session mode" className={inputCls} value={meta.session_mode} onChange={(e) => set("session_mode", e.target.value as Meta["session_mode"])}><option value="regular">Regular</option><option value="extended">Extended (04:00–20:00 ET)</option></select>
        </Field>
        <Field label="Timestamp convention">
          <select aria-label="Timestamp convention" className={inputCls} value={meta.timestamp_convention} onChange={(e) => set("timestamp_convention", e.target.value as Meta["timestamp_convention"])}><option value="bar_start">Bar start</option><option value="bar_end">Bar end</option></select>
        </Field>
        <Field label="Timezone (for naive timestamps)"><input aria-label="Timezone" className={inputCls} value={meta.timezone} onChange={(e) => set("timezone", e.target.value)} /></Field>
        <Field label="Price adjustment">
          <select aria-label="Price adjustment" className={inputCls} value={meta.price_adjustment} onChange={(e) => set("price_adjustment", e.target.value as Meta["price_adjustment"])}><option value="unadjusted">Unadjusted</option><option value="split_adjusted">Split-adjusted</option></select>
        </Field>
        <Field label="Volume adjustment">
          <select aria-label="Volume adjustment" className={inputCls} value={meta.volume_adjustment} onChange={(e) => set("volume_adjustment", e.target.value as Meta["volume_adjustment"])}><option value="raw">Raw</option><option value="split_adjusted">Split-adjusted</option></select>
        </Field>
        <Field label="Source name"><input aria-label="Source name" className={inputCls} value={meta.source_name} onChange={(e) => set("source_name", e.target.value)} placeholder="e.g. vendor export" /></Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={meta.is_demo} onChange={(e) => set("is_demo", e.target.checked)} />This is demo / synthetic data</label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input ref={input} type="file" accept=".csv,.txt,text/csv" className="sr-only" aria-label="Choose dataset file" onChange={(e) => choose(e.target.files?.[0])} />
        <Button onClick={() => input.current?.click()} disabled={upload.isPending}><FileUp size={13} aria-hidden />Choose file</Button>
        <span className="text-xs text-muted">{file ? `${file.name} (${(file.size / 1024).toFixed(1)} KB)` : "No file selected"}</span>
        <Button variant="primary" onClick={submit} disabled={!file || upload.isPending}>{upload.isPending ? "Uploading…" : "Upload"}</Button>
      </div>

      <div className="mt-3 space-y-2" aria-live="polite">
        {clientError && <p role="alert" className="text-xs text-danger">{clientError}</p>}
        {err && <p role="alert" className="text-xs text-danger">Upload failed: {err.message}</p>}
        {result && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={result.accepted ? "ok" : "danger"}>{result.accepted ? "Dataset accepted" : "Rejected — nothing was stored"}</Badge>
              {result.accepted && meta.is_demo && <Badge tone="warn">demo data</Badge>}
              {result.accepted && result.datasetId && (
                <Button size="sm" onClick={() => { selectInstrument(result.datasetId!); router.push("/chart"); }}>Open in chart</Button>
              )}
            </div>
            {result.issues.length > 0 && <ul className="space-y-1">{result.issues.map((i) => <li key={i.code} className={i.severity === "error" ? "text-xs text-danger" : "text-xs text-warn"}>{i.message}</li>)}</ul>}
            {result.accepted && result.issues.length === 0 && <p className="text-xs text-muted">No data-quality warnings were reported.</p>}
          </div>
        )}
      </div>
    </Panel>
  );
}

export default function SettingsPage() {
  const { state, set } = useWorkspace();
  return (
    <div className="mx-auto grid max-w-5xl gap-3 md:grid-cols-2">
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
        <p className="mt-2 text-xs text-muted">Set <code className="num">NEXT_PUBLIC_API_MODE</code> and <code className="num">NEXT_PUBLIC_API_BASE_URL</code> (including <code className="num">/api/v1</code>) in <code className="num">.env.local</code>. Saved analyses are listed under <Link href="/history" className="text-accent hover:underline">Analysis History</Link>.</p>
      </Panel>
      <div className="md:col-span-2"><UploadPanel /></div>
    </div>
  );
}
