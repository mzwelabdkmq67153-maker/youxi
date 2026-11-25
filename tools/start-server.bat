@echo off
rem ---------------------------------------------------------------
rem  Seventh World - local game server (port 8123), auto-restart
rem  Kept ASCII-only so cmd never chokes on the Chinese folder path.
rem  Node lookup order: system install -> WorkBuddy bundle -> Doubao runtime
rem ---------------------------------------------------------------
setlocal enabledelayedexpansion
cd /d "%~dp0.."

set "NODE="
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"

if not defined NODE for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
  if exist "%%~d\node.exe" set "NODE=%%~d\node.exe"
)

if not defined NODE for /d %%d in ("%LOCALAPPDATA%\Doubao\User Data\sandbox_runtime\bases\*\node") do (
  if exist "%%~d\node.exe" set "NODE=%%~d\node.exe"
)

if not defined NODE (
  echo [server] node.exe not found, abort.
  exit /b 1
)

rem Already listening? Do nothing (one instance only).
netstat -ano | findstr /R /C:":8123 .*LISTENING" >nul
if not errorlevel 1 (
  echo [server] port 8123 already listening, skip.
  exit /b 0
)

set /a FAILS=0
:loop
"%NODE%" server.js 8123
set /a FAILS+=1
if %FAILS% GEQ 20 (
  echo [server] too many failures, giving up.
  exit /b 1
)
timeout /t 3 /nobreak >nul
goto loop
