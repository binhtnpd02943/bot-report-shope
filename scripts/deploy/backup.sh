#!/usr/bin/env bash

# ==============================================================================
# SCRIPT: backup.sh
# MÔ TẢ: Tự động sao lưu cơ sở dữ liệu SQLite (store.db) trước khi deploy
# ==============================================================================

set -Eeuo pipefail

# Khai báo các đường dẫn thư mục cố định trên VPS
APP_ROOT="/var/www/shopee-lark-bot"
SHARED_DIR="${APP_ROOT}/shared"
BACKUPS_DIR="${APP_ROOT}/backups"
DB_FILE="${SHARED_DIR}/data/store.db"
MAX_BACKUPS=15

# Hàm ghi log có timestamp
log() {
  echo -e "\033[1;32m[$(date '+%Y-%m-%d %H:%M:%S')] [BACKUP] $1\033[0m"
}

log_warn() {
  echo -e "\033[1;33m[$(date '+%Y-%m-%d %H:%M:%S')] [BACKUP-WARN] $1\033[0m"
}

# 1. Kiểm tra môi trường
if [ ! -d "${APP_ROOT}" ]; then
  log_warn "Thu muc goc ${APP_ROOT} khong ton tai. Khong can backup (Trien khai lan dau)."
  exit 0
fi

# Tạo thư mục backups nếu chưa có
mkdir -p "${BACKUPS_DIR}"

# 2. Thực hiện sao lưu nếu database tồn tại
if [ -f "${DB_FILE}" ]; then
  TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
  BACKUP_PATH="${BACKUPS_DIR}/store.db_${TIMESTAMP}.bak"
  
  log "Dang sao luu database SQLite tu ${DB_FILE} sang ${BACKUP_PATH}..."
  cp "${DB_FILE}" "${BACKUP_PATH}"
  log "Sao luu thanh cong!"

  # 3. Dọn dẹp các bản backup cũ (chỉ giữ lại MAX_BACKUPS bản mới nhất)
  log "Dang kiem tra va don dep cac ban sao luu cu hon..."
  cd "${BACKUPS_DIR}"
  
  # Liệt kê các file backup theo thứ tự thời gian giảm dần, bỏ qua MAX_BACKUPS file đầu tiên
  # và xóa những file còn lại
  ls -tp | grep -v '/$' | tail -n +$((MAX_BACKUPS + 1)) | while read -r old_backup; do
    if [ -n "${old_backup}" ]; then
      log "Dang xoa ban sao luu cu: ${old_backup}"
      rm -f "${old_backup}"
    fi
  done
  log "Hoan tat don dep file backup cu."
else
  log "Khong tim thay database cu tai ${DB_FILE}. Bo qua buoc sao luu."
fi
