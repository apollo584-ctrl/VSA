@echo off
rem Market Structure Terminal: start the analysis backend and the frontend, then open the app.
setlocal
set "ROOT=%~dp0"
rem Edge profile folder to open the app in (see edge://version, "Profile path"; e.g. Default or "Profile 2").
set "EDGE_PROFILE=Default"

if not exist "%ROOT%backend\.venv\Scripts\python.exe" (
  echo Backend environment not found at backend\.venv.
  echo Create it first; see backend\README.md.
  pause
  exit /b 1
)

if not exist "%ROOT%frontend\node_modules" (
  echo Installing frontend packages (first run only^)...
  pushd "%ROOT%frontend"
  call npm install
  popd
)

rem Clear the ports first so a stale run cannot block the new one.
call "%ROOT%stop.bat" >nul

set "NEXT_PUBLIC_API_MODE=http"
set "NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api/v1"
set "MSI_STOP_SCRIPT=%ROOT%stop.bat"
set "MSI_AUTO_COLLECT=1"
rem Home network sharing (PIN login required for other devices; set a PIN first: backend\.venv\Scripts\python.exe -m scripts.set_pin from backend\).
rem Set MSI_SHARE_LAN=0 before running to keep the app on this PC only.
if not defined MSI_SHARE_LAN set "MSI_SHARE_LAN=1"
set "BIND_HOST=127.0.0.1"
if "%MSI_SHARE_LAN%"=="1" set "BIND_HOST=0.0.0.0"
rem Remote access: after installing Tailscale, put this PC's Tailscale address (100.x.y.z) here.
set "TUNNEL_HOST="
set "NEXT_PUBLIC_TUNNEL_HOST=%TUNNEL_HOST%"

echo Starting backend on http://127.0.0.1:8000 ...
start "MSI backend" /min /D "%ROOT%backend" "%ROOT%backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --host %BIND_HOST% --port 8000

echo Starting frontend on http://localhost:3000 ...
start "MSI frontend" /min /D "%ROOT%frontend" cmd /c npx next dev -H %BIND_HOST% -p 3000

rem Give the servers a few seconds to come up, then open the app.
ping -n 8 127.0.0.1 >nul
start "" msedge --profile-directory="%EDGE_PROFILE%" http://localhost:3000/ || start "" http://localhost:3000/
echo.
if "%MSI_SHARE_LAN%"=="1" echo Other devices on this network: http://^<this PC address^>:3000/ (PIN required)
echo Running. Use the Quit button in the app, or stop.bat, to stop both servers.
endlocal
exit /b 0
