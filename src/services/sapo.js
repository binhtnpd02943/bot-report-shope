const logger = require('../utils/logger');

function verifyWebhook(req) {
  const expected = process.env.SAPO_WEBHOOK_VERIFY_TOKEN;
  if (!expected) return true;

  const queryToken = req.query?.token;
  const headerToken = req.headers['x-sapo-webhook-token'] || req.headers.authorization;
  const bearerToken = String(headerToken || '').replace(/^Bearer\s+/i, '').trim();

  return queryToken === expected || headerToken === expected || bearerToken === expected;
}

function normalizeOrderWebhook(payload) {
  const order = payload?.order || payload || {};
  const externalOrderId = pickFirst([
    order.code,
    order.name,
    order.order_number,
    order.id,
    order.source_identifier,
    order.gateway_reference,
  ]);

  if (!externalOrderId) {
    throw new Error('Payload Sapo webhook khong co ma don hang.');
  }

  const items = normalizeItems(order.order_line_items || order.line_items || order.items || []);
  const imageUrls = extractImageUrls(order, items);

  return {
    source: 'sapo',
    platform: detectPlatform(order),
    shopeeShopName: detectShopeeShopName(order),
    externalOrderId: String(externalOrderId),
    internalOrderId: order.id ? String(order.id) : null,
    status: normalizeStatus(order),
    sapoStatus: order.status || null,
    financialStatus: order.financial_status || null,
    fulfillmentStatus: order.fulfillment_status || null,
    revenue: toNumber(pickFirst([order.total, order.total_price, order.current_total_price, order.subtotal_price])),
    discount: toNumber(pickFirst([order.total_discount, order.order_discount_amount, order.total_discounts, order.discount_amount])),
    shippingFee: toNumber(pickFirst([order.delivery_fee, order.total_shipping_price_set, order.shipping_fee])),
    customerName: pickFirst([
      order.shipping_address?.full_name,
      order.billing_address?.full_name,
      order.customer_data?.name,
      order.shipping_address?.name,
      order.billing_address?.name,
      joinName(order.customer?.first_name, order.customer?.last_name),
      order.customer?.name,
    ]),
    customerPhone: pickFirst([
      order.phone_number,
      order.shipping_address?.phone_number,
      order.billing_address?.phone_number,
      order.customer_data?.phone_number,
      order.shipping_address?.phone,
      order.billing_address?.phone,
      order.customer?.phone,
      order.phone,
    ]),
    createdAt: normalizeDate(pickFirst([order.created_on, order.created_at, order.processed_on])),
    updatedAt: normalizeDate(pickFirst([order.modified_on, order.updated_at])) || new Date().toISOString(),
    imageUrls,
    items,
    raw: payload,
  };
}

function normalizeItems(lineItems) {
  if (!Array.isArray(lineItems)) return [];

  return lineItems.map((item) => {
    const quantity = toNumber(item.quantity);
    const price = toNumber(item.price);
    const lineDiscount = toNumber(pickFirst([item.discount_amount, item.total_discount]));
    const amount = quantity * price - lineDiscount;

    return {
      sku: pickFirst([item.sku, item.variant_id, item.product_id, item.id]),
      name: pickFirst([item.product_name, item.variant_name, item.name, item.title, item.variant_title]) || 'San pham khong ten',
      quantity,
      price,
      amount,
      imageUrls: extractUrlsFromObject(item),
    };
  });
}

function extractImageUrls(order, items) {
  const urls = new Set();

  for (const url of extractUrlsFromObject(order)) urls.add(url);
  for (const attr of order.note_attributes || []) {
    const key = String(attr.name || '').toLowerCase();
    if (key.includes('image') || key.includes('anh') || key.includes('ảnh') || key.includes('design') || key.includes('file')) {
      for (const url of extractUrls(attr.value)) urls.add(url);
    }
  }
  for (const item of items) {
    for (const url of item.imageUrls || []) urls.add(url);
  }

  return Array.from(urls);
}

function extractUrlsFromObject(value) {
  const text = JSON.stringify(value || {});
  return extractUrls(text).filter((url) => isLikelyImageOrDesignUrl(url));
}

function extractUrls(text) {
  if (!text) return [];
  return String(text).match(/https?:\/\/[^\s"',)\\]+/g) || [];
}

function isLikelyImageOrDesignUrl(url) {
  const lower = url.toLowerCase();
  return /\.(png|jpe?g|webp|gif|pdf)(\?|$)/.test(lower)
    || lower.includes('drive.google.com')
    || lower.includes('canva.com')
    || lower.includes('sapo')
    || lower.includes('shopee');
}

function detectPlatform(order) {
  const text = [
    order.source_name,
    order.source,
    order.referring_site,
    order.landing_site,
    order.tags,
    order.note,
    order.channel,
  ].filter(Boolean).join(' ').toLowerCase();

  if (text.includes('shopee')) return 'shopee';
  if (text.includes('lazada')) return 'lazada';
  if (text.includes('tiktok')) return 'tiktok';
  return 'sapo';
}

function detectShopeeShopName(order) {
  const sourceName = order.source_name || '';
  if (sourceName.toLowerCase().startsWith('shopee')) {
    const parts = sourceName.split('-');
    if (parts.length > 1) {
      return parts.slice(1).join('-').trim();
    }
    return sourceName.trim();
  }
  return null;
}

function normalizeStatus(order) {
  return [
    order.status,
    order.financial_status,
    order.fulfillment_status,
  ].filter(Boolean).join(' / ') || 'unknown';
}

function normalizeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return String(value);
}

function joinName(firstName, lastName) {
  return [firstName, lastName].filter(Boolean).join(' ') || null;
}

function pickFirst(values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  const parsed = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Trích xuất store alias và domain suffix thích hợp
 * Hỗ trợ cả Sapo Web (.mysapo.net) và Sapo Go (.mysapogo.com)
 */
function getSapoConfig() {
  const storeAliasInput = String(process.env.SAPO_STORE_ALIAS || '').trim();
  let storeAlias = storeAliasInput;
  let apiSuffix = 'mysapo.net';
  let webSuffix = 'sapo.vn';

  if (storeAliasInput.includes('mysapogo.com')) {
    storeAlias = storeAliasInput.split('.mysapogo.com')[0];
    apiSuffix = 'mysapogo.com';
    webSuffix = 'mysapogo.com';
  } else if (storeAliasInput.includes('mysapo.net')) {
    storeAlias = storeAliasInput.split('.mysapo.net')[0];
    apiSuffix = 'mysapo.net';
    webSuffix = 'sapo.vn';
  } else if (storeAliasInput.includes('sapo.vn')) {
    storeAlias = storeAliasInput.split('.sapo.vn')[0];
    apiSuffix = 'mysapo.net';
    webSuffix = 'sapo.vn';
  } else if (process.env.SAPO_STORE_SUFFIX === 'mysapogo.com') {
    apiSuffix = 'mysapogo.com';
    webSuffix = 'mysapogo.com';
  }

  return { storeAlias, apiSuffix, webSuffix };
}

/**
 * Trả về domain quản trị Sapo/Sapo Go của khách hàng (dùng để chuyển hướng trên trình duyệt)
 */
function getStoreDomain() {
  const { storeAlias, webSuffix } = getSapoConfig();
  return `https://${storeAlias}.${webSuffix}`;
}

/**
 * Lấy danh sách đơn hàng trực tiếp từ Sapo API bằng Access Token hoặc Basic Auth
 */
async function getOrdersFromApi({ timeFrom, timeTo }) {
  const axios = require('axios');
  const accessToken = process.env.SAPO_ACCESS_TOKEN;
  const apiKey = process.env.SAPO_API_KEY;
  const apiSecret = process.env.SAPO_API_SECRET;

  const { storeAlias, apiSuffix } = getSapoConfig();

  if (!storeAlias) {
    throw new Error('Thiếu cấu hình SAPO_STORE_ALIAS trong file .env');
  }

  const url = `https://${storeAlias}.${apiSuffix}/admin/orders.json`;
  const headers = { 'Content-Type': 'application/json' };
  let auth = null;

  if (apiKey && apiSecret) {
    auth = {
      username: apiKey,
      password: apiSecret
    };
    logger.info(`🔑 Sử dụng phương thức xác thực Sapo API: Basic Authentication (API Key)`);
  } else if (accessToken && accessToken !== 'sapopat_your_access_token_here') {
    headers['X-Sapo-Access-Token'] = accessToken;
    logger.info(`🔑 Sử dụng phương thức xác thực Sapo API: X-Sapo-Access-Token Header`);
  } else {
    throw new Error('Thiếu thông tin xác thực Sapo. Vui lòng điền SAPO_API_KEY + SAPO_API_SECRET hoặc SAPO_ACCESS_TOKEN trong file .env');
  }

  // Sapo API nhận định dạng ngày ISO-8601 hoặc YYYY-MM-DD HH:mm:ss
  // Chuyển unix timestamp sang ISO string
  const fromIso = new Date(timeFrom * 1000).toISOString();
  const toIso = new Date(timeTo * 1000).toISOString();

  logger.info(`🔍 Đang kéo đơn từ Sapo API (https://${storeAlias}.${apiSuffix}): từ ${fromIso} đến ${toIso}...`);

  try {
    const response = await axios.get(url, {
      headers,
      auth,
      params: {
        created_on_min: fromIso,
        created_on_max: toIso,
        limit: 250,
      },
      timeout: 30000,
    });

    const rawOrders = response.data?.orders || [];
    logger.info(`✅ Đã nhận ${rawOrders.length} đơn từ Sapo API.`);

    // Chuẩn hóa danh sách đơn hàng
    const normalizedOrders = rawOrders.map((order) => {
      try {
        return normalizeOrderWebhook(order);
      } catch (err) {
        logger.error(`Lỗi chuẩn hóa đơn Sapo ID ${order.id}: ${err.message}`);
        return null;
      }
    }).filter(Boolean);

    return normalizedOrders;
  } catch (err) {
    logger.error('Lỗi khi gọi Sapo API: ' + (err.response?.data ? JSON.stringify(err.response.data) : err.message));
    throw new Error(`Sapo API request failed: ${err.message}`);
  }
}

module.exports = {
  verifyWebhook,
  normalizeOrderWebhook,
  getOrdersFromApi,
  getStoreDomain,
};
