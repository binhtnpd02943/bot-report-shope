#!/usr/bin/env bash

# ==============================================================================
# SCRIPT: rollback.sh
# MÔ TẢ: Khôi phục ứng dụng về phiên bản chạy ổn định trước đó
# ==============================================================================

set -Eeuo pipefail

APP_ROOT="/var/www/shopee-lark-bot"
RELEASES_DIR="${APP_ROOT}/releases"
CURRENT_LINK="${APP_ROOT}/current"
PM2_SERVICE_NAME="shopee-lark-bot"

# Hàm ghi log có timestamp
log() {
  echo -e "\033[1;31m[$(date '+%Y-%m-%d %H:%M:%S')] [ROLLBACK] $1\033[0m"
}

log_info() {
  echo -e "\033[1;32m[$(date '+%Y-%m-%d %H:%M:%S')] [ROLLBACK-INFO] $1\033[0m"
}

log "!!! PHAT HIEN SU CO - BAT DAU KICH HOAT QUY TRINH ROLLBACK !!!"

# 1. Tìm phiên bản release trước đó
cd "${RELEASES_DIR}"

# Liệt kê tất cả thư mục release sắp xếp theo thời gian mới nhất trước
# Bỏ qua dòng đầu tiên (chính là bản release vừa mới deploy bị lỗi)
# Bản dòng thứ 2 chính là bản release hoạt động ổn định trước đó
PREVIOUS_RELEASE=$(ls -1t | sed -n '2p' || true)

if [ -z "${PREVIOUS_RELEASE}" ]; then
  log "KHONG TIM THAY PHIEN BAN TRIEN KHAI CU NAO DE ROLLBACK!"
  exit 1
fi

PREVIOUS_RELEASE_PATH="${RELEASES_DIR}/${PREVIOUS_RELEASE}"
log "Xac dinh duoc phien ban cu la: ${PREVIOUS_RELEASE} (Duong dan: ${PREVIOUS_RELEASE_PATH})"

# 2. Kiểm tra tính hợp lệ của phiên bản cũ
if [ ! -d "${PREVIOUS_RELEASE_PATH}" ]; then
  log "Duong dan den phien ban cu khong phai la thu muc hop le!"
  exit 1
fi

# 3. Thực hiện chuyển đổi symlink 'current'
log "Dang cap nhat symlink atomically trỏ ve phien ban cu..."
ln -sfn "${PREVIOUS_RELEASE_PATH}" "${CURRENT_LINK}"
log_info "Cap nhat symlink current -> ${PREVIOUS_RELEASE} hoan tat."

# 4. Tải lại cấu hình ứng dụng trên PM2
log "Dang reload PM2 service '${PM2_SERVICE_NAME}' voi code phien ban cu..."
if pm2 describe "${PM2_SERVICE_NAME}" &>/dev/null; then
  pm2 reload "${PM2_SERVICE_NAME}"
  log_info "PM2 service '${PM2_SERVICE_NAME}' da duoc reload thanh cong."
else
  log "PM2 service '${PM2_SERVICE_NAME}' chua duoc khoi chay. Dang start lai..."
  pm2 start "${CURRENT_LINK}/src/index.js" --name "${PM2_SERVICE_NAME}"
fi

# 5. Chạy healthcheck lại để đảm bảo việc rollback thành công
log "Dang chay kiem tra suc khoe cho phien ban rollback..."
if "${CURRENT_LINK}/scripts/deploy/healthcheck.sh"; then
  log_info "ROLLBACK THANH CONG! Ung dung da quay ve phien ban cu va hoat dong on dinh."
  exit 0
else
  log "!!! CAP CUU !!! Kiem tra suc khoe ban rollback cung THAT BAI!"
  exit 1
fi
