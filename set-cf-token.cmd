@echo off
setlocal
set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=C:\Program Files (x86)\Git\bin\bash.exe"
if not exist "%BASH%" goto :nobash
"%BASH%" "%~dp0scripts\set-cf-token.sh" %*
exit /b %ERRORLEVEL%

:nobash
echo ERROR: Git Bash not found. Run this inside Git Bash instead:
echo   bash scripts/set-cf-token.sh
exit /b 1
