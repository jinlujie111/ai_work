@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 (
  echo [Forest Survival] Node.js is required to run tests.
  exit /b 1
)
echo ===== 1/3 level logic simulation =====
node "%~dp0forest-sim.js"
if errorlevel 1 exit /b 1
echo.
echo ===== 2/3 H5 browser tests =====
node "%~dp0run-tests.js" soak.html 0
if errorlevel 1 exit /b 1
echo.
echo ===== 3/3 WeChat mini-game tests =====
node "%~dp0run-tests.js" minigame.html 1
exit /b %errorlevel%
