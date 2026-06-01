/**
 * Lark (Feishu) Service Entrypoint (Facade)
 * File re-export tất cả các module con để đảm bảo tính gọn gàng và dễ bảo trì.
 */
const auth = require('./lark/auth');
const messenger = require('./lark/messenger');
const bitable = require('./lark/bitable');
const syncFinancial = require('./lark/syncFinancial');

module.exports = {
  // --- AUTHENTICATION ---
  getTenantAccessToken: auth.getTenantAccessToken,

  // --- MESSENGER & CARDS ---
  sendReportCard: messenger.sendReportCard,
  sendTextAlert: messenger.sendTextAlert,
  sendWebhookMessage: messenger.sendWebhookMessage,
  listChats: messenger.listChats,
  buildMessageCard: messenger.buildMessageCard,

  // --- BITABLE BASIC OPERATIONS ---
  isBaseEnabled: bitable.isBaseEnabled,
  createBitableRecord: bitable.createBitableRecord,
  updateBitableRecord: bitable.updateBitableRecord,
  searchBitableRecordByField: bitable.searchBitableRecordByField,
  upsertOrderToBase: bitable.upsertOrderToBase,
  getOrCreateTable: bitable.getOrCreateTable,

  // --- FINANCIAL SYNC OPERATIONS ---
  syncFinancialReportToLarkBase: syncFinancial.syncFinancialReportToLarkBase,
};
