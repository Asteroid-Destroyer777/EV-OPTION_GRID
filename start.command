#!/bin/bash
# Двойной клик в Finder: запускает локальный сервер и открывает прототип в браузере.
cd "$(dirname "$0")"
python3 serve.py 5173 --open
