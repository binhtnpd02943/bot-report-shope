/**
 * Shopee API Service
 * Xử lý tất cả giao tiếp với Shopee Open API v2
 * Bao gồm: ký HMAC-SHA256, refresh token, lấy đơn hàng
 */
const crypto = require('crypto');
const axios = require('axios');
const logger = require('../utils/logger');
const db = require('../database/db');

const BASE_URL = process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com';

// ─────────────────────────────────────────────
// UTILITY: TẠO CHỮ KÝ HMAC-SHA256
// ─────────────────────────────────────────────

/**
 * Tạo chữ ký cho API Shopee (bắt buộc cho mọi request)
 * Format: partnerId + apiPath + timestamp + accessToken + shopId
 */
function generateSignature({ partnerId, apiSecret, apiPath, timestamp, accessToken = '', shopId = '' }) {
  const baseString = `${partnerId}${apiPath}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac('sha256', apiSecret).update(baseString).digest('hex');
}

/**
 * Tạo params chung cho mọi request Shopee (có shop token)
 */
function buildCommonParams({ partnerId, shopId, accessToken, apiSecret, apiPath }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = generateSignature({ partnerId, apiSecret, apiPath, timestamp, accessToken, shopId });

  return {
    partner_id:   parseInt(partnerId),
    shop_id:      parseInt(shopId),
    access_token: accessToken,
    timestamp,
    sign,
  };
}

function getEnvCredentials() {
  return {
    partnerId: process.env.SHOPEE_PARTNER_ID,
    apiSecret: process.env.SHOPEE_API_SECRET,
    shopId: process.env.SHOPEE_SHOP_ID,
  };
}

/**
 * Tao URL de chu shop bam uy quyen app tren Shopee.
 * Sau khi approve, Shopee redirect ve redirectUrl kem code + shop_id.
 */
function buildAuthorizationUrl({ redirectUrl } = {}) {
  const { partnerId, apiSecret } = getEnvCredentials();
  const apiPath = '/api/v2/shop/auth_partner';
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = generateSignature({ partnerId, apiSecret, apiPath, timestamp });
  const callbackUrl = redirectUrl || process.env.SHOPEE_REDIRECT_URL;

  if (!partnerId || !apiSecret) {
    throw new Error('Thieu SHOPEE_PARTNER_ID hoac SHOPEE_API_SECRET.');
  }
  if (!callbackUrl) {
    throw new Error('Thieu redirectUrl hoac SHOPEE_REDIRECT_URL.');
  }

  const url = new URL(`${BASE_URL}${apiPath}`);
  url.searchParams.set('partner_id', parseInt(partnerId));
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('sign', sign);
  url.searchParams.set('redirect', callbackUrl);

  return url.toString();
}

/**
 * Doi authorization code lay access_token + refresh_token va luu vao DB.
 */
async function exchangeCodeForTokens({ code, shopId }) {
  const { partnerId, apiSecret } = getEnvCredentials();
  const targetShopId = shopId || process.env.SHOPEE_SHOP_ID;

  if (!code) throw new Error('Thieu authorization code tu Shopee.');
  if (!targetShopId) throw new Error('Thieu shopId.');
  if (!partnerId || !apiSecret) {
    throw new Error('Thieu SHOPEE_PARTNER_ID hoac SHOPEE_API_SECRET.');
  }

  const apiPath = '/api/v2/auth/token/get';
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = generateSignature({ partnerId, apiSecret, apiPath, timestamp });

  logger.info(`Dang doi Shopee authorization code lay token cho shop ${targetShopId}...`);

  const response = await axios.post(
    `${BASE_URL}${apiPath}`,
    {
      code,
      shop_id: parseInt(targetShopId),
      partner_id: parseInt(partnerId),
    },
    {
      params: {
        partner_id: parseInt(partnerId),
        timestamp,
        sign,
      },
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    }
  );

  const payload = response.data.response || response.data;
  const { access_token, refresh_token, expire_in, error, message } = payload;

  if (error && error !== '') {
    throw new Error(`Shopee token/get loi: ${error} - ${message}`);
  }
  if (!access_token || !refresh_token) {
    throw new Error(`Shopee khong tra ve access_token/refresh_token: ${JSON.stringify(response.data)}`);
  }

  const expireAt = Math.floor(Date.now() / 1000) + (expire_in || 14400);
  db.upsertShop({
    shopId: String(targetShopId),
    partnerId: String(partnerId),
    apiSecret,
    accessToken: access_token,
    refreshToken: refresh_token,
  });
  db.updateTokens(String(targetShopId), access_token, refresh_token, expireAt);

  logger.info(`Da lay token Shopee thanh cong cho shop ${targetShopId}.`);
  return {
    shopId: String(targetShopId),
    expireAt,
  };
}

// ─────────────────────────────────────────────
// TOKEN MANAGEMENT
// ─────────────────────────────────────────────

/**
 * Refresh access token Shopee
 * Shopee access token chỉ sống 4 tiếng, cần refresh liên tục
 */
async function refreshAccessToken(shopId) {
  const creds = db.getShopCredentials(shopId);
  if (!creds.refresh_token) {
    throw new Error(`Không có refresh_token cho shop ${shopId}`);
  }

  const apiPath = '/api/v2/auth/access_token/get';
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = generateSignature({
    partnerId:   creds.partner_id,
    apiSecret:   creds.api_secret,
    apiPath,
    timestamp,
  });

  const url = `${BASE_URL}${apiPath}`;
  const payload = {
    refresh_token: creds.refresh_token,
    shop_id:       parseInt(creds.shop_id),
    partner_id:    parseInt(creds.partner_id),
    timestamp,
    sign,
  };

  logger.info(`🔄 Đang refresh token cho shop ${shopId}...`);

  const response = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  const { access_token, refresh_token, expire_in, error, message } = response.data;

  if (error && error !== '') {
    throw new Error(`Shopee refresh token lỗi: ${error} - ${message}`);
  }

  const expireAt = Math.floor(Date.now() / 1000) + (expire_in || 14400);
  db.updateTokens(shopId, access_token, refresh_token, expireAt);

  logger.info(`✅ Refresh token thành công. Hết hạn lúc: ${new Date(expireAt * 1000).toLocaleString('vi-VN')}`);
  return access_token;
}

/**
 * Lấy access token hợp lệ (tự refresh nếu sắp hết hạn)
 */
async function getValidAccessToken(shopId) {
  const creds = db.getShopCredentials(shopId);
  const now = Math.floor(Date.now() / 1000);
  const bufferTime = 30 * 60; // refresh trước 30 phút khi hết hạn

  if (!creds.access_token || (creds.token_expire_at && creds.token_expire_at - now < bufferTime)) {
    logger.warn(`⚠️  Token sắp hết hạn hoặc chưa có. Đang refresh...`);
    return await refreshAccessToken(shopId);
  }

  return creds.access_token;
}

// ─────────────────────────────────────────────
// ORDER APIs
// ─────────────────────────────────────────────

/**
 * Lấy danh sách đơn hàng theo khoảng thời gian
 * API: v2.order.get_order_list
 */
async function getOrderList({ shopId, timeFrom, timeTo }) {
  const creds = db.getShopCredentials(shopId);
  const accessToken = await getValidAccessToken(shopId);
  const apiPath = '/api/v2/order/get_order_list';

  let allOrders = [];
  let cursor = '';
  let hasMore = true;
  let page = 1;

  while (hasMore) {
    const params = buildCommonParams({
      partnerId:   creds.partner_id,
      shopId:      creds.shop_id,
      accessToken,
      apiSecret:   creds.api_secret,
      apiPath,
    });

    const queryParams = {
      ...params,
      time_range_field: 'create_time',
      time_from: timeFrom,
      time_to:   timeTo,
      page_size: 100, // max 100
      cursor,
      order_status: 'ALL',
      response_optional_fields: 'order_status',
    };

    logger.info(`📋 Lấy danh sách đơn hàng - Trang ${page}...`);

    const response = await axios.get(`${BASE_URL}${apiPath}`, {
      params: queryParams,
      timeout: 30000,
    });

    const { order_list, more, next_cursor, error, message } = response.data.response || response.data;

    if (error && error !== '') {
      throw new Error(`getOrderList lỗi: ${error} - ${message}`);
    }

    if (order_list && order_list.length > 0) {
      allOrders = allOrders.concat(order_list);
    }

    hasMore = more || false;
    cursor  = next_cursor || '';
    page++;

    // Tránh bị rate limit
    if (hasMore) await sleep(500);
  }

  logger.info(`📦 Tổng số đơn tìm được: ${allOrders.length}`);
  return allOrders;
}

/**
 * Lấy chi tiết nhiều đơn hàng (tối đa 50/lần)
 * API: v2.order.get_order_detail
 */
async function getOrderDetails({ shopId, orderSnList }) {
  const creds = db.getShopCredentials(shopId);
  const accessToken = await getValidAccessToken(shopId);
  const apiPath = '/api/v2/order/get_order_detail';

  // Chia thành batch 50 đơn/lần (giới hạn API)
  const batches = chunkArray(orderSnList, 50);
  let allDetails = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    logger.info(`🔍 Lấy chi tiết đơn hàng - Batch ${i + 1}/${batches.length} (${batch.length} đơn)...`);

    const params = buildCommonParams({
      partnerId:   creds.partner_id,
      shopId:      creds.shop_id,
      accessToken,
      apiSecret:   creds.api_secret,
      apiPath,
    });

    const queryParams = {
      ...params,
      order_sn_list: batch.join(','),
      response_optional_fields: [
        'buyer_user_id',
        'buyer_username',
        'estimated_shipping_fee',
        'recipient_address',
        'actual_shipping_fee',
        'goods_to_declare',
        'note',
        'note_update_time',
        'pay_time',
        'dropshipper',
        'credit_card_number',
        'dropshipper_phone',
        'split_up',
        'buyer_cancel_reason',
        'cancel_by',
        'cancel_reason',
        'actual_shipping_fee_confirmed',
        'buyer_cpf_id',
        'fulfillment_flag',
        'pickup_done_time',
        'package_list',
        'shipping_carrier',
        'payment_method',
        'total_amount',
        'buyer_username',
        'invoice_data',
        'no_plastic_packing',
        'order_chargeable_weight_gram',
        'edt',
      ].join(','),
    };

    const response = await axios.get(`${BASE_URL}${apiPath}`, {
      params: queryParams,
      timeout: 30000,
    });

    const { order_list, error, message } = response.data.response || response.data;

    if (error && error !== '') {
      throw new Error(`getOrderDetails lỗi: ${error} - ${message}`);
    }

    if (order_list) {
      allDetails = allDetails.concat(order_list);
    }

    // Tránh rate limit
    if (i < batches.length - 1) await sleep(500);
  }

  return allDetails;
}

// ─────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

module.exports = {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getValidAccessToken,
  getOrderList,
  getOrderDetails,
};
