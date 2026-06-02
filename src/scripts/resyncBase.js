/**
 * Script thủ công: Đồng bộ lại dữ liệu Sapo → Lark Base cho 1 ngày cụ thể
 * Dùng khi Lark Base có record rỗng và cần xóa + ghi lại đúng.
 *
 * Cách dùng:
 *   node src/scripts/resyncBase.js 31/05/2026
 */

require('dotenv').config();
const lark = require('../services/lark');
const logger = require('../utils/logger');

async function main() {
  const targetDate = process.argv[2] || '31/05/2026';
  logger.info(`🔄 Bắt đầu re-sync Lark Base cho ngày: ${targetDate}`);

  try {
    await lark.syncFinancialReportToLarkBase({ reportDate: targetDate });
    logger.info(`✅ Re-sync hoàn tất cho ngày ${targetDate}!`);
  } catch (err) {
    logger.error(`❌ Re-sync thất bại: ${err.message}`);
    logger.error(err.stack);
    process.exit(1);
  }
}

main();
