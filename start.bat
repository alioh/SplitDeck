@echo off
cd /d "%~dp0"
if not exist "bin\yt-dlp.exe" (
  echo yt-dlp not found, downloading it first...
  node setup.js
)
start "" http://localhost:8787
node server.js
