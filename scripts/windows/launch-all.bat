@echo off
setlocal
rem Starts every Unity app under APPS_DIR (arg 1) that isn't already running.
rem Each app folder keeps its own Start.bat (as shipped with the Unity build)
rem next to the app's .exe. Searched recursively, so nesting like
rem   OutsideViewDisplay_v0.1_2\OutsideViewDisplay\Start.bat
rem works. Apps already running are skipped, so running this twice (or after
rem one app crashed) only starts what's missing - never duplicates.

set "APPS_DIR=%~1"
if "%APPS_DIR%"=="" (
  echo [launch-all] usage: launch-all.bat "C:\path\to\apps"
  exit /b 2
)
if not exist "%APPS_DIR%\" (
  echo [launch-all] APPS_DIR not found: %APPS_DIR%
  exit /b 2
)

set /a FOUND=0
for /r "%APPS_DIR%" %%F in (Start.bat) do if exist "%%F" call :launchOne "%%~dpF"
if %FOUND%==0 (
  echo [launch-all] no Start.bat found under %APPS_DIR%
  exit /b 1
)
exit /b 0

:launchOne
set /a FOUND+=1
set "DIR=%~1"
set "DIR=%DIR:~0,-1%"
for %%E in ("%DIR%\*.exe") do (
  if /I not "%%~nxE"=="UnityCrashHandler64.exe" (
    tasklist /FI "IMAGENAME eq %%~nxE" /FO CSV /NH 2>nul | find /I "%%~nxE" >nul && (
      echo [launch-all] already running, skipped: %%~nxE
      exit /b 0
    )
  )
)
echo [launch-all] starting: %DIR%\Start.bat
start "" /D "%DIR%" /MIN cmd /c "Start.bat"
exit /b 0
