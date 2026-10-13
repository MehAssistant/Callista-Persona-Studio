import http from 'http';
import app from './src/app.js';
import whatsappService, { normalizeJid } from './src/services/whatsappClient.js';
import messageStore from './src/services/messageStore.js';
import messageProcessor from './src/services/messageProcessor.js';
import config from './src/config/index.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('TEST SUITE: MIGRASI WHATSAPP KE BAILEYS');
  console.log('====================================================\n');

  // TEST 1: JID Normalization
  console.log('[TEST 1] Pengujian Normalisasi JID Baileys');
  assert(normalizeJid('628123456789@c.us') === '628123456789@s.whatsapp.net', 'Konversi @c.us ke @s.whatsapp.net');
  assert(normalizeJid('628123456789') === '628123456789@s.whatsapp.net', 'Format nomor polos ditambahkan @s.whatsapp.net');
  assert(normalizeJid('628123456789:2@s.whatsapp.net') === '628123456789@s.whatsapp.net', 'Pembersihan device specifier :2');
  assert(normalizeJid('120363023456789@g.us') === '120363023456789@g.us', 'Format grup @g.us dipertahankan');

  // TEST 2: Status Awal dan Endpoint QR
  console.log('\n[TEST 2] Pengujian Status Awal WhatsApp Service');
  const initialStatus = whatsappService.getStatus();
  assert(initialStatus.status === 'disconnected', 'Status awal bernilai disconnected');
  assert(initialStatus.engine === 'baileys', 'Engine adalah baileys');
  assert(initialStatus.isReady === false, 'isReady bernilai false');
  assert(initialStatus.qrAvailable === false, 'qrAvailable bernilai false');

  const initialQr = whatsappService.getQr();
  assert(initialQr.status === 'qr_not_available', 'QR status adalah qr_not_available');
  assert(initialQr.qrAvailable === false, 'qrAvailable bernilai false');
  assert(initialQr.qrDataUrl === null, 'qrDataUrl bernilai null saat belum inisialisasi');

  // TEST 3: Normalisasi Pesan Masuk (Mock Baileys Message Upsert)
  console.log('\n[TEST 3] Pengujian Normalisasi Pesan Masuk & Deduplikasi');
  const mockBaileysMsg = {
    key: {
      remoteJid: '120363023456789@g.us',
      id: `BAILEYS-TEST-${Date.now()}`,
      fromMe: false,
      participant: '628111222333:0@s.whatsapp.net',
    },
    pushName: 'Budi Santoso',
    message: {
      extendedTextMessage: {
        text: 'Halo Callista, bagaimana kabarmu?',
        contextInfo: {
          stanzaId: 'PREV-MSG-123',
          participant: '628999888777@s.whatsapp.net',
        },
      },
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
  };

  // Simulasikan parsing sesuai logika whatsappClient.js
  const parsedChatId = normalizeJid(mockBaileysMsg.key.remoteJid);
  const parsedSenderId = normalizeJid(mockBaileysMsg.key.participant);
  const parsedText = mockBaileysMsg.message.extendedTextMessage.text;
  const parsedQuotedId = mockBaileysMsg.message.extendedTextMessage.contextInfo.stanzaId;
  const parsedQuotedParticipant = normalizeJid(mockBaileysMsg.message.extendedTextMessage.contextInfo.participant);

  const internalMsg = {
    id: mockBaileysMsg.key.id,
    chatId: parsedChatId,
    isGroup: parsedChatId.endsWith('@g.us'),
    senderId: parsedSenderId,
    senderName: mockBaileysMsg.pushName,
    text: parsedText,
    type: 'chat',
    timestamp: new Date(mockBaileysMsg.messageTimestamp * 1000).toISOString(),
    quotedMessageId: parsedQuotedId,
    quotedParticipant: parsedQuotedParticipant,
    fromMe: false,
  };

  const savedMsg = messageStore.addIncomingMessage(internalMsg);
  assert(savedMsg !== null, 'Pesan masuk Baileys berhasil disimpan ke messageStore');
  assert(savedMsg.chatId === '120363023456789@g.us', 'chatId grup ternormalisasi');
  assert(savedMsg.senderId === '628111222333@s.whatsapp.net', 'senderId partisipan grup ternormalisasi');
  assert(savedMsg.isGroup === true, 'isGroup terdeteksi true untuk @g.us');
  assert(savedMsg.quotedMessageId === 'PREV-MSG-123', 'quotedMessageId diekstrak dengan tepat');
  assert(savedMsg.quotedParticipant === '628999888777@s.whatsapp.net', 'quotedParticipant ternormalisasi');

  // Uji deduplikasi
  const dupMsg = messageStore.addIncomingMessage(internalMsg);
  assert(dupMsg === null, 'Deduplikasi berhasil: Pesan dengan ID sama ditolak');

  // TEST 4: Filter Lokal Sebelum AI
  console.log('\n[TEST 4] Pengujian Filter Lokal Sebelum Vertex AI');
  const groupFilterResult = messageProcessor.checkLocalGroupFilter(savedMsg, whatsappService);
  assert(groupFilterResult.allowed === true, 'Pesan grup dengan nama Callista lolos filter lokal');

  const noTriggerGroupMsg = {
    id: `NO-TRIG-${Date.now()}`,
    chatId: '120363023456789@g.us',
    isGroup: true,
    senderId: '628111222333@s.whatsapp.net',
    text: 'Selamat pagi kawan-kawan semua!',
    type: 'chat',
    fromMe: false,
  };
  const blockedResult = messageProcessor.checkLocalGroupFilter(noTriggerGroupMsg, whatsappService);
  assert(blockedResult.allowed === false, 'Pesan grup tanpa nama pemicu dicegah sebelum AI');

  // TEST 5: HTTP Endpoints
  console.log('\n[TEST 5] Pengujian Endpoint HTTP Express');
  const testServer = http.createServer(app);
  await new Promise((resolve) => testServer.listen(0, resolve));
  const testPort = testServer.address().port;
  const baseUrl = `http://127.0.0.1:${testPort}`;

  try {
    // 5a. GET /api/health
    const healthRes = await fetch(`${baseUrl}${config.apiPrefix}/health`);
    const healthData = await healthRes.json();
    assert(healthRes.status === 200 && healthData.success === true, 'GET /api/health mengembalikan 200');

    // 5b. GET /api/whatsapp/status
    const statusRes = await fetch(`${baseUrl}${config.apiPrefix}/whatsapp/status`);
    const statusData = await statusRes.json();
    assert(statusRes.status === 200 && statusData.success === true, 'GET /api/whatsapp/status mengembalikan 200');
    assert(statusData.data.engine === 'baileys', 'Response status memuat engine: baileys');
    assert(statusData.data.status === 'disconnected', 'Status data adalah disconnected');

    // 5c. GET /api/whatsapp/qr
    const qrRes = await fetch(`${baseUrl}${config.apiPrefix}/whatsapp/qr`);
    const qrData = await qrRes.json();
    assert(qrRes.status === 200 && qrData.success === true, 'GET /api/whatsapp/qr mengembalikan 200');
    assert(qrData.data.status === 'qr_not_available', 'QR status qr_not_available saat belum connect');
    assert(qrData.data.qrAvailable === false, 'qrAvailable false saat belum connect');

    // 5d. POST /api/messages/send saat belum ready
    const sendRes = await fetch(`${baseUrl}${config.apiPrefix}/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: '628123456789@s.whatsapp.net',
        text: 'Halo dari pengujian',
      }),
    });
    const sendData = await sendRes.json();
    assert(sendRes.status === 409 && sendData.success === false, 'POST /api/messages/send mengembalikan 409 saat client belum terhubung');

    // 5e. GET /api/chats/:chatId/context
    const contextRes = await fetch(`${baseUrl}${config.apiPrefix}/chats/120363023456789%40g.us/context`);
    const contextData = await contextRes.json();
    assert(contextRes.status === 200 && contextData.success === true, 'GET /api/chats/:chatId/context mengembalikan 200');
    assert(contextData.data.messages.length > 0, 'Buffer konteks grup memuat pesan yang baru saja masuk');

    // 5f. GET /api/messages
    const messagesRes = await fetch(`${baseUrl}${config.apiPrefix}/messages?limit=5`);
    const messagesData = await messagesRes.json();
    assert(messagesRes.status === 200 && messagesData.success === true, 'GET /api/messages mengembalikan riwayat pesan');

    // 5g. POST /api/whatsapp/disconnect
    const dcRes = await fetch(`${baseUrl}${config.apiPrefix}/whatsapp/disconnect`, { method: 'POST' });
    const dcData = await dcRes.json();
    assert(dcRes.status === 200 && dcData.success === true, 'POST /api/whatsapp/disconnect mengembalikan 200');
  } finally {
    testServer.close();
  }

  console.log('\n====================================================');
  console.log(`HASIL: ${passed} LULUS, ${failed} GAGAL`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
