@echo off
REM ============================================================
REM  InsecTra - Design Preview, DEVELOPER mode (live reload)
REM
REM  Only needed if you are EDITING the code and want changes to
REM  appear instantly. This one requires Node.js.
REM
REM  If you only want to LOOK at the design, close this and use
REM  Start_Design_Preview.bat instead - that needs no install.
REM ============================================================
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto :nonode

if not exist "node_modules" (
    echo First run - installing dependencies, please wait...
    echo This can take several minutes.
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed. Check your internet connection and try again.
        pause
        exit /b 1
    )
)

echo Starting InsecTra design preview in developer mode...
echo   press  w  = open in web browser
echo   or scan the QR code with the Expo Go app.
call npx expo start
pause
goto :eof

:nonode
echo.
echo  ============================================================
echo   Node.js is not installed on this computer.
echo  ============================================================
echo.
echo   You do NOT need it just to view the design.
echo   Close this window and double-click:
echo.
echo       Start_Design_Preview.bat
echo.
echo   That version needs no installation at all.
echo.
echo   (Only if you really want live-reload editing, install
echo    Node.js LTS from https://nodejs.org  then re-run this.)
echo.
pause
