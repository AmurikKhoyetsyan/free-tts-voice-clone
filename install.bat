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

set "TMPOUT=%TEMP%\tts_pip_out.txt"

for /f "usebackq delims=" %%L in ("!REQ_FILE!") do (

    set "LINE=%%L"

    if not "!LINE!"=="" (

        if not "!LINE:~0,1!"=="#" (

            for /f "tokens=1 delims=><=~[ " %%P in ("!LINE!") do (
                set "PKG=%%P"
            )

            echo --------------------------------------------
            echo Package: !PKG!

            "%PYTHON%" -m pip install !LINE! > "!TMPOUT!" 2>&1

            findstr /C:"Requirement already satisfied" "!TMPOUT!" >nul 2>&1
            if not errorlevel 1 (
                echo Already installed.
            ) else (
                findstr /C:"Successfully installed" "!TMPOUT!" >nul 2>&1
                if not errorlevel 1 (
                    echo Installed successfully.
                ) else (
                    type "!TMPOUT!"
                    echo FAILED
                )
            )

            echo.
        )
    )
)

:: -----------------------------------------------------------------
:: Verify whisper actually imports (pip can show "installed" but files broken)
:: -----------------------------------------------------------------

"%PYTHON%" -c "import whisper" >nul 2>&1
if errorlevel 1 (
    echo --------------------------------------------
    echo Package: openai-whisper ^(repair^)
    echo Import failed - force reinstalling...
    "%PYTHON%" -m pip install --force-reinstall openai-whisper
    echo.
)

:: -----------------------------------------------------------------
:: Pre-download Whisper base model
:: -----------------------------------------------------------------

echo ============================================================
echo [2/3] Downloading Whisper base model...
echo ============================================================
echo.

"%PYTHON%" -c "import whisper; print('Downloading...'); whisper.load_model('base'); print('Done.')" 2>&1
if errorlevel 1 (
    echo FAILED to download Whisper model.
) else (
    echo Whisper model ready.
)
echo.

:: -----------------------------------------------------------------
:: Install XTTS
:: -----------------------------------------------------------------

echo ============================================================
echo [3/3] Checking XTTS v2 (Coqui TTS)
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
