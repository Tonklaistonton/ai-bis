@echo off
chcp 65001 > nul
title AIZEN Responder - LINE & Gmail Auto-Responder

echo ========================================================
echo   AIZEN Auto-Responder
echo ========================================================
echo.

:: ไปที่โฟลเดอร์ของโปรเจกต์
cd /d "%~dp0"

:: ตรวจสอบ node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] ไม่พบ Node.js ในเครื่อง กรุณาติดตั้ง Node.js รุ่น 22 ขึ้นไป
    echo         (ต้องใช้ Node 22+ เพราะระบบใช้ฐานข้อมูล SQLite ที่มากับ Node)
    pause
    exit /b
)

if not exist ".next\BUILD_ID" (
    echo [1/3] สร้าง Next.js production build...
    call npm run build
    if %errorlevel% neq 0 (
        echo [ERROR] build ไม่สำเร็จ
        pause
        exit /b
    )
) else (
    echo [1/3] ข้าม build (พบ .next/BUILD_ID แล้ว)
)

echo [2/3] เริ่ม Backend + UI Server (Port 3000)...
start "AIZEN Server" cmd /k "node server.js --prod"

:: รอ 2 วินาทีให้ Server บูตเสร็จ
timeout /t 2 /nobreak > nul

echo [3/3] เปิดหน้า Web Dashboard...
start http://localhost:3000

echo.
echo ========================================================
echo   ระบบเริ่มทำงานแล้ว
echo.
echo   ครั้งแรก: ระบบจะพาไปหน้า "ตั้งค่าครั้งแรก"
echo   เพื่อใส่ชื่อร้านและสร้างบัญชีผู้ดูแลระบบ
echo ========================================================
echo.
echo   ต้องการเปิดให้เข้าถึงจากอินเทอร์เน็ตหรือไม่?
echo   (ต้องตั้งค่าบัญชีผู้ใช้เรียบร้อยก่อน จึงจะเปิด tunnel ได้อย่างปลอดภัย)
echo.
set /p OPEN_TUNNEL=   เปิด Cloudflare Tunnel ไหม? (y/N):
if /i "%OPEN_TUNNEL%"=="y" (
    echo.
    echo   กำลังเปิด tunnel — URL ที่ได้จะเข้าถึงข้อมูลร้านและแชทได้จากภายนอก
    start "AIZEN Cloudflare Tunnel" cmd /k "cloudflared.exe tunnel --url http://localhost:3000"
) else (
    echo   เปิดเฉพาะในเครื่องนี้ (localhost) — ปลอดภัยที่สุด
)

echo.
pause