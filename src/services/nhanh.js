/**
 * Nhanh.vn Webhook Service
 * Chuan hoa payload don hang tu Nhanh.vn ve format noi bo.
 */

function verifyWebhook(req) {
  const expected = process.env.NHANH_WEBHOOK_VERIFY_TOKEN;
  if (!expected) return true;

  const bodyToken = req.body?.webhooksVerifyToken || req.body?.webhookVerifyToken;
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();

  return bodyToken === expected || bearerToken === expected || authHeader === expected;
}

function normalizeOrderWebhook(payload) {
  const data = payload?.data || payload || {};
  const externalOrderId = pickFirst([
    data.shopOrderId,
    data.ecomOrderId,
    data.orderCode,
    data.orderId,
    data.id,
  ]);

  if (!externalOrderId) {
    throw new Error('Payload webhook khong co ma don hang.');
  }

  const products = data.products || data.productList || data.items || data.orderDetails || [];
  const items = normalizeItems(products);

  return {
    source: 'nhanh',
    platform: detectPlatform(data),
    externalOrderId: String(externalOrderId),
    internalOrderId: data.orderId ? String(data.orderId) : null,
    status: normalizeStatus(data.statusName || data.status || data.statusCode || data.typeId),
    revenue: toNumber(pickFirst([
      data.moneyFinal,
      data.totalMoney,
      data.moneyTotal,
      data.customerMoney,
      data.calcTotalMoney,
      data.price,
    ])),
    discount: toNumber(pickFirst([data.discount, data.moneyDiscount, data.saleBonus])),
    shippingFee: toNumber(pickFirst([data.carrierFee, data.shipFee, data.shippingFee])),
    customerName: pickFirst([data.customerName, data.customer?.name, data.receiverName, data.shipName]),
    customerPhone: pickFirst([data.customerMobile, data.customer?.mobile, data.receiverMobile, data.shipMobile]),
    createdAt: normalizeDate(pickFirst([data.createdDateTime, data.createdAt, data.createdDate, data.created])),
    updatedAt: normalizeDate(pickFirst([data.updatedDateTime, data.updatedAt, data.modifiedDate])) || new Date().toISOString(),
    items,
    raw: payload,
  };
}

function normalizeItems(products) {
  if (!Array.isArray(products)) return [];

  return products.map((item) => {
    const quantity = toNumber(pickFirst([item.quantity, item.qty, item.productQuantity, item.model_quantity_purchased]));
    const price = toNumber(pickFirst([item.price, item.productPrice, item.priceOriginal, item.model_discounted_price]));
    const amount = toNumber(pickFirst([item.money, item.totalMoney, item.amount])) || quantity * price;

    return {
      sku: pickFirst([item.productCode, item.code, item.sku, item.model_sku, item.productId]),
      name: pickFirst([item.productName, item.name, item.item_name, item.model_name]) || 'San pham khong ten',
      quantity,
      price,
      amount,
    };
  });
}

function detectPlatform(data) {
  const source = String(pickFirst([data.trafficSourceName, data.sourceName, data.saleChannel, data.type]) || '').toLowerCase();
  if (source.includes('shopee') || data.shopOrderId) return 'shopee';
  if (source.includes('lazada')) return 'lazada';
  if (source.includes('tiktok')) return 'tiktok';
  return 'unknown';
}

function normalizeStatus(status) {
  if (status == null) return 'unknown';
  return String(status).trim();
}

function normalizeDate(value) {
  if (!value) return null;
  if (typeof value === 'number') {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return String(value);
}

function pickFirst(values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

module.exports = {
  verifyWebhook,
  normalizeOrderWebhook,
};
