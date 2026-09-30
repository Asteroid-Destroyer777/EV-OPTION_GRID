@echo off
cd /d "%~dp0"
py serve.py 5173 --open || python serve.py 5173 --open
