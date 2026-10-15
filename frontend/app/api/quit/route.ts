import { spawn } from "node:child_process";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Quit button target. Runs stop.bat (the same script as the command line), after a short delay so this response
 * reaches the browser first. Localhost only, and it requires a custom header: a cross-site page cannot send that
 * without a CORS preflight, which this route does not grant, so other websites cannot shut the app down.
 */
export async function POST(request: Request) {
  if (!LOCAL_HOSTS.has(new URL(request.url).hostname) || request.headers.get("x-msi-action") !== "quit") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const script = process.env["MSI_STOP_SCRIPT"];
  if (!script) {
    return NextResponse.json({ error: "Quit is only available when the app is started with start.bat." }, { status: 501 });
  }
  // cmd /c with doubled outer quotes keeps a path containing spaces intact. Verbatim arguments stop Node from
  // escaping the inner quotes, which cmd would not understand.
  const child = spawn("cmd.exe", ["/d", "/c", `""${script}" delay"`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    windowsVerbatimArguments: true,
  });
  child.unref();
  return NextResponse.json({ stopping: true });
}
