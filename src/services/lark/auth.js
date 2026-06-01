const axios = require('axios');
const logger = require('../../utils/logger');

const LARK_BASE_URL = 'https://open.larksuite.com/open-apis';

let _tenantToken = null;
let _tokenExpireAt = 0;

/**
 * Lấy tenant_access_token của Lark App
 * Token này sống 2 tiếng, cần lấy mới khi hết hạn
 */
async function getTenantAccessToken() {
  const now = Math.floor(Date.now() / 1000);

  // Dùng cache nếu còn hạn (buffer 5 phút)
  if (_tenantToken && _tokenExpireAt - now > 300) {
    return _tenantToken;
  }

  const response = await axios.post(
    `${LARK_BASE_URL}/auth/v3/tenant_access_token/internal`,
    {
      app_id: process.env.LARK_APP_ID,
      app_secret: process.env.LARK_APP_SECRET,
    },
    { timeout: 10000 },
  );

  const { tenant_access_token, expire, code, msg } = response.data;

  if (code !== 0) {
    throw new Error(`Lark auth lỗi: code=${code}, msg=${msg}`);
  }

  _tenantToken = tenant_access_token;
  _tokenExpireAt = now + (expire || 7200);

  logger.info('🦅 Lark tenant token đã được làm mới.');
  return _tenantToken;
}

module.exports = {
  getTenantAccessToken,
};
