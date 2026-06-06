@echo off
:: Запрашиваем права администратора автоматически
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    powershell -Command "Start-Process cmd -ArgumentList '/c cd /d \"%~dp0\" && \"%~dp0add_voices_admin.bat\"' -Verb RunAs"
    exit /b
)

echo Регистрация голосов Windows OneCore в SAPI...
echo.
"C:\Users\javan\AppData\Local\Programs\Python\Python310\python.exe" "%~dp0add_voices.py"
echo.
pause
