@echo off
REM ============================================================
REM  InsecTra - App Design Preview launcher (UI-only, no backend)
REM  Double-click this file to start the design preview.
REM  When Expo starts:  press  w  = open in web browser
REM                     or scan the QR code with the Expo Go app.
REM ============================================================
cd /d "%~dp0"

if not exist "node_modules" (
    echo First run - installing dependencies, please wait...
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed. Make sure Node.js is installed, then try again.
        pause
        exit /b 1
    )
)

echo Starting InsecTra design preview...
call npx expo start
pause
