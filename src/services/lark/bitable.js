const axios = require('axios');
const logger = require('../../utils/logger');
const auth = require('./auth');

const LARK_BASE_URL = 'https://open.larksuite.com/open-apis';

async function axiosWithRetry(config, retries = 3, delay = 1500) {
  try {
    return await axios(config);
  } catch (err) {
    const isTimeout =
      err.code === 'ECONNABORTED' ||
      err.message.includes('timeout') ||
      err.message.includes('exceeded');
    const isRateLimit =
      err.response &&
      (err.response.status === 429 || err.response.status === 500);

    if (retries > 0 && (isTimeout || isRateLimit)) {
      logger.warn(
        `⚠️ Axios request failed: ${err.message}. Retrying in ${delay}ms... (${retries} attempts left)`,
      );
      await new Promise((r) => setTimeout(r, delay));
      return await axiosWithRetry(config, retries - 1, delay * 2);
    }
    throw err;
  }
}

function isBaseEnabled() {
  return Boolean(
    process.env.LARK_BASE_APP_TOKEN && process.env.LARK_BASE_TABLE_ID,
  );
}

function getBaseConfig() {
  return {
    appToken: process.env.LARK_BASE_APP_TOKEN,
    tableId: process.env.LARK_BASE_TABLE_ID,
  };
}

function assertBaseConfigured() {
  if (!isBaseEnabled()) {
    throw new Error('Thieu LARK_BASE_APP_TOKEN hoac LARK_BASE_TABLE_ID.');
  }
}

function assertLarkOk(data, action) {
  if (data.code !== 0) {
    throw new Error(`${action} loi: code=${data.code}, msg=${data.msg}`);
  }
}

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function buildVndField(fieldName) {
  return {
    field_name: fieldName,
    type: 2,
    ui_type: 'Currency',
    property: {
      currency_code: 'VND',
      formatter: '0',
    },
  };
}

async function createBitableRecord(fields) {
  assertBaseConfigured();

  const token = await auth.getTenantAccessToken();
  const { appToken, tableId } = getBaseConfig();

  const response = await axios.post(
    `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    { fields },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    },
  );

  assertLarkOk(response.data, 'Lark Base create record');
  return response.data;
}

async function updateBitableRecord(recordId, fields) {
  assertBaseConfigured();

  const token = await auth.getTenantAccessToken();
  const { appToken, tableId } = getBaseConfig();

  const response = await axios.put(
    `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
    { fields },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    },
  );

  assertLarkOk(response.data, 'Lark Base update record');
  return response.data;
}

async function searchBitableRecordByField(fieldName, value) {
  assertBaseConfigured();

  const token = await auth.getTenantAccessToken();
  const { appToken, tableId } = getBaseConfig();

  const response = await axios.post(
    `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`,
    {
      page_size: 1,
      filter: {
        conjunction: 'and',
        conditions: [
          {
            field_name: fieldName,
            operator: 'is',
            value: [String(value)],
          },
        ],
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    },
  );

  assertLarkOk(response.data, 'Lark Base search record');
  return response.data.data?.items?.[0] || null;
}

function buildOrderBaseFields(order, uniqueField) {
  const productSummary = (order.items || [])
    .map((item) => `${item.name} x${item.quantity || 0}`)
    .join('\n');
  const imageUrls = order.imageUrls || safeJsonParse(order.image_urls, []);

  return {
    [uniqueField]: String(order.externalOrderId),
    [process.env.LARK_FIELD_SOURCE || 'Nguon']: order.source || 'nhanh',
    [process.env.LARK_FIELD_PLATFORM || 'San']: order.platform || 'shopee',
    [process.env.LARK_FIELD_STATUS || 'Trang thai']: order.status || '',
    [process.env.LARK_FIELD_REVENUE || 'Doanh thu']: Number(order.revenue || 0),
    [process.env.LARK_FIELD_DISCOUNT || 'Giam gia']: Number(
      order.discount || 0,
    ),
    [process.env.LARK_FIELD_SHIPPING || 'Phi van chuyen']: Number(
      order.shippingFee || 0,
    ),
    [process.env.LARK_FIELD_CUSTOMER || 'Khach hang']: order.customerName || '',
    [process.env.LARK_FIELD_PRODUCTS || 'San pham']: productSummary,
    [process.env.LARK_FIELD_IMAGES || 'Anh thiet ke']: imageUrls.join('\n'),
    [process.env.LARK_FIELD_CREATED_AT || 'Ngay tao']: order.createdAt || '',
    [process.env.LARK_FIELD_UPDATED_AT || 'Cap nhat luc']:
      order.updatedAt || new Date().toISOString(),
  };
}

async function upsertOrderToBase(order) {
  if (!isBaseEnabled()) {
    logger.info('Lark Base chua cau hinh. Chi luu don hang vao SQLite.');
    return null;
  }

  const uniqueField = process.env.LARK_ORDER_UNIQUE_FIELD || 'Ma don';
  const fields = buildOrderBaseFields(order, uniqueField);
  const existing = await searchBitableRecordByField(
    uniqueField,
    order.externalOrderId,
  );

  if (existing?.record_id) {
    logger.info(`Cap nhat don ${order.externalOrderId} tren Lark Base.`);
    return updateBitableRecord(existing.record_id, fields);
  }

  logger.info(`Tao moi don ${order.externalOrderId} tren Lark Base.`);
  return createBitableRecord(fields);
}

async function getOrCreateTable(appToken, tableName, token) {
  const listRes = await axios.get(
    `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (listRes.data.code !== 0) {
    throw new Error(`Loi lay danh sach table: ${listRes.data.msg}`);
  }

  const tables = listRes.data.data.items || [];
  const foundTable = tables.find((t) => t.name === tableName);
  if (foundTable) {
    return { tableId: foundTable.table_id, isNewTable: false };
  }

  logger.info(
    `🏗️  Đang tự động khởi tạo sheet/bảng: "${tableName}" trong Bitable...`,
  );
  const createRes = await axios.post(
    `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables`,
    {
      table: {
        name: tableName,
        default_generation: true,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
  );

  if (createRes.data.code !== 0) {
    throw new Error(`Loi tao table ${tableName}: ${createRes.data.msg}`);
  }

  return { tableId: createRes.data.data.table_id, isNewTable: true };
}

async function ensureTableFields(appToken, tableId, schemaFields, token) {
  const fieldsRes = await axiosWithRetry({
    method: 'get',
    url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
    headers: { Authorization: `Bearer ${token}` }
  });

  if (fieldsRes.data.code !== 0) {
    throw new Error(
      `Loi lay danh sach field cho table ${tableId}: ${fieldsRes.data.msg}`,
    );
  }

  const fields = fieldsRes.data.data.items || [];
  const existingFieldsByName = new Map(fields.map((f) => [f.field_name, f]));

  for (const field of schemaFields) {
    const existingField = existingFieldsByName.get(field.field_name);
    if (!existingField) {
      logger.info(
        `➕  Đang tạo trường "${field.field_name}" (type: ${field.type}) cho bảng ${tableId}...`,
      );
      const payload = {
        field_name: field.field_name,
        type: field.type,
      };
      if (field.ui_type) {
        payload.ui_type = field.ui_type;
      }
      if (field.property) {
        payload.property = field.property;
      }

      const createFieldRes = await axiosWithRetry({
        method: 'post',
        url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
        data: payload,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      });

      if (createFieldRes.data.code !== 0) {
        logger.error(
          `❌ Loi tao field ${field.field_name}: ${createFieldRes.data.msg}`,
        );
      }
    } else if (field.ui_type || field.property) {
      const payload = {
        field_name: field.field_name,
        type: field.type,
      };
      if (field.ui_type) {
        payload.ui_type = field.ui_type;
      }
      if (field.property) {
        payload.property = field.property;
      }

      const updateFieldRes = await axiosWithRetry({
        method: 'put',
        url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${existingField.field_id}`,
        data: payload,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      });

      if (
        updateFieldRes.data.code !== 0 &&
        updateFieldRes.data.msg !== 'DataNotChange'
      ) {
        logger.error(
          `❌ Loi cap nhat field ${field.field_name}: ${updateFieldRes.data.msg}`,
        );
      }
    }
  }
}

async function ensureTableViews(appToken, tableId, viewNames, token) {
  try {
    const listRes = await axiosWithRetry({
      method: 'get',
      url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/views`,
      headers: { Authorization: `Bearer ${token}` }
    });

    if (listRes.data.code !== 0) {
      throw new Error(`Loi lay danh sach view: ${listRes.data.msg}`);
    }

    const views = listRes.data.data.items || [];
    const existingViewNames = new Set(views.map((v) => v.view_name));

    for (const name of viewNames) {
      if (!existingViewNames.has(name)) {
        logger.info(`🏗️  Đang tạo view "${name}" cho bảng ${tableId}...`);
        await axiosWithRetry({
          method: 'post',
          url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/views`,
          data: {
            view_name: name,
            view_type: 'grid',
          },
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          }
        });
      }
    }

    const latestListRes = await axiosWithRetry({
      method: 'get',
      url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/views`,
      headers: { Authorization: `Bearer ${token}` }
    });
    const latestViews = latestListRes.data?.data?.items || [];

    const OBSOLETE_VIEWS = new Set(['Đơn hàng', 'Doanh thu', 'Chi phí', 'Sản phẩm']);
    for (const v of latestViews) {
      const isSystemDefault =
        v.view_name.includes('表格视图') ||
        v.view_name.includes('Grid View') ||
        v.view_name === '表格';
      const isObsolete = OBSOLETE_VIEWS.has(v.view_name);
      if ((isSystemDefault || isObsolete) && latestViews.length > 1) {
        logger.info(`🧹  Đang xóa tab cũ/mặc định "${v.view_name}"...`);
        try {
          await axiosWithRetry({
            method: 'delete',
            url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/views/${v.view_id}`,
            headers: { Authorization: `Bearer ${token}` }
          });
        } catch (delErr) {
          logger.warn(`⚠️ Không xóa được tab "${v.view_name}": ${delErr.message}`);
        }
      }
    }
  } catch (err) {
    logger.error(
      `⚠️ Lỗi dọn dẹp/tạo views cho bảng ${tableId}: ${err.message}`,
    );
  }
}

async function renamePrimaryField(appToken, tableId, newName, token) {
  try {
    const fieldsRes = await axiosWithRetry({
      method: 'get',
      url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      headers: { Authorization: `Bearer ${token}` }
    });
    const fields = fieldsRes.data?.data?.items || [];
    const primaryField = fields.find((f) => f.is_primary) || fields[0];

    if (primaryField) {
      if (primaryField.field_name !== newName) {
        logger.info(
          `✏️  Đang đổi tên trường khóa chính từ "${primaryField.field_name}" thành "${newName}"...`,
        );
        const updateUrl = `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${primaryField.field_id}`;
        await axiosWithRetry({
          method: 'put',
          url: updateUrl,
          data: {
            field_name: newName,
            type: 1, // Text
          },
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          }
        });
        logger.info(
          `✅ Đã đổi tên trường khóa chính thành "${newName}" thành công!`,
        );
      }
    }
  } catch (err) {
    logger.error(`⚠️ Lỗi khi đổi tên trường khóa chính: ${err.message}`);
  }
}

async function clearTableRecordsForDate(appToken, tableId, reportDate, token, primaryFieldName = 'Ngày') {
  try {
    logger.info(
      `🧹 Đang quét và xóa dữ liệu cũ của ngày ${reportDate} trong bảng ${tableId} để chuẩn bị ghi đè...`,
    );

    let totalDeleted = 0;
    while (true) {
      const searchUrl = `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records/search?page_size=500`;
      const searchPayload = {
        filter: {
          conjunction: 'and',
          conditions: [
            {
              field_name: primaryFieldName,
              operator: 'is',
              value: [String(reportDate)]
            }
          ]
        }
      };

      const searchRes = await axiosWithRetry({
        method: 'post',
        url: searchUrl,
        data: searchPayload,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      if (searchRes.data.code !== 0) {
        logger.error(`❌ Lỗi khi tìm bản ghi cũ để xóa: ${searchRes.data.msg}`);
        return;
      }

      const items = searchRes.data.data?.items || [];
      if (items.length === 0) {
        if (totalDeleted === 0) {
          logger.info(`ℹ️ Không tìm thấy bản ghi cũ nào của ngày ${reportDate}. Bảng đã sạch.`);
        } else {
          logger.info(`✅ Đã xóa sạch tổng cộng ${totalDeleted} bản ghi cũ của ngày ${reportDate}.`);
        }
        return;
      }

      const recordIds = items.map(r => r.record_id);
      logger.info(`🗑️ Đang xóa ${recordIds.length} bản ghi của ngày ${reportDate}...`);

      const deleteRes = await axiosWithRetry({
        method: 'post',
        url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_delete`,
        data: { records: recordIds },
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      if (deleteRes.data.code !== 0) {
        logger.error(`❌ Lỗi khi xóa hàng loạt bản ghi cũ của ngày ${reportDate}: ${deleteRes.data.msg}`);
        return;
      }

      totalDeleted += recordIds.length;
    }
  } catch (err) {
    logger.error(`⚠️ Lỗi dọn dẹp dữ liệu cũ theo ngày: ${err.message}`);
  }
}

module.exports = {
  axiosWithRetry,
  isBaseEnabled,
  createBitableRecord,
  updateBitableRecord,
  searchBitableRecordByField,
  upsertOrderToBase,
  renamePrimaryField,
  getOrCreateTable,
  ensureTableFields,
  ensureTableViews,
  clearTableRecordsForDate,
  buildVndField,
};
