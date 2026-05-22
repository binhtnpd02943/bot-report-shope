#!/usr/bin/env bash

# ==============================================================================
# SCRIPT: healthcheck.sh
# MÔ TẢ: Kiểm tra trạng thái server Express sau khi deploy
# ==============================================================================

set -Eeuo pipefail

APP_ROOT="/var/www/shopee-lark-bot"
SHARED_DIR="${APP_ROOT}/shared"
DEFAULT_PORT=3000
RETRIES=10
DELAY=3

# Hàm ghi log có timestamp
log() {
  echo -e "\033[1;36m[$(date '+%Y-%m-%d %H:%M:%S')] [HEALTHCHECK] $1\033[0m"
}

log_error() {
  echo -e "\033[1;31m[$(date '+%Y-%m-%d %H:%M:%S')] [HEALTHCHECK-ERR] $1\033[0m"
}

# 1. Xác định PORT chạy ứng dụng
PORT=${DEFAULT_PORT}
if [ -f "${SHARED_DIR}/.env" ]; then
  # Đọc PORT từ file .env shared (nếu có khai báo)
  ENV_PORT=$(grep -E "^PORT=" "${SHARED_DIR}/.env" | cut -d'=' -f2 || true)
  if [ -n "${ENV_PORT}" ]; then
    PORT=$(echo "${ENV_PORT}" | tr -d '\r' | tr -d ' ' | tr -d '"' | tr -d "'")
  fi
fi

HEALTH_URL="http://localhost:${PORT}/api/health"
log "Bat dau kiem tra suc khoe ung dung tai: ${HEALTH_URL}"

# 2. Vòng lặp gọi thử healthcheck với số lần retry giới hạn
for ((i=1; i<=RETRIES; i++)); do
  log "Thu lan $i/$RETRIES..."
  
  # Thực hiện curl lấy kết quả, tắt output lỗi của curl, đặt timeout 5s
  RESPONSE=$(curl -sS --max-time 5 "${HEALTH_URL}" || true)
  
  if [ -n "${RESPONSE}" ]; then
    # Kiểm tra xem status trong JSON trả về có bằng "ok" hay không
    # Dùng grep -q để kiểm tra nhanh chuỗi '"status":"ok"' hoặc '"status": "ok"'
    if echo "${RESPONSE}" | grep -qE '"status"\s*:\s*"ok"'; then
      log "Ung dung hoat dong HOAN HAO!"
      log "Response nhan duoc: ${RESPONSE}"
      exit 0
    else
      log_error "Nhan response tu server nhung status khong phai 'ok'."
      log_error "Chi tiet response: ${RESPONSE}"
    fi
  else
    log_error "Khong nhan duoc phan hoi tu server (co the server dang khoi dong)..."
  fi
  
  sleep ${DELAY}
done

log_error "KIEM TRA SUC KHOE THAT BAI sau ${RETRIES} lan thu!"
exit 1
