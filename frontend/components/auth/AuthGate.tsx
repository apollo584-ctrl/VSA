"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Lock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { StateMessage } from "@/components/common/states";
import { Button, Segmented } from "@/components/ui/primitives";
import { useAuthStatus, useLogin } from "@/hooks/data";
import { API_MODE } from "@/lib/api/client";
import { setUnauthorizedHandler } from "@/lib/api/backend/client";
import { authErrorMessage } from "@/lib/api/errors";

type Tab = "home" | "remote" | "pc";

/** Hostname of the private tunnel (Tailscale), read at render time; empty when not configured. */
function getTunnelHost(): string {
  return (process.env.NEXT_PUBLIC_TUNNEL_HOST ?? "").trim();
}

function currentHostname(): string {
  return typeof window === "undefined" ? "" : window.location.hostname;
}

function PinForm() {
  const [pin, setPin] = useState("");
  const login = useLogin();
  const valid = /^\d{6,12}$/.test(pin);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || login.isPending) return;
    login.mutate(pin, { onSettled: () => setPin("") });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        aria-label="PIN"
        placeholder="PIN"
        maxLength={12}
        autoFocus
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        className="h-11 w-full rounded-xl border border-border bg-surface-2 px-4 text-center text-lg tracking-widest placeholder:text-subtle focus:border-accent/60 focus:bg-surface focus:outline-none"
      />
      {login.isError && <p role="alert" className="text-center text-xs text-danger">{authErrorMessage(login.error)}</p>}
      <Button type="submit" variant="primary" disabled={!valid || login.isPending}>
        {login.isPending ? <><Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> Unlocking…</> : "Connect"}
      </Button>
    </form>
  );
}

function RemoteTab({ tunnelHost }: { tunnelHost: string }) {
  if (!tunnelHost) {
    return (
      <p className="text-center text-xs text-muted">
        Remote access is not set up yet. Install Tailscale on this PC and your laptop, then put this PC&apos;s Tailscale address in start.bat (TUNNEL_HOST).
      </p>
    );
  }
  if (currentHostname() === tunnelHost) return <PinForm />;
  const goToTunnel = () => {
    window.location.assign(`http://${tunnelHost}:${window.location.port}${window.location.pathname}`);
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-center text-sm text-fg">Connect through your private tunnel.</p>
      <Button type="button" variant="primary" onClick={goToTunnel}>Connect</Button>
    </div>
  );
}

function PinScreen() {
  const [tab, setTab] = useState<Tab>("home");
  const goToLocalhost = () => {
    window.location.assign(`http://localhost:${window.location.port}${window.location.pathname}`);
  };
  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-4">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <div className="flex flex-col items-center gap-2 text-center">
          <Lock size={26} aria-hidden className="text-subtle" />
          <h1 className="text-base font-semibold text-fg">Market Structure Terminal</h1>
          <p className="text-xs text-muted">Enter the PIN to continue.</p>
        </div>
        <div className="flex justify-center">
          <Segmented<Tab>
            label="Connection method"
            value={tab}
            onChange={setTab}
            options={[
              { value: "home", label: "Home network" },
              { value: "remote", label: "Remote" },
              { value: "pc", label: "This PC" },
            ]}
          />
        </div>
        {tab === "home" && <PinForm />}
        {tab === "remote" && <RemoteTab tunnelHost={getTunnelHost()} />}
        {tab === "pc" && (
          <div className="flex flex-col gap-3">
            <p className="text-center text-sm text-fg">Use this when you are at the PC running the dashboard.</p>
            <Button type="button" variant="primary" onClick={goToLocalhost}>Connect</Button>
            <p className="text-center text-xs text-muted">On any other device this will not connect. Use the PIN tab instead.</p>
          </div>
        )}
      </div>
    </main>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const status = useAuthStatus();
  useEffect(() => {
    setUnauthorizedHandler(() => { void qc.invalidateQueries({ queryKey: ["auth"] }); });
    return () => setUnauthorizedHandler(null);
  }, [qc]);

  if (status.isPending) return <div className="grid min-h-dvh place-items-center bg-bg"><StateMessage icon={Loader2} title="Checking access…" /></div>;
  if (status.isError) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg">
        <StateMessage tone="danger" title="Cannot reach the analysis service" action={<Button onClick={() => status.refetch()}>Try again</Button>}>
          {authErrorMessage(status.error)}
        </StateMessage>
      </div>
    );
  }
  if (status.data.local || status.data.authenticated) return <>{children}</>;
  return <PinScreen />;
}

/** Shows a PIN screen to remote devices until they unlock; the host PC (local) and mock mode skip it. */
export function AuthGate({ children }: { children: ReactNode }) {
  if (API_MODE === "mock") return <>{children}</>;
  return <Gate>{children}</Gate>;
}
