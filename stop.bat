@echo off
rem Market Structure Terminal: stop the backend (port 8000) and the frontend (port 3000).
rem "stop.bat delay" waits two seconds first, so a caller that is itself stopped can still send its response.
setlocal
if /i "%~1"=="delay" ping -n 3 127.0.0.1 >nul
echo Stopping Market Structure Terminal...
rem Frontend first: the Quit button runs this script as a child of the backend, and taskkill /T on the backend
rem would end this script too, so the backend is stopped last.
call :stop_port 3000
call :stop_port 8000
echo Done.
endlocal
exit /b 0

:stop_port
set "FOUND="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%1 .*LISTENING"') do (
  set "FOUND=1"
  taskkill /PID %%p /T /F >nul 2>&1
)
if defined FOUND (echo Stopped port %1) else (echo Port %1 was not running)
goto :eof
