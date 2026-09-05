@echo off
REM Comp Finder - start the live stream relay (Windows).
REM
REM Double-click this file. It starts the relay OBS talks to, opens the host's
REM desk in your browser, and stays running until you close the window. There
REM is nothing to type.
REM
REM It lives at the repo root rather than beside the relay because the point of
REM it is not having to go and find a folder.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed on this machine.
  echo   Get it from https://nodejs.org ^(the LTS build^), then run this again.
  echo.
  pause
  exit /b 1
)

REM First run after a fresh clone. An install that half-worked is otherwise a
REM relay that fails on an import three screens later.
if not exist node_modules (
  echo   First run - installing dependencies, about a minute...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   That install failed. The relay needs it before it can start.
    echo.
    pause
    exit /b 1
  )
)

REM STREAM_ALLOW_ORIGIN: the deployed app's address, so + Stream can reach the
REM relay from a page served over https. Edit this line if it ever changes;
REM the relay prints what it accepts when it starts.
if "%STREAM_ALLOW_ORIGIN%"=="" set STREAM_ALLOW_ORIGIN=https://comp-finder.vercel.app

node tools\stream-relay\server.mjs

REM Reached when the relay stops - usually a port already in use, which has a
REM message worth reading before the window disappears.
echo.
echo   The relay has stopped.
echo.
pause
