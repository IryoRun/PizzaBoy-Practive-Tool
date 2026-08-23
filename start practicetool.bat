@echo off
setlocal
title PizzaBoy Practice Tool

rem Run from this file's own folder, so double-clicking works no matter where
rem the folder was unzipped to.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :nonode

if "%~1"=="" (
    node "src\cli.js" run
) else (
    node "src\cli.js" %*
)

if errorlevel 1 (
    echo.
    echo The tool stopped with an error - the message above says why.
    echo If you are stuck, double-click this file after typing:  doctor
    echo or run:  "start practicetool.bat" doctor
    echo.
    pause
)
exit /b %errorlevel%

:nonode
echo.
echo   Node.js was not found on this computer.
echo.
echo   The practice tool needs Node.js version 22 or newer.
echo   Get it here:  https://nodejs.org      (the "LTS" download is fine)
echo.
echo   Install it, then start this file again.
echo.
pause
exit /b 1
