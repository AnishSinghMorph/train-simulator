@echo off
rem ======================= CONFIG =======================
rem All optional - defaults shown. Uncomment and edit only if needed.
rem Folder with the Unity build's Start_*.bat files (BLACK button starts them):
rem set "APPS_DIR=%USERPROFILE%\AppData\LocalLow\GetMorph\QuestRail"
rem Uncomment to have S run the Unity build's LaunchAll.bat instead of
rem starting each screen directly (may bring back SmartScreen "Run?" prompts):
rem set "USE_LAUNCHALL=1"
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
