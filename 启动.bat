@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo 首次运行，正在安装依赖...
  call npm install
)
echo 正在启动 AURORA-7，浏览器会自动打开...
call npm run dev -- --open
