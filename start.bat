@echo off
chcp 65001 > nul
title Telegram Shop Bot

echo.
echo  ██████╗  ██████╗ ████████╗    ██████╗  ██████╗ ████████╗
echo  ██╔══██╗██╔═══██╗╚══██╔══╝    ██╔══██╗██╔═══██╗╚══██╔══╝
echo  ██████╔╝██║   ██║   ██║       ██████╔╝██║   ██║   ██║   
echo  ██╔══██╗██║   ██║   ██║       ██╔══██╗██║   ██║   ██║   
echo  ██████╔╝╚██████╔╝   ██║       ██████╔╝╚██████╔╝   ██║   
echo  ╚═════╝  ╚═════╝    ╚═╝       ╚═════╝  ╚═════╝    ╚═╝   
echo.
echo  Telegram Shop Bot — Реферальная система + Магазин
echo  ===================================================
echo.

REM Проверить наличие Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ОШИБКА] Node.js не найден! 
    echo Скачайте с: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [✓] Node.js найден: 
node --version

REM Проверить наличие npm
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ОШИБКА] npm не найден!
    pause
    exit /b 1
)

REM Проверить .env файл
if not exist .env (
    echo.
    echo [!] Файл .env не найден!
    echo     Копируем из .env.example...
    if exist .env.example (
        copy .env.example .env > nul
        echo [✓] Файл .env создан из .env.example
        echo.
        echo [ВАЖНО] Откройте .env и заполните все необходимые данные:
        echo   - TELEGRAM_BOT_TOKEN
        echo   - ADMIN_TELEGRAM_IDS
        echo   - DATABASE_URL
        echo.
        notepad .env
        echo.
        echo После заполнения .env нажмите любую клавишу для продолжения...
        pause > nul
    ) else (
        echo [ОШИБКА] Файл .env.example тоже не найден!
        pause
        exit /b 1
    )
)

echo.
echo [1/4] Установка зависимостей...
call npm install
if %errorlevel% neq 0 (
    echo [ОШИБКА] Ошибка установки зависимостей!
    pause
    exit /b 1
)
echo [✓] Зависимости установлены

echo.
echo [2/4] Применение схемы базы данных...
call npx drizzle-kit push --config=drizzle.config.json
if %errorlevel% neq 0 (
    echo [ПРЕДУПРЕЖДЕНИЕ] Не удалось применить схему БД (возможно, уже применена)
)
echo [✓] База данных готова

echo.
echo [3/4] Сборка проекта...
call npm run build
if %errorlevel% neq 0 (
    echo [ОШИБКА] Ошибка сборки!
    echo Запускаем в режиме разработки...
    goto :devmode
)
echo [✓] Сборка успешна

echo.
echo [4/4] Запуск бота...
echo.
echo  Бот запущен! Откройте в браузере:
echo  http://localhost:3000
echo.
echo  Для настройки webhook отправьте боту:
echo  POST http://localhost:3000/api/telegram/webhook-setup
echo.
echo  Нажмите Ctrl+C для остановки
echo.
call npm run start
goto :end

:devmode
echo.
echo [DEV] Запуск в режиме разработки...
echo.
echo  Бот запущен в dev-режиме!
echo  http://localhost:3000
echo.
echo  Нажмите Ctrl+C для остановки
echo.
call npm run dev

:end
pause
