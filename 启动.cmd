@echo off
chcp 65001 >nul
title CrossExam 质询室
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   这台电脑还没装 Node.js，质询室需要它才能跑。
  echo   打开 https://nodejs.org/zh-cn/download 下载那个写着 LTS 的安装包，
  echo   一路点「下一步」装完，再双击一次本文件就行。
  echo.
  pause
  exit /b 1
)
node "tools\launcher\launch.mjs" %*
if errorlevel 1 (
  echo.
  echo   出了点问题，原因在上面的输出里。按任意键关闭窗口。
  pause >nul
)
