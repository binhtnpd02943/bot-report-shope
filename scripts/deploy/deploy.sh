#!/usr/bin/env bash

# ==============================================================================
# SCRIPT: deploy.sh
# MÔ TẢ: Kịch bản triển khai chính - Zero Downtime Deploy & SQLite Preservation
# ==============================================================================

set -Eeuo pipefail

APP_NAME="shopee-lark-bot"
APP_ROOT="/var/www/shopee-lark-bot"
RELEASES_DIR="${APP_ROOT}/releases"
SHARED_DIR="${APP_ROOT}/shared"
CURRENT_LINK="${APP_ROOT}/current"
PM2_SERVICE_NAME="shopee-lark-bot"
KEEP_RELEASES=5

# Hàm ghi log có timestamp
log() {
  echo -e "\033[1;32m[$(date '+%Y-%m-%d %H:%M:%S')] [DEPLOY] $1\033[0m"
}

log_error() {
  echo -e "\033[1;31m[$(date '+%Y-%m-%d %H:%M:%S')] [DEPLOY-ERR] $1\033[0m"
}

# ──────────────────────────────────────────────────────────────────────────────
# PHASE 1: Kiểm tra môi trường & công cụ bắt buộc
# ──────────────────────────────────────────────────────────────────────────────
log "=== PHONG TOA & KIEM TRA CO SỞ HA TANG ==="

# Đảm bảo các thư mục chính tồn tại
mkdir -p "${RELEASES_DIR}"
mkdir -p "${SHARED_DIR}/data"

# Kiểm tra các lệnh bắt buộc trên VPS
require_bin() {
  if ! command -v "$1" &>/dev/null; then
    log_error "Loi: Khong tim thay lenh '$1' tren VPS. Vui long cai dat truoc."
    exit 1
  fi
}

require_bin node
require_bin npm
require_bin pm2
require_bin curl
require_bin rsync

# ──────────────────────────────────────────────────────────────────────────────
# PHASE 2: Sao lưu database SQLite hiện tại
# ──────────────────────────────────────────────────────────────────────────────
log "=== TIEN HANH SAO LUU DU LIEU DATABSE ==="
# Nếu file backup.sh tồn tại trong code hiện tại, ta gọi nó chạy
CURRENT_BACKUP_SCRIPT="${CURRENT_LINK}/scripts/deploy/backup.sh"
if [ -f "${CURRENT_BACKUP_SCRIPT}" ]; then
  bash "${CURRENT_BACKUP_SCRIPT}"
elif [ -f "./scripts/deploy/backup.sh" ]; then
  bash "./scripts/deploy/backup.sh"
else
  log "Chua co script backup cu. Bo qua hoac su dung script backup co san."
fi

# ──────────────────────────────────────────────────────────────────────────────
# PHASE 3: Tạo thư mục release mới và sao chép mã nguồn
# ──────────────────────────────────────────────────────────────────────────────
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
NEW_RELEASE_PATH="${RELEASES_DIR}/${TIMESTAMP}"
log "=== TAO PHIEN BAN AN TOAN MOI: ${TIMESTAMP} ==="
mkdir -p "${NEW_RELEASE_PATH}"

# Sao chép code từ thư mục build tạm thời (nơi CI/CD đẩy lên, ví dụ thư mục hiện tại '.')
# sang thư mục release mới. Loại bỏ node_modules, database và file env bảo mật để build sạch.
log "Dang sao chep ma nguon sach sang: ${NEW_RELEASE_PATH}"
rsync -avz --exclude='node_modules' \
           --exclude='data' \
           --exclude='logs' \
           --exclude='backups' \
           --exclude='.env' \
           --exclude='.git' \
           --exclude='.github' \
           ./ "${NEW_RELEASE_PATH}/"

# ──────────────────────────────────────────────────────────────────────────────
# PHASE 4: Cài đặt dependencies và tạo symlink
# ──────────────────────────────────────────────────────────────────────────────
log "=== CAI DAT DEPENDENCIES & KET NOI DU LIEU MOI TRUONG ==="
cd "${NEW_RELEASE_PATH}"

log "Dang cai dat cac dependencies cho production..."
npm install --omit=dev --no-audit --no-fund

log "Xoa folder data (neu co) trong release de tranh ghi de du lieu cua he thong..."
rm -rf "${NEW_RELEASE_PATH}/data"

log "Tao cac lien ket symlink dong tu shared/ sang thu muc release moi..."
# Liên kết file cấu hình bảo mật .env
if [ ! -f "${SHARED_DIR}/.env" ]; then
  log_error "Khong tim thay file .env tai ${SHARED_DIR}/.env. Vui long tao file nay tren VPS truoc."
  exit 1
fi
ln -s "${SHARED_DIR}/.env" "${NEW_RELEASE_PATH}/.env"

# Liên kết thư mục data chứa SQLite
ln -s "${SHARED_DIR}/data" "${NEW_RELEASE_PATH}/data"

# Tạo thư mục logs và symlink cho pm2 log nếu cần
mkdir -p "${NEW_RELEASE_PATH}/logs"

# Phân quyền thực thi cho các script deploy trong release mới
chmod +x "${NEW_RELEASE_PATH}/scripts/deploy/"*.sh

# ──────────────────────────────────────────────────────────────────────────────
# PHASE 5: Cập nhật Symlink Current Atomically & Khởi động lại dịch vụ
# ──────────────────────────────────────────────────────────────────────────────
log "=== DONG BO HOA VA CAP NHAT LINK RUNTIME ==="
# Cập nhật symlink current atomically
ln -sfn "${NEW_RELEASE_PATH}" "${CURRENT_LINK}"

log "Dang reload ung dung tren PM2 de cap nhat code moi khong downtime..."
# Sử dụng cơ chế reload giúp không bị ngắt kết nối webhook
if pm2 describe "${PM2_SERVICE_NAME}" &>/dev/null; then
  # Nếu ứng dụng đã chạy, reload nó
  pm2 reload "${PM2_SERVICE_NAME}"
else
  # Nếu chạy lần đầu tiên, start với working directory là 'current'
  # Điều này cực kỳ quan trọng: PM2 sẽ luôn nhìn vào symlink /current để reload code mới
  pm2 start "${CURRENT_LINK}/src/index.js" \
            --name "${PM2_SERVICE_NAME}" \
            --cwd "${CURRENT_LINK}" \
            --update-env
fi

# Lưu trạng thái PM2 để tự khởi động lại khi reboot VPS
pm2 save

# ──────────────────────────────────────────────────────────────────────────────
# PHASE 6: Health Check (Kiểm tra sức khỏe dịch vụ)
# ──────────────────────────────────────────────────────────────────────────────
log "=== GIAI DOAN KIEM TRA SUC KHOE HE THONG ==="
# Thực thi script healthcheck trong release mới vừa deploy
if ! "${NEW_RELEASE_PATH}/scripts/deploy/healthcheck.sh"; then
  log_error "!!! CANH BAO !!! HEALTHCHECK THAT BAI. BAT DAU ROLLBACK TU DONG..."
  
  # Gọi rollback script
  if "${NEW_RELEASE_PATH}/scripts/deploy/rollback.sh"; then
    log "Da rollback ve phien ban truoc do on dinh. Deploy nay bi huy."
    exit 1
  else
    log_error "CAP CUU: ROLLBACK CUNG THAT BAI! HE THONG DANG TRONG TRANG THAI NGUY HIEM!"
    exit 1
  fi
fi

# ──────────────────────────────────────────────────────────────────────────────
# PHASE 7: Dọn dẹp các release cũ để tiết kiệm dung lượng ổ cứng
# ──────────────────────────────────────────────────────────────────────────────
log "=== DON DEP CAC PHIEN BAN CU HƠN ==="
cd "${RELEASES_DIR}"

# Liệt kê các release theo thứ tự thời gian giảm dần, giữ lại KEEP_RELEASES thư mục mới nhất,
# còn lại sẽ xóa bỏ để tránh làm đầy ổ cứng của VPS.
ls -1t | tail -n +$((KEEP_RELEASES + 1)) | while read -r old_release; do
  if [ -n "${old_release}" ]; then
    log "Dang xoa phien ban release rat cu: ${old_release}"
    rm -rf "${old_release}"
  fi
done

log "Trien khai phien ban moi thanh cong ruc ro!"
exit 0
