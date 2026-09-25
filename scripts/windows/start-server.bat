@echo off
rem ======================= CONFIG =======================
rem Folder containing all the Unity app folders (each with its own Start.bat).
set "APPS_DIR=C:\Exhibit\Apps"
rem Optional overrides (defaults shown):
rem set "PORT=8080"
rem set "HORN_FILE=%~dp0..\..\assets\horn.wav"
rem set "ARDUINO_PORT=COM5"
rem ======================================================
rem Put a shortcut to this file in the Windows Startup folder (Win+R ->
rem shell:startup) so the gateway starts with the PC. It restarts the server
rem automatically if it ever crashes. Close this window to stop it for good.

title Train Simulator Gateway
cd /d "%~dp0..\.."

:loop
node src\server.js
echo [start-server] server exited (code %errorlevel%) - restarting in 3s...
timeout /t 3 /nobreak >nul
goto loop
