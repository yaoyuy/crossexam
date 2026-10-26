@echo off
chcp 65001 >nul
title 在桌面放一个 CrossExam 快捷方式
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo   这台电脑还没装 Node.js，先装好再运行本文件。
  echo   https://nodejs.org/zh-cn/download
  pause
  exit /b 1
)
node "tools\launcher\launch.mjs" --shortcut-only
echo.
pause
