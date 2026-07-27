@echo off
REM ============================================================
REM  InsecTra - Design Preview launcher (UI-only, no backend)
REM
REM  Just double-click this file. Nothing to install: it serves
REM  BOTH previews - the mobile app and the Expert Portal website
REM  - using the PowerShell that already ships with Windows, then
REM  opens your browser on a menu page.
REM
REM  To view it on a PHONE on the same Wi-Fi, right-click this
REM  file and choose "Run as administrator" instead.
REM
REM  (For Expo Go or live-reload editing, see
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
