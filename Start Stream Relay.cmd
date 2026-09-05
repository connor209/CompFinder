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

REM Pick up the latest code, so this file is the only thing anybody has to
REM touch. Three rules, and the last is the one that matters at a venue:
REM   - --ff-only, so it can never stop on a merge or a conflict;
REM   - skipped when the working tree is dirty, because a stream night is not
REM     when to discover somebody was mid-edit;
REM   - a failure is a shrug, not a stop. No network, GitHub down, a checkout
REM     with no remote - carry on with the code already here. The one evening
REM     this has to work is the evening the wifi is worst.
REM
REM "if defined" rather than "%CF_DIRTY%"=="1" throughout: a parenthesised
REM block has its %VARS% substituted when the block is PARSED, so a variable
REM set inside one reads as its old value everywhere else in it.
set "CF_BEFORE="
set "CF_DIRTY="
set "CF_GIT="
if exist .git (
  where git >nul 2>nul
  if not errorlevel 1 set CF_GIT=1
)
REM Cloned with GitHub Desktop, which bundles its own git and does not put it
REM on the PATH. Say so: a skip nobody can see is indistinguishable from an
REM update that ran and found nothing, and the remedy is a different button.
if not defined CF_GIT (
  echo   No git on this machine, so no update check.
  echo   Use Pull origin in GitHub Desktop if you need the latest code.
  echo.
)
if exist .git (
  where git >nul 2>nul
  if not errorlevel 1 (
    git status --porcelain > "%TEMP%\cf_status.txt" 2>nul
    for %%A in ("%TEMP%\cf_status.txt") do if %%~zA GTR 0 set CF_DIRTY=1
    del "%TEMP%\cf_status.txt" >nul 2>nul
    if defined CF_DIRTY (
      echo   Local changes here, so leaving the code alone.
      echo.
    ) else (
      echo   Checking for updates...
      for /f "delims=" %%i in ('git rev-parse HEAD 2^>nul') do set "CF_BEFORE=%%i"
      git pull --ff-only
      REM No network, GitHub down, no remote - say so and carry on with the
      REM code that is already here. No brackets in that line: cmd needs them
      REM escaped inside a block, and an unescaped one ends the block early.
      if errorlevel 1 echo   Could not reach GitHub - carrying on with the code that is here.
      echo.
    )
  )
)

REM A pull that changed the dependencies needs an install, or the relay fails
REM on an import and it looks like the update broke it.
if defined CF_BEFORE (
  for /f "delims=" %%i in ('git rev-parse HEAD 2^>nul') do set "CF_AFTER=%%i"
  call :maybe_install
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

REM STREAM_ALLOW_ORIGIN: the addresses + Stream may reach the relay FROM. It is
REM the browser's origin that counts, not where you think the app lives - and
REM comp-finder.vercel.app 307s to the custom domain, so a page opened at
REM either reports the one it ended up on. Both are listed for that reason.
REM The relay prints what it accepts on startup, and names the missing one in
REM the 403.
REM All three hostnames the app answers on. Add another by putting it on the
REM end of this line, comma-separated - when + Stream says the relay is not
REM reachable, the address it prints is the one to paste in.
if "%STREAM_ALLOW_ORIGIN%"=="" set STREAM_ALLOW_ORIGIN=https://comp-finder-alpha.vercel.app,https://compfinder.gopainting.com,https://comp-finder.vercel.app

node tools\stream-relay\server.mjs

REM Reached when the relay stops - usually a port already in use, which has a
REM message worth reading before the window disappears.
echo.
echo   The relay has stopped.
echo.
pause
exit /b 0

:maybe_install
if "%CF_BEFORE%"=="%CF_AFTER%" exit /b 0
git diff --name-only %CF_BEFORE% %CF_AFTER% | findstr /c:"package-lock.json" >nul 2>nul
if errorlevel 1 exit /b 0
echo   Dependencies changed - updating them...
echo.
call npm install --no-audit --no-fund
exit /b 0
