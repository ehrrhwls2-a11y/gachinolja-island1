@echo off
setlocal
node -e "require('node:sqlite')" >nul 2>nul
if not errorlevel 1 (
    node "%~dp0server.mjs"
    exit /b
)

set "ISLAND_CODE=%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe"
if not exist "%ISLAND_CODE%" (
    echo Node.js or Visual Studio Code is required to run the island server.
    exit /b 1
)

set "ELECTRON_RUN_AS_NODE=1"
"%ISLAND_CODE%" "%~dp0server.mjs"
