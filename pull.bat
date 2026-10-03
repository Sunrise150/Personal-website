@echo off
chcp 65001 >nul
cd /d "%~dp0"

:loop
echo [%date% %time%] 正在拉取…
git pull origin main
echo [%date% %time%] 拉取完成，等待 1 小时…
timeout /t 3600 /nobreak >nul
goto loop