@echo off
setlocal EnableDelayedExpansion
title TTS App - Install Dependencies

echo ============================================================
echo   TTS App - Install dependencies
echo ============================================================
echo.

:: -----------------------------------------------------------------
:: Find Python
:: -----------------------------------------------------------------

set "PYTHON="

python --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON=python"
    goto found_python
)

py --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON=py"
    goto found_python
)

if exist "C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python310\python.exe" (
    set "PYTHON=C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python310\python.exe"
    goto found_python
)

if exist "C:\Program Files\Python310\python.exe" (
    set "PYTHON=C:\Program Files\Python310\python.exe"
    goto found_python
)

echo.
echo [ERROR] Python 3.10+ not found.
echo Install Python from:
echo https://www.python.org/downloads/
echo.
pause
exit /b 1

:found_python

for /f "delims=" %%v in ('"%PYTHON%" --version 2^>^&1') do set "PY_VER=%%v"

echo [OK] !PY_VER!
echo.

:: -----------------------------------------------------------------
:: Check requirements.txt
:: -----------------------------------------------------------------

set "REQ_FILE=%~dp0requirements.txt"

if not exist "!REQ_FILE!" (
    echo [ERROR] requirements.txt not found:
    echo !REQ_FILE!
    echo.
    pause
    exit /b 1
)

:: -----------------------------------------------------------------
:: Install requirements
:: -----------------------------------------------------------------

echo ============================================================
echo [1/2] Installing requirements...
echo ============================================================
echo.

for /f "usebackq delims=" %%L in ("!REQ_FILE!") do (

    set "LINE=%%L"

    if not "!LINE!"=="" (

        if not "!LINE:~0,1!"=="#" (

            for /f "tokens=1 delims=><=~[ " %%P in ("!LINE!") do (
                set "PKG=%%P"
            )

            echo --------------------------------------------
            echo Package: !PKG!

            "%PYTHON%" -m pip show "!PKG!" >nul 2>&1

            if not errorlevel 1 (

                echo Already installed.

            ) else (

                echo Installing...

                "%PYTHON%" -m pip install !LINE!

                if errorlevel 1 (
                    echo FAILED
                ) else (
                    echo DONE
                )
            )

            echo.
        )
    )
)

:: -----------------------------------------------------------------
:: Install XTTS
:: -----------------------------------------------------------------

echo ============================================================
echo [2/2] Checking XTTS v2 (Coqui TTS)
echo ============================================================
echo.

"%PYTHON%" -c "import TTS" >nul 2>&1

if not errorlevel 1 (

    echo TTS already installed.

) else (

    echo Installing TTS...
    echo This may take several minutes.
    echo.

    "%PYTHON%" -m pip install TTS

    if errorlevel 1 (
        echo.
        echo FAILED to install TTS.
        echo Voice cloning will not be available.
    ) else (
        echo.
        echo TTS installed successfully.
    )
)

echo.
echo ============================================================
echo Installation finished.
echo ============================================================
echo.

pause
exit /b 0