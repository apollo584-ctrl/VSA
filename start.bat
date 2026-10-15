@echo off
rem Market Structure Terminal: start the analysis backend and the frontend, then open the app.
setlocal
set "ROOT=%~dp0"

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

echo Starting backend on http://127.0.0.1:8000 ...
start "MSI backend" /min /D "%ROOT%backend" "%ROOT%backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000

echo Starting frontend on http://localhost:3000 ...
start "MSI frontend" /min /D "%ROOT%frontend" cmd /c npx next dev -p 3000

rem Give the servers a few seconds to come up, then open the app.
ping -n 8 127.0.0.1 >nul
start "" http://localhost:3000/
echo.
echo Running. Use the Quit button in the app, or stop.bat, to stop both servers.
endlocal
exit /b 0
