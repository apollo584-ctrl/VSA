# Nightly data refresh. The backend stays off during the day: this script (run by the "VSA nightly refresh" scheduled
# task, weekdays 8 PM; safe to run by hand any time) starts it, pulls the day's market data, generates the alerts, and
# stops the backend again. If the backend was already running (you were using the dashboard), it is left running.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$api = "http://127.0.0.1:8000/api/v1"
$deadline = (Get-Date).AddMinutes(50)
$logs = Join-Path $root "backend\logs"
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$stamp = Get-Date -Format yyyyMMdd
Start-Transcript -Path (Join-Path $logs "nightly-$stamp.log") -Append | Out-Null
try {

function Test-Up {
  try { (Invoke-RestMethod "$api/health" -TimeoutSec 5).status -eq "ok" } catch { $false }
}

# True while the job is still working. A slow or failed answer counts as "still working" (the database is busy while saving).
function Test-Running($path) {
  try {
    $r = Invoke-RestMethod "$api/$path" -TimeoutSec 90
    $job = if ($r.PSObject.Properties["status"]) { $r.status } else { $r }  # /intraday wraps the job status, /alerts/status is it
    [bool]$job.running
  } catch { $true }
}

function Wait-Done($path, $what) {
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 20
    if (-not (Test-Running $path)) { return }
  }
  Write-Output ("{0} {1} did not finish within the time limit; leaving it." -f (Get-Date -Format s), $what)
}

$started = $false
if (-not (Test-Up)) {
  # Same settings as start.bat: automatic collection and alerts on, reachable on the home network unless MSI_SHARE_LAN=0.
  $env:MSI_AUTO_COLLECT = "1"
  $env:MSI_STOP_SCRIPT = Join-Path $root "stop.bat"
  $bind = if ($env:MSI_SHARE_LAN -eq "0") { "127.0.0.1" } else { "0.0.0.0" }
  Start-Process -FilePath (Join-Path $root "backend\.venv\Scripts\python.exe") `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", $bind, "--port", "8000" `
    -WorkingDirectory (Join-Path $root "backend") -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "backend-$stamp.log") `
    -RedirectStandardError (Join-Path $logs "backend-$stamp.err.log")
  for ($i = 0; $i -lt 30 -and -not (Test-Up); $i++) { Start-Sleep -Seconds 2 }
  if (-not (Test-Up)) { throw "The backend did not start." }
  $started = $true
}

# A freshly started backend collects on its own only when its data is over 3 days old, so always ask for a run.
Invoke-RestMethod -Method Post "$api/intraday/collect" -TimeoutSec 30 | Out-Null
Write-Output ("{0} collection started" -f (Get-Date -Format s))
Wait-Done "intraday" "collection"

# Alerts need the day's data above first; the backend's own timer may already have started them, which is fine.
Invoke-RestMethod -Method Post "$api/alerts/run" -TimeoutSec 30 | Out-Null
Start-Sleep -Seconds 5
Wait-Done "alerts/status" "alerts"
Write-Output ("{0} refresh finished" -f (Get-Date -Format s))

if ($started) {
  # Only the backend: the frontend is not part of this job.
  Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Write-Output ("{0} backend stopped" -f (Get-Date -Format s))
}

} finally {
  Stop-Transcript | Out-Null
}
