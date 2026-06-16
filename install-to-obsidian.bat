@echo off
setlocal

set "PLUGIN_ID=tempolog"
set "DEFAULT_VAULT=C:\Notes\TheStorehouse"

if /I "%~1"=="--help" goto :help
if /I "%~1"=="/?" goto :help

set "VAULT_PATH=%~1"
if "%VAULT_PATH%"=="" set "VAULT_PATH=%DEFAULT_VAULT%"

set "PLUGIN_DIR=%VAULT_PATH%\.obsidian\plugins\%PLUGIN_ID%"

pushd "%~dp0" || (
	echo Failed to open script directory.
	exit /b 1
)

if not exist "%VAULT_PATH%\" (
	echo Vault path does not exist: %VAULT_PATH%
	popd
	exit /b 1
)

echo Building %PLUGIN_ID%...
call npm.cmd run build
if errorlevel 1 (
	echo Build failed. Plugin was not installed.
	popd
	exit /b 1
)

if not exist "main.js" (
	echo Build did not produce main.js.
	popd
	exit /b 1
)

if not exist "manifest.json" (
	echo manifest.json is missing.
	popd
	exit /b 1
)

if not exist "%PLUGIN_DIR%\" mkdir "%PLUGIN_DIR%"
if errorlevel 1 (
	echo Failed to create plugin directory: %PLUGIN_DIR%
	popd
	exit /b 1
)

copy /Y "main.js" "%PLUGIN_DIR%\" >nul
copy /Y "manifest.json" "%PLUGIN_DIR%\" >nul

if exist "styles.css" (
	copy /Y "styles.css" "%PLUGIN_DIR%\" >nul
)

echo Installed %PLUGIN_ID% to:
echo %PLUGIN_DIR%
echo.
echo In Obsidian, go to Settings ^> Community plugins, reload plugins, then enable TempoLog.

popd
exit /b 0

:help
echo Usage:
echo   install-to-obsidian.bat [vault-path]
echo.
echo If no vault path is provided, this script installs to:
echo   %DEFAULT_VAULT%
exit /b 0
