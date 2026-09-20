@echo off
cd /d "%~dp0"
echo Spotter v0.6 - http://localhost:8765
echo On the phone use http://THIS-PC-LAN-IP:8765
echo If the phone cannot connect, allow port 8765 in Windows Firewall.
echo.
where node >nul 2>&1
if %errorlevel%==0 (
  npx --yes serve -l 8765 .
  goto :eof
)
where python >nul 2>&1
if %errorlevel%==0 (
  python -m http.server 8765 --bind 0.0.0.0
  goto :eof
)
where py >nul 2>&1
if %errorlevel%==0 (
  py -m http.server 8765 --bind 0.0.0.0
  goto :eof
)
echo Node and Python were not found.
echo In PowerShell run:  .\start.ps1
echo Or install Node LTS:  winget install OpenJS.NodeJS.LTS
pause
