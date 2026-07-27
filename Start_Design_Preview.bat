@echo off
REM ============================================================
REM  InsecTra - App Design Preview launcher (UI-only, no backend)
REM
REM  Just double-click this file. Nothing to install:
REM  it serves the prebuilt "dist" folder using the PowerShell
REM  that already ships with Windows, then opens your browser.
REM
REM  (For live-reload development instead, see
REM   Start_Dev_Mode_Advanced.bat - that one needs Node.js.)
REM ============================================================
cd /d "%~dp0"

if not exist "dist\index.html" goto :nodist

echo.
echo  Starting the InsecTra design preview...
echo  Your browser will open in a moment.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preview_server.ps1"
goto :eof

:nodist
echo.
echo  ============================================================
echo   Could not find the "dist" folder.
echo  ============================================================
echo.
echo   This launcher needs the prebuilt "dist" folder that sits
echo   next to this file.
echo.
echo   Fix: download the project again from GitHub using the
echo        green "Code" button ^> "Download ZIP", then unzip it
echo        and double-click this file again.
echo.
pause
