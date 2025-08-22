#!/bin/bash

# === Konfigurasi Git global (edit sesuai akun GitHub kamu) ===
git config --global user.email "rudimdyp@gmail.com"
git config --global user.name "rudi maudya pratikno"

echo "======================================="
echo "🔄 Updating project from GitHub..."
echo "======================================="

# Pastikan di folder script
cd "$(dirname "$0")"

# Add & commit perubahan lokal
git add .
git commit -m "auto commit local changes before pull" || echo "⚠️ Tidak ada perubahan lokal untuk di-commit"

# Pull update terbaru
git pull origin main

# Install dependency baru
npm install

echo "======================================="
echo "✅ Update selesai!"
echo "👉 Jalankan bot dengan: npm start"
echo "======================================="
