@echo off
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
  echo Python not found. Please install Python and add it to PATH.
  pause
  exit /b 1
)

echo.
echo   ================================
echo    GuiFan BiaoDa LianXi
echo   ================================
echo.

set PORT=8080

:tryport
netstat -ano | findstr ":%PORT% " >nul 2>&1
if errorlevel 1 goto launch
set /a PORT+=1
if %PORT% gtr 8090 (
  echo Ports 8080-8090 are all in use.
  pause
  exit /b 1
)
goto tryport

:launch
echo   http://localhost:%PORT%
echo   Close this window to stop.
echo.

start "" http://localhost:%PORT%

python -m http.server %PORT%
pause
