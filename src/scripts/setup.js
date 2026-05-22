/**
 * Script Setup lần đầu
 * Hướng dẫn người dùng nhập token và lưu vào Database
 *
 * Chạy: node src/scripts/setup.js
 */
require('dotenv').config();

const readline = require('readline');
const db = require('../database/db');
const logger = require('../utils/logger');

const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   🛠️  SHOPEE-LARK MIDDLEWARE - SETUP LẦN ĐẦU    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nBạn cần điền các thông tin sau để hệ thống hoạt động.\n');

  db.initDatabase();

  const shopId      = await ask('📌 Shop ID (từ Shopee Partner Portal): ');
  const partnerId   = await ask('📌 Partner ID: ');
  const apiSecret   = await ask('📌 API Secret (nhấn Enter để ẩn nếu cần): ');
  const accessToken = await ask('🔑 Access Token (từ OAuth2 flow): ');
  const refreshToken= await ask('🔄 Refresh Token: ');

  console.log('\n⏳ Đang lưu thông tin vào Database...');

  db.upsertShop({
    shopId:       shopId.trim(),
    partnerId:    partnerId.trim(),
    apiSecret:    apiSecret.trim(),
    accessToken:  accessToken.trim(),
    refreshToken: refreshToken.trim(),
  });

  console.log('\n✅ Thông tin đã được lưu thành công!');
  console.log('\nBước tiếp theo:');
  console.log('  1. Điền LARK_APP_ID, LARK_APP_SECRET, LARK_CHAT_ID vào file .env');
  console.log('  2. Chạy server: npm start');
  console.log('  3. Test kết nối Lark: POST http://localhost:3000/api/lark/test');
  console.log('  4. Test báo cáo thủ công: POST http://localhost:3000/api/report/trigger\n');

  rl.close();
}

main().catch((err) => {
  console.error('Setup lỗi:', err.message);
  rl.close();
  process.exit(1);
});
