@echo off
chcp 65001 > nul
title AIZEN Responder - LINE & Gmail Auto-Pilot System

echo ========================================================
echo   🚀 กำลังเริ่มต้นระบบ AIZEN Auto-Responder...
echo ========================================================
echo.

:: ไปที่โฟลเดอร์ของโปรเจกต์
cd /d "%~dp0"

:: ตรวจสอบ node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] ไม่พบ Node.js ในเครื่อง กรุณาติดตั้ง Node.js ก่อนใช้งาน
    pause
    exit /b
)

echo [1/3] เริ่มการทำงาน Backend Server (Port 3000)...
start "AIZEN Server" cmd /k "node server.js"

:: รอ 2 วินาทีให้ Server บูตเสร็จ
timeout /t 2 /nobreak > nul

echo [2/3] เปิด Cloudflare HTTPS Tunnel ความเร็วสูงและเสถียร 100%...
echo.
start "AIZEN Cloudflare Tunnel" cmd /k "cloudflared.exe tunnel --url http://localhost:3000"

echo [3/3] เปิดหน้า Web Dashboard บนเบราว์เซอร์...
start http://localhost:3000

echo.
echo ✅ ระบบเริ่มทำงานเรียบร้อยแล้ว! (สามารถย่อหน้าต่างเหล่านี้ไว้ได้เลย)
echo.
pause
