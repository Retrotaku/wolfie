@echo off
cd /d "%~dp0"
py -m pip install -r requirements.txt
if errorlevel 1 (
  echo Impossible d'installer Flask. Verifie que Python et pip sont installes.
  pause
  exit /b 1
)
py app.py
pause
