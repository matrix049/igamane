@echo off
cd /d "%~dp0"
echo Initializing git...
git init
echo.
echo Adding remote...
git remote add origin https://github.com/oussanhh/igamane.git 2>nul
echo.
echo Configuring user...
git config user.email "user@example.com"
git config user.name "oussanhh"
echo.
echo Staging files...
git add -A
echo.
echo Committing...
git commit -m "Initial commit"
echo.
echo Pushing to GitHub...
git branch -M main
git push -u origin main
echo.
echo Done!
pause
