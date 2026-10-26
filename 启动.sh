#!/bin/sh
# macOS / Linux 的等价入口：第一次双击可能要先在「终端」里 chmod +x 启动.sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "这台电脑还没装 Node.js（需要 22.5 或更高）。"
  echo "装一个： https://nodejs.org/zh-cn/download"
  exit 1
fi
exec node tools/launcher/launch.mjs "$@"
