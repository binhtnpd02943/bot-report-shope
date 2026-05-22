/**
 * Utility script to manage Sapo / Sapo Go webhooks programmatically
 * Since Sapo Go does not have a webhook configuration UI, use this script to:
 * 1. List active webhooks
 * 2. Register new webhooks (e.g. orders/create, orders/updated)
 * 3. Delete a webhook by ID
 */
require('dotenv').config();
const axios = require('axios');
const logger = require('../utils/logger');

// Clean up alias & get technical domain suffix
const storeAliasInput = String(process.env.SAPO_STORE_ALIAS || '').trim();
let storeAlias = storeAliasInput;
let apiSuffix = 'mysapo.net';

if (storeAliasInput.includes('mysapogo.com')) {
  storeAlias = storeAliasInput.split('.mysapogo.com')[0];
  apiSuffix = 'mysapogo.com';
} else if (storeAliasInput.includes('mysapo.net')) {
  storeAlias = storeAliasInput.split('.mysapo.net')[0];
  apiSuffix = 'mysapo.net';
} else if (storeAliasInput.includes('sapo.vn')) {
  storeAlias = storeAliasInput.split('.sapo.vn')[0];
  apiSuffix = 'mysapo.net';
} else if (process.env.SAPO_STORE_SUFFIX === 'mysapogo.com') {
  apiSuffix = 'mysapogo.com';
}

const BASE_URL = `https://${storeAlias}.${apiSuffix}/admin`;

const apiKey = process.env.SAPO_API_KEY;
const apiSecret = process.env.SAPO_API_SECRET;
const accessToken = process.env.SAPO_ACCESS_TOKEN;

const headers = { 'Content-Type': 'application/json' };
let auth = null;

if (apiKey && apiSecret) {
  auth = { username: apiKey, password: apiSecret };
} else if (accessToken && accessToken !== 'sapopat_your_access_token_here') {
  headers['X-Sapo-Access-Token'] = accessToken;
} else {
  logger.error('❌ Thiếu thông tin xác thực Sapo trong .env.');
  process.exit(1);
}

// Function to print usage instructions
function printUsage() {
  console.log(`
ℹ️  CÁCH SỬ DỤNG SCRIPT QUẢN LÝ WEBHOOK SAPO:
--------------------------------------------
1. Xem danh sách webhook hiện tại:
   node src/scripts/register_sapo_webhooks.js list

2. Đăng ký webhook mới:
   node src/scripts/register_sapo_webhooks.js register <topic> <your_webhook_url>
   Ví dụ:
   node src/scripts/register_sapo_webhooks.js register orders/create https://domain-cua-ban.com/api/webhooks/sapo/order

3. Xóa webhook bằng ID:
   node src/scripts/register_sapo_webhooks.js delete <webhook_id>
  `);
}

async function listWebhooks() {
  try {
    logger.info(`🔍 Đang lấy danh sách Webhooks từ ${storeAlias}.${apiSuffix}...`);
    const response = await axios.get(`${BASE_URL}/webhooks.json`, { headers, auth });
    const webhooks = response.data?.webhooks || [];
    
    if (webhooks.length === 0) {
      logger.info('ℹ️  Chưa có webhook nào được đăng ký trên Sapo.');
      return;
    }
    
    logger.info(`✅ Tìm thấy ${webhooks.length} webhook(s):`);
    console.table(webhooks.map(w => ({
      ID: w.id,
      Topic: w.topic,
      Address: w.address,
      Format: w.format,
      'Created At': w.created_on || w.created_at
    })));
  } catch (err) {
    logger.error('❌ Không thể lấy danh sách Webhooks: ' + (err.response?.data ? JSON.stringify(err.response.data) : err.message));
  }
}

async function registerWebhook(topic, address) {
  if (!topic || !address) {
    logger.error('❌ Vui lòng cung cấp đầy đủ topic và webhook URL.');
    printUsage();
    return;
  }
  
  // Thêm token xác thực tự động nếu có
  const token = process.env.SAPO_WEBHOOK_VERIFY_TOKEN || 'maxu_sapo_webhook_2026';
  const separator = address.includes('?') ? '&' : '?';
  const urlWithToken = `${address}${separator}token=${token}`;
  
  try {
    logger.info(`➕ Đang đăng ký webhook mới...`);
    logger.info(`   - Topic: ${topic}`);
    logger.info(`   - Address: ${urlWithToken}`);
    
    const response = await axios.post(`${BASE_URL}/webhooks.json`, {
      webhook: {
        topic,
        address: urlWithToken,
        format: 'json'
      }
    }, { headers, auth });
    
    const w = response.data?.webhook;
    logger.info(`🎉 Đăng ký Webhook thành công!`);
    logger.info(`   ID: ${w.id} | Topic: ${w.topic} | Address: ${w.address}`);
  } catch (err) {
    logger.error('❌ Đăng ký Webhook thất bại: ' + (err.response?.data ? JSON.stringify(err.response.data) : err.message));
  }
}

async function deleteWebhook(id) {
  if (!id) {
    logger.error('❌ Vui lòng cung cấp ID webhook cần xóa.');
    printUsage();
    return;
  }
  
  try {
    logger.info(`🗑️  Đang xóa webhook ID: ${id}...`);
    await axios.delete(`${BASE_URL}/webhooks/${id}.json`, { headers, auth });
    logger.info(`✅ Đã xóa webhook thành công!`);
  } catch (err) {
    logger.error('❌ Xóa Webhook thất bại: ' + (err.response?.data ? JSON.stringify(err.response.data) : err.message));
  }
}

// CLI handler
const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  printUsage();
  process.exit(0);
}

switch (command.toLowerCase()) {
  case 'list':
    listWebhooks();
    break;
  case 'register':
    registerWebhook(args[1], args[2]);
    break;
  case 'delete':
    deleteWebhook(args[1]);
    break;
  default:
    logger.error(`❌ Lệnh không hợp lệ: "${command}"`);
    printUsage();
}
