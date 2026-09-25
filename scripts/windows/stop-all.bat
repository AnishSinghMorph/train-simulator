@echo off
setlocal
rem Stops every Unity app under APPS_DIR (arg 1): kills each .exe that sits
rem next to a Start.bat. Used by "Restart App".

set "APPS_DIR=%~1"
if "%APPS_DIR%"=="" (
  echo [stop-all] usage: stop-all.bat "C:\path\to\apps"
  exit /b 2
)
if not exist "%APPS_DIR%\" (
  echo [stop-all] APPS_DIR not found: %APPS_DIR%
  exit /b 2
)

for /r "%APPS_DIR%" %%F in (Start.bat) do if exist "%%F" call :stopOne "%%~dpF"
exit /b 0

:stopOne
set "DIR=%~1"
set "DIR=%DIR:~0,-1%"
for %%E in ("%DIR%\*.exe") do (
  taskkill /F /IM "%%~nxE" >nul 2>&1 && echo [stop-all] stopped: %%~nxE
)
exit /b 0
