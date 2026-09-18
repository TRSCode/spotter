@echo off
cd /d "%~dp0"
echo Spotter v0 - http://localhost:8765
echo On your phone, use this PC's Wi-Fi IP and port 8765.
echo.
where node >nul 2>&1
if %errorlevel%==0 (
  npx --yes serve -l 8765 .
  goto :eof
)
where python >nul 2>&1
if %errorlevel%==0 (
  python -m http.server 8765
  goto :eof
)
where py >nul 2>&1
if %errorlevel%==0 (
  py -m http.server 8765
  goto :eof
)
echo Node and Python were not found.
echo In PowerShell run:  .\start.ps1
echo Or install Node LTS:  winget install OpenJS.NodeJS.LTS
pause
