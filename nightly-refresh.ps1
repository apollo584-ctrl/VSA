# Nightly data refresh: make sure the backend is running, then start the intraday collection.
# Run by the "VSA nightly refresh" Windows scheduled task (weekdays 8 PM); safe to run by hand any time.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$api = "http://127.0.0.1:8000/api/v1"

function Test-Up {
  try { (Invoke-RestMethod "$api/health" -TimeoutSec 5).status -eq "ok" } catch { $false }
}

if (-not (Test-Up)) {
  # Same settings as start.bat: automatic collection and alerts on, reachable on the home network unless MSI_SHARE_LAN=0.
  $env:MSI_AUTO_COLLECT = "1"
  $env:MSI_STOP_SCRIPT = Join-Path $root "stop.bat"
  $bind = if ($env:MSI_SHARE_LAN -eq "0") { "127.0.0.1" } else { "0.0.0.0" }
  Start-Process -FilePath (Join-Path $root "backend\.venv\Scripts\python.exe") `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", $bind, "--port", "8000" `
    -WorkingDirectory (Join-Path $root "backend") -WindowStyle Hidden
  for ($i = 0; $i -lt 30 -and -not (Test-Up); $i++) { Start-Sleep -Seconds 2 }
  if (-not (Test-Up)) { throw "The backend did not start." }
}

# A freshly started backend collects on its own only when its data is over 3 days old, so always ask for a run.
$status = Invoke-RestMethod -Method Post "$api/intraday/collect" -TimeoutSec 30
"{0} collection: running={1} done={2}/{3}" -f (Get-Date -Format s), $status.running, $status.done, $status.total
