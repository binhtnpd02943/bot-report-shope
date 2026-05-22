/**
 * Script to test the entire Shopee Marketplace scraper workflow and send the report to Lark.
 */
require('dotenv').config();

// Override integration mode to sapo_go_scrape
process.env.INTEGRATION_MODE = 'sapo_go_scrape';

const { runDailyReport } = require('../workflows/dailyReport');
const logger = require('../utils/logger');

async function testWorkflow() {
  logger.info('🚀 Starting complete Shopee Marketplace workflow test...');
  try {
    const report = await runDailyReport();
    logger.info('🎉 Workflow completed successfully!');
    logger.info(JSON.stringify(report, null, 2));
  } catch (err) {
    logger.error('❌ Workflow test failed:', err);
  }
}

testWorkflow();
