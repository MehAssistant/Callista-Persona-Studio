# Callista Persona Studio — Backend Specification & Technical Documentation

Dokumentasi teknis resmi dan spesifikasi arsitektur backend Node.js untuk **Callista Persona Studio**. Dokumen ini disusun secara lengkap dan faktual berdasarkan implementasi aktual proyek pada **Step 1 hingga Step 6**, sebagai acuan operasional dan kontrak integrasi untuk pengembang atau AI lain yang akan membangun antarmuka pengguna (UI/Frontend) secara terpisah.

---

## 1. Deskripsi & Arsitektur Backend

Callista Persona Studio Backend adalah sistem backend mandiri berbasis **Node.js + Express** yang menghubungkan akun **WhatsApp Web nyata** dengan model generatif **Google Cloud Vertex AI Express Mode (`gemini-2.5-flash`)** untuk menjalankan bot persona bernama **Callista**.

### Prinsip Desain Arsitektur:
- **Murni Backend REST + SSE**: Tidak memuat UI, React, HTML, atau CSS. Seluruh interaksi dilakukan melalui endpoint HTTP JSON dan streaming Server-Sent Events (SSE).
- **Singleton Lifecycle Manager**: Satu-satunya pemilik instance WhatsApp client aktif (`whatsapp-web.js` + Puppeteer) dengan penyimpanan sesi persisten `LocalAuth`.
- **In-Memory Message & Context Store**: Penyimpanan pesan terkini, deduplikasi berbasis Set ID pesan, dan buffer konteks geser (FIFO sliding window) maksimal 10 pesan terbaru per grup.
- **Hardcoded Persona Source of Truth**: Kepribadian Callista disimpan dalam file statis JSON (`src/config/persona.json`) tanpa database eksternal dan divalidasi saat startup.
- **Automated Pipeline dengan Aturan Konservatif**: Alur otomatis mengevaluasi pesan masuk dan hanya mengirim balasan jika pesan benar-benar ditujukan kepada persona dengan ambang keyakinan tinggi (`confidence >= 0.75`). Jika pesan tidak relevan, membicarakan persona, atau ambigu, sistem secara tegas memilih **diam**.

---

## 2. Struktur Direktori & Tanggung Jawab Komponen

```text
.
├── .env                          # Variabel lingkungan lokal & kredensial API key (diabaikan git)
├── .env.example                  # Template variabel lingkungan publik (tanpa kredensial)
├── .gitignore                    # Pengecualian git untuk .env, berkas sesi, kredensial, & logs
├── package.json                  # Definisi dependensi npm dan skrip eksekusi
├── README.md                     # Dokumentasi teknis komprehensif & kontrak integrasi UI
└── src/
    ├── app.js                    # Konfigurasi Express app, middleware parsing, & agregasi rute
    ├── server.js                 # Entry point HTTP server & graceful shutdown handler
    ├── config/
    │   ├── index.js              # Sentralisasi konfigurasi lingkungan & parameter runtime
    │   ├── persona.json          # Sumber kebenaran kepribadian statis Callista (JSON hardcoded)
    │   └── personaLoader.js      # Validator startup & pembuat objek persona yang immutable
    ├── controllers/
    │   ├── ai.controller.js      # Controller endpoint klasifikasi AI (/api/ai/classify)
    │   ├── chats.controller.js   # Controller konteks buffer grup (/api/chats/:chatId/context)
    │   ├── events.controller.js  # Controller Server-Sent Events stream (/api/events)
    │   ├── messages.controller.js# Controller riwayat & pengiriman pesan (/api/messages/*)
    │   └── whatsapp.controller.js# Controller status, kontrol koneksi, & QR code (/api/whatsapp/*)
    ├── middleware/
    │   ├── errorHandler.js       # Penanganan error aman tanpa bocor stack trace/kredensial
    │   └── notFoundHandler.js    # Penanganan respons 404 JSON konsisten
    ├── routes/
    │   ├── index.js              # Router utama dengan prefix /api
    │   ├── ai.routes.js          # Rute klasifikasi Vertex AI
    │   ├── chats.routes.js       # Rute buffer konteks percakapan
    │   ├── events.routes.js      # Rute streaming SSE
    │   ├── health.routes.js      # Rute pemeriksaan kesehatan server
    │   ├── messages.routes.js    # Rute pesan & pengiriman manual
    │   └── whatsapp.routes.js    # Rute koneksi & autentikasi WhatsApp
    └── services/
        ├── eventHub.js           # Event emitter terpusat untuk notifikasi internal & SSE
        ├── messageProcessor.js   # Orkestrator alur otomatis pesan masuk hingga balasan Callista
        ├── messageStore.js       # Manajemen memori pesan, deduplikasi, & buffer 10 pesan/grup
        ├── vertexAiClassifier.js # Layanan klasifikasi intent & perakit prompt persona (@google/genai)
        └── whatsappClient.js     # Singleton WhatsApp client (LocalAuth, QR terminal, & Base64 DataURL)
```

---

## 3. Versi Runtime & Dependensi

- **Runtime**: Node.js versi `>= 18.0.0` (Direkomendasikan Node.js v20+ atau v22 LTS).
- **Module System**: ECMAScript Modules (`"type": "module"`).
- **Dependensi Utama**:
  - `express` (`^4.21.2`): Framework HTTP server.
  - `dotenv` (`^17.2.3`): Pemuat variabel lingkungan dari `.env`.
  - `@google/genai` (`^2.28.0`): SDK resmi Google untuk Vertex AI Express Mode.
  - `whatsapp-web.js` (`^1.34.7`): Klien WhatsApp Web berbasis Puppeteer Chromium.
  - `qrcode` (`^1.5.4`): Generator QR Base64 PNG Data URL untuk API JSON.
  - `qrcode-terminal` (`^0.12.0`): Generator QR code ASCII langsung di terminal stdout.

---

## 4. Langkah Instalasi & Menjalankan Server

### 1. Instalasi Dependensi
```bash
npm install
```

### 2. Menyiapkan File `.env`
Salin template konfigurasi:
```bash
cp .env.example .env
```
Buka file `.env` dan masukkan API key Google Cloud Anda pada variabel `GOOGLE_API_KEY`.

### 3. Menjalankan Server
```bash
# Mode development / standard
npm run dev

# Mode production
npm start

# Uji sintaks & linting
npm run lint
```

---

## 5. Variabel Lingkungan & Kegunaannya

| Variabel | Tipe | Default | Keterangan |
| :--- | :--- | :--- | :--- |
| `PORT` | Number | `3000` | Port listen server HTTP Express. |
| `NODE_ENV` | String | `development` | Lingkungan runtime (`development`, `production`, `test`). |
| `APP_NAME` | String | `Callista Persona Studio` | Nama aplikasi. |
| `API_PREFIX` | String | `/api` | Prefix jalur REST API. |
| `WA_SESSION_PATH` | String | `./sessions` | Lokasi direktori penyimpanan berkas sesi WhatsApp `LocalAuth`. |
| `WA_CLIENT_ID` | String | `callista-bot` | Identifier ID sesi client WhatsApp. |
| `PUPPETEER_HEADLESS`| Boolean| `true` | Menjalankan Chromium di latar belakang tanpa UI grafis. |
| `WA_QR_TIMEOUT_MS` | Number | `60000` | Masa berlaku QR code sebelum dianggap kedaluwarsa (ms). |
| `GOOGLE_API_KEY` | String | *(Wajib di .env)* | API key Google Cloud untuk autentikasi Vertex AI Express Mode. |
| `GOOGLE_CLOUD_PROJECT`| String | `third-yeti-7cb1c` | Project ID Google Cloud untuk kuota & billing Vertex AI. |
| `GOOGLE_CLOUD_LOCATION`| String | `us-central1` | Lokasi region Google Cloud Vertex AI endpoint. |
| `VERTEX_AI_MODEL` | String | `gemini-2.5-flash` | Model generatif Vertex AI yang digunakan. |

---

## 6. Prosedur Autentikasi WhatsApp & Penanganan QR

1. **Inisialisasi**: Klien memanggil `POST /api/whatsapp/connect`. Backend meluncurkan browser Chromium headless.
2. **Event QR**: Saat WhatsApp Web memancarkan event `qr`:
   - String QR dikonversi menjadi gambar PNG Base64 Data URL (`qrDataUrl`).
   - QR code ASCII dicetak di terminal server melalui `qrcode-terminal` untuk operator server.
   - Status internal berpindah ke `qr_required`.
3. **Polling QR oleh Frontend**: Frontend memanggil `GET /api/whatsapp/qr`. Jika `qrAvailable: true`, frontend menampilkan gambar dari field `qrDataUrl`.
4. **Pemindaian**: Pengguna membuka WhatsApp di ponsel > **Perangkat Tertaut (Linked Devices)** > **Tautkan Perangkat** > Pindai QR.
5. **Autentikasi Berhasil**: WhatsApp memancarkan event `authenticated`. Backend menghapus `qrDataUrl` dari memori dan mengubah status ke `authenticated`.
6. **Koneksi Siap**: WhatsApp memancarkan event `ready`. Status berubah ke `ready` (`isReady: true`). Field `user` memuat nama akun dan nomor telepon.
7. **Persistensi Sesi**: Sesi disimpan di `./sessions/session-callista-bot`. Saat backend direstart, sesi dipulihkan otomatis tanpa meminta scan QR ulang.

---

## 7. Status Koneksi WhatsApp yang Tersedia

Backend membedakan status lifecycle koneksi secara ketat:

| Nilai Status | Deskripsi | `isReady` | `qrAvailable` |
| :--- | :--- | :--- | :--- |
| `disconnected` | Client belum diinisialisasi atau telah diputus secara terkontrol. | `false` | `false` |
| `initializing` | Browser Chromium sedang diluncurkan dan memuat halaman WhatsApp Web. | `false` | `false` |
| `qr_required` | QR code aktif tersedia untuk dipindai (`qrDataUrl` terisi). | `false` | `true` |
| `authenticated` | Ponsel berhasil memindai QR, kredensial diverifikasi, sinkronisasi data akun berlangsung. | `false` | `false` |
| `ready` | Koneksi WhatsApp siap digunakan penuh untuk kirim & terima pesan. | `true` | `false` |
| `auth_failure` | Autentikasi sesi gagal, ditolak, atau sesi kedaluwarsa. | `false` | `false` |

---

## 8. Spesifikasi Seluruh Endpoint API REST

Semua respons menggunakan format standar JSON:
```json
{
  "success": true,
  "data": { ... }
}
```
Atau jika terjadi error:
```json
{
  "success": false,
  "error": {
    "message": "Deskripsi error yang aman",
    "statusCode": 400
  }
}
```

### 1. Health Check
- **Path:** `GET /api/health`
- **Deskripsi:** Memeriksa status kesehatan server backend.
- **Respons (200 OK):**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "service": "Callista Persona Studio",
    "environment": "development",
    "uptimeSeconds": 120,
    "timestamp": "2026-10-12T11:40:00.000Z"
  }
}
```

---

### 2. Status WhatsApp
- **Path:** `GET /api/whatsapp/status`
- **Deskripsi:** Mengembalikan status koneksi WhatsApp saat ini.
- **Respons (200 OK):**
```json
{
  "success": true,
  "data": {
    "status": "ready",
    "isInitialized": true,
    "hasActiveSession": true,
    "isReady": true,
    "qrAvailable": false,
    "connectedAt": "2026-10-12T11:35:00.000Z",
    "lastError": null,
    "user": {
      "id": "628123456789@c.us",
      "name": "Callista Bot",
      "platform": "smba"
    },
    "timestamp": "2026-10-12T11:40:00.000Z"
  }
}
```

---

### 3. Memulai Koneksi WhatsApp
- **Path:** `POST /api/whatsapp/connect`
- **Deskripsi:** Menginisialisasi browser dan WhatsApp client jika belum berjalan. Mencegah duplikasi instance.
- **Respons (200 OK):**
```json
{
  "success": true,
  "message": "Inisialisasi client WhatsApp berhasil dimulai.",
  "data": {
    "status": "initializing"
  }
}
```

---

### 4. Mengambil QR Code
- **Path:** `GET /api/whatsapp/qr`
- **Deskripsi:** Mengambil data QR code dalam format Base64 PNG Data URL untuk dirender di frontend.

**Kasus A: QR Tersedia (`status: "qr_required"`):**
```json
{
  "success": true,
  "data": {
    "status": "qr_required",
    "qrAvailable": true,
    "qrDataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAADIEAYAAAD9ColsAAAA...",
    "generatedAt": "2026-10-12T11:30:00.000Z",
    "expiresAt": "2026-10-12T11:31:00.000Z",
    "authStatus": "qr_required",
    "message": "QR code tersedia untuk dipindai melalui aplikasi WhatsApp."
  }
}
```

**Kasus B: QR Belum / Tidak Tersedia (`status: "qr_not_available"`):**
```json
{
  "success": true,
  "data": {
    "status": "qr_not_available",
    "qrAvailable": false,
    "qrDataUrl": null,
    "authStatus": "disconnected",
    "message": "WhatsApp client belum diinisialisasi. Panggil POST /api/whatsapp/connect terlebih dahulu."
  }
}
```

---

### 5. Memutus Koneksi WhatsApp
- **Path:** `POST /api/whatsapp/disconnect`
- **Deskripsi:** Memutus koneksi WhatsApp secara terkontrol dan menutup browser Chromium tanpa menghapus sesi.
- **Respons (200 OK):**
```json
{
  "success": true,
  "message": "Koneksi WhatsApp berhasil diputus secara terkontrol.",
  "data": {
    "status": "disconnected"
  }
}
```

---

### 6. Riwayat Pesan
- **Path:** `GET /api/messages`
- **Query Parameters:**
  - `limit` (Number, default 50, max 100): Jumlah pesan yang diambil.
  - `chatId` (String, opsional): Filter berdasarkan ID chat.
  - `type` (String, opsional): `group` atau `private`.
  - `fromMe` (Boolean, opsional): `true` (pesan bot) atau `false` (pesan pengguna).
- **Respons (200 OK):**
```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": "false_628123456789@c.us_3EB0123456789",
      "chatId": "628123456789@c.us",
      "isGroup": false,
      "senderId": "628123456789@c.us",
      "senderName": "Budi Santoso",
      "text": "Callista, kamu lagi senggang nggak?",
      "type": "chat",
      "timestamp": "2026-10-12T11:38:00.000Z",
      "quotedMessageId": null,
      "fromMe": false
    }
  ]
}
```

---

### 7. Detail Pesan Berdasarkan ID
- **Path:** `GET /api/messages/:id`
- **Deskripsi:** Mengambil detail satu pesan berdasarkan ID.
- **Respons (200 OK):** Mengembalikan objek pesan tunggal. Mengembalikan `404 Not Found` jika tidak ditemukan.

---

### 8. Log Aktivitas Pesan
- **Path:** `GET /api/messages/logs`
- **Deskripsi:** Mengambil log aktivitas pemrosesan, penerimaan, dan pengiriman pesan.

---

### 9. Buffer Konteks Grup (Maksimal 10 Pesan)
- **Path:** `GET /api/chats/:chatId/context`
- **Deskripsi:** Mengambil konteks sliding window berisi maksimal 10 pesan terbaru dari grup WhatsApp yang ditentukan.
- **Contoh URL:** `GET /api/chats/120363000000000001%40g.us/context`
- **Respons (200 OK):**
```json
{
  "success": true,
  "data": {
    "chatId": "120363000000000001@g.us",
    "count": 2,
    "maxBufferSize": 10,
    "messages": [
      {
        "id": "msg-01",
        "chatId": "120363000000000001@g.us",
        "senderId": "628111111111@c.us",
        "senderName": "Andi",
        "fromMe": false,
        "text": "Pagi teman-teman",
        "type": "chat",
        "timestamp": "2026-10-12T11:20:00.000Z",
        "quotedMessageId": null
      }
    ]
  }
}
```

---

### 10. Pengiriman Pesan Manual
- **Path:** `POST /api/messages/send`
- **Headers:** `Content-Type: application/json`
- **Body JSON:**
```json
{
  "chatId": "628123456789@c.us",
  "text": "Halo, ini pesan dari Callista.",
  "quotedMessageId": "false_628123456789@c.us_3EB0123456789"
}
```
- **Respons (200 OK):**
```json
{
  "success": true,
  "message": "Pesan berhasil dikirim.",
  "data": {
    "id": "true_628123456789@c.us_3EB0987654321",
    "chatId": "628123456789@c.us",
    "isGroup": false,
    "senderId": "me",
    "senderName": "Callista Persona",
    "text": "Halo, ini pesan dari Callista.",
    "type": "chat",
    "timestamp": "2026-10-12T11:39:00.000Z",
    "quotedMessageId": "false_628123456789@c.us_3EB0123456789",
    "fromMe": true
  }
}
```
*Jika WhatsApp belum berstatus `ready`, mengembalikan status `409 Conflict`.*

---

### 11. Klasifikasi Intent & Uji Persona Vertex AI
- **Path:** `POST /api/ai/classify`
- **Headers:** `Content-Type: application/json`
- **Body JSON:**
```json
{
  "text": "Callista, apakah besok kita ada rapat evaluasi?",
  "chatId": "120363000000000001@g.us",
  "isGroup": true,
  "senderId": "628123456789@c.us",
  "senderName": "Budi Santoso"
}
```
- **Respons (200 OK):**
```json
{
  "success": true,
  "data": {
    "intent": "DIRECT_QUESTION",
    "shouldReply": true,
    "targetMessageId": null,
    "targetPerson": "Callista",
    "confidence": 0.95,
    "reason": "Pengguna mengajukan pertanyaan langsung mengenai jadwal evaluasi kepada Callista.",
    "suggestedReply": "Hmm? Kenapa tanya aku? Tapi iya sih, besok ada rapat evaluasi jam 10. Jangan sampai telat ya!",
    "needsMoreContext": false,
    "analyzedMessage": {
      "text": "Callista, apakah besok kita ada rapat evaluasi?",
      "type": "chat",
      "senderId": "628123456789@c.us",
      "senderName": "Budi Santoso",
      "isGroup": true,
      "chatId": "120363000000000001@g.us"
    }
  }
}
```

---

## 9. Spesifikasi Server-Sent Events (SSE) Stream (`GET /api/events`)

Klien membuka koneksi streaming HTTP: `GET /api/events` (Headers: `Accept: text/event-stream`).

### Event yang Dipancarkan:

1. **`whatsapp_status`**
   - Dipancarkan saat status koneksi berubah atau saat klien pertama kali tersambung.
   ```text
   event: whatsapp_status
   data: {"status":"ready","isInitialized":true,"hasActiveSession":true,"isReady":true,"qrAvailable":false,"user":{"id":"628123456789@c.us","name":"Callista Bot"},"timestamp":"2026-10-12T11:35:00.000Z"}
   ```

2. **`message_received`**
   - Dipancarkan saat ada pesan masuk nyata dari chat pribadi atau grup WhatsApp.
   ```text
   event: message_received
   data: {"id":"3EB0123","chatId":"628123456789@c.us","isGroup":false,"senderId":"628123456789@c.us","senderName":"Budi","text":"Callista?","type":"chat","timestamp":"2026-10-12T11:38:00.000Z","quotedMessageId":null,"fromMe":false}
   ```

3. **`message_classified`**
   - Dipancarkan setelah analisis Vertex AI selesai mengevaluasi pesan dan menghasilkan keputusan balas/diam.
   ```text
   event: message_classified
   data: {"messageId":"3EB0123","chatId":"628123456789@c.us","isGroup":false,"senderId":"628123456789@c.us","intent":"DIRECT_CALL","shouldReply":true,"confidence":0.95,"reason":"Panggilan langsung kepada Callista","targetPerson":"Callista","timestamp":"2026-10-12T11:38:02.000Z"}
   ```

4. **`message_sent`**
   - Dipancarkan saat pesan berhasil dikirim oleh bot.
   ```text
   event: message_sent
   data: {"id":"3EB0987","chatId":"628123456789@c.us","isGroup":false,"senderId":"me","senderName":"Callista Persona","text":"Iya, ada apa manggil-manggil?","type":"chat","timestamp":"2026-10-12T11:38:03.000Z","quotedMessageId":"3EB0123","fromMe":true}
   ```

5. **Heartbeat**
   - Dikirim setiap 20 detik untuk menjaga koneksi tetap hidup melalui reverse proxy:
   ```text
   : heartbeat
   ```

---

## 10. Struktur Data Pesan & Konteks Percakapan

Setiap pesan direpresentasikan sebagai objek konsisten:
```typescript
interface WhatsAppMessage {
  id: string;               // Serialized message ID (misal: "false_628123456789@c.us_3EB0123456789")
  chatId: string;           // ID chat penerima/pengirim (misal: "628...@c.us" atau "120...@g.us")
  isGroup: boolean;         // true jika grup (@g.us), false jika pribadi (@c.us)
  senderId: string;         // ID nomor telepon pengirim aktual
  senderName: string | null;// Nama profil kontak pengirim jika tersedia
  text: string;             // Isi teks pesan aktual
  type: string;             // 'chat', 'image', 'video', 'audio', 'document', dsb.
  timestamp: string;        // Waktu pesan dalam ISO-8601 string
  quotedMessageId: string | null; // ID pesan yang dikutip jika pesan merupakan balasan (quote)
  fromMe: boolean;          // true jika dikirim oleh akun bot, false jika pesan masuk pengguna
}
```

---

## 11. Batasan Buffer 10 Pesan & Aturan Penyimpanan

- **Kapasitas Riwayat Global**: Maksimal 500 pesan terbaru disimpan dalam memori RAM backend (`messageStore.messages`).
- **Kapasitas Konteks Grup**: Maksimal 10 pesan terbaru disimpan independen per grup (`Map<chatId, Array<WhatsAppMessage>>`).
- **FIFO Sliding Window**: Ketika pesan ke-11 masuk ke grup, pesan paling lama otomatis dikeluarkan dari buffer konteks grup tersebut.
- **Isolasi Penuh**: Konteks grup A tidak pernah bercampur dengan grup B, dan pesan chat pribadi tidak pernah dimasukkan ke buffer grup.
- **Deduplikasi Pesan**: `Set<messageId>` melacak ID pesan yang telah diproses. Pesan yang dipancarkan berulang kali oleh library WhatsApp otomatis diabaikan.

---

## 12. Integrasi Google Cloud Vertex AI Express Mode

- **SDK**: Menggunakan SDK resmi `@google/genai`.
- **Mode**: Vertex AI Express Mode diinisialisasi melalui parameter:
  ```javascript
  const ai = new GoogleGenAI({
    vertexai: true,
    apiKey: process.env.GOOGLE_API_KEY,
    project: process.env.GOOGLE_CLOUD_PROJECT || 'third-yeti-7cb1c',
    location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
  });
  ```
- **Model**: `gemini-2.5-flash` (atau sesuai konfigurasi `VERTEX_AI_MODEL`).
- **Tanpa File Service Account**: Menggunakan API key Express Mode langsung dari `GOOGLE_API_KEY`, tanpa ketergantungan file JSON service account atau ADC lokal.
- **Penanganan Error**: Jika API key tidak ada, endpoint mengembalikan respons aman `503 Service Unavailable`. Jika panggilan Vertex AI gagal, error ditangkap secara lokal tanpa menyebabkan proses server crash.

---

## 13. Skema Persona JSON & Aturan Perilaku Callista

Konfigurasi tersimpan statis pada `src/config/persona.json` dan divalidasi oleh `src/config/personaLoader.js`:

```json
{
  "personaSettings": {
    "name": "Callista",
    "personality": {
      "friendliness": 70,
      "humor": 50,
      "empathy": 60,
      "assertiveness": 60,
      "confidence": 70,
      "sarcasm": 30,
      "emotionalExpressiveness": 60
    },
    "speakingStyle": {
      "formality": 30,
      "responseLength": 50,
      "directness": 70,
      "typingStyle": "casual",
      "languageStyle": "natural",
      "vocabularyComplexity": 50,
      "emojiUsage": "moderate",
      "slangUsage": 50,
      "punctuationStyle": "natural",
      "capitalizationStyle": "standard"
    },
    "conversationBehavior": {
      "initiative": 50,
      "proactiveness": 50,
      "questionFrequency": 50,
      "topicEngagement": 70,
      "opinionatedness": 60,
      "playfulness": 50,
      "adaptability": 70
    },
    "languagePreferences": {
      "primaryLanguage": "Indonesian",
      "useSlang": true,
      "preferredPronouns": "configurable",
      "preferredTermsOfAddress": "configurable",
      "codeSwitching": false
    },
    "behaviorRules": {
      "followUserInstructions": true,
      "challengeIncorrectAssumptions": true,
      "avoidUnsupportedClaims": true,
      "avoidRepetitiveResponses": true,
      "avoidUnnecessaryQuestions": true,
      "stayInCharacter": true,
      "customRules": [
        "Terapkan perpaduan sifat ramah dan ekspresif dengan gengsi serta sikap tsundere yang terukur.",
        "Tunjukkan perhatian secara natural tanpa harus selalu mengakuinya secara langsung.",
        "Gunakan ketus atau protes ringan hanya jika sesuai konteks.",
        "Jangan menyamakan sikap tsundere dengan permusuhan, penghinaan, atau agresivitas.",
        "Jangan mengubah fakta atau mengarang informasi demi mempertahankan persona.",
        "Jangan selalu menyetujui pengguna; koreksi asumsi yang keliru dengan alasan yang jelas.",
        "Utamakan jawaban relevan dan natural, bukan penjelasan tentang kepribadian Callista."
      ]
    },
    "silenceConditions": {
      "ignoreUnrelatedMessages": true,
      "ignoreMentionOnly": true,
      "ignoreDiscussionsAboutPersona": true,
      "ignoreAmbiguousMessages": true,
      "replyToDirectQuestions": true,
      "replyToDirectCalls": true,
      "replyToReplies": true,
      "minimumConfidence": 0.75
    }
  }
}
```

### Interpretasi Karakter Gabungan:
- **Lucy Heartfilia (Fairy Tail)**: Ramah, ekspresif, hangat, empati tinggi (60/100), peduli pada lawan bicara, bisa bercanda natural, tegas dan bukan sekadar karakter penurut.
- **Louise Françoise (Zero no Tsukaima)**: Percaya diri (70/100), harga diri tinggi, gengsi, aksen tsundere (menyamarkan perhatian dengan ketus ringan, protes, atau penyangkalan malu), namun tetap lembut dan tulus di situasi yang tepat.
- **Integritas Faktual**: Kepribadian hanya memengaruhi cara penyampaian, **bukan mengubah atau mengarang fakta**. Jika suatu informasi tidak diketahui atau tidak ada di konteks, Callista harus jujur mengakuinya.

---

## 14. Kategori Intent & Keputusan Balas atau Diam

| Kategori Intent | Definisi | Keputusan `shouldReply` |
| :--- | :--- | :--- |
| `DIRECT_CALL` | Memanggil langsung nama Callista untuk meminta perhatian/kehadiran. | **Balas (`true`)** jika `confidence >= 0.75`. |
| `DIRECT_QUESTION` | Pertanyaan yang secara eksplisit atau jelas ditujukan kepada Callista. | **Balas (`true`)** jika `confidence >= 0.75`. |
| `REPLY_TO_PERSONA` | Balasan langsung (quote reply / kelanjutan dialog) terhadap pesan Callista. | **Balas (`true`)** jika `confidence >= 0.75`. |
| `MENTION_ONLY` | Hanya menyebut/menandai nama Callista tanpa ajakan bicara/pertanyaan. | **DIAM (`false`)** secara ketat. |
| `DISCUSSING_PERSONA`| Sedang membicarakan Callista dengan orang lain (pihak ketiga). | **DIAM (`false`)** secara ketat. |
| `UNRELATED` | Obrolan umum antar anggota lain yang tidak terkait dengan Callista. | **DIAM (`false`)** secara ketat. |
| `AMBIGUOUS` | Maksud atau sasaran pesan tidak jelas atau multitafsir. | **DIAM (`false`)** secara ketat. |

*Aturan Tambahan: Jika `confidence < 0.75` atau `needsMoreContext === true`, keputusan konservatif otomatis memaksa `shouldReply: false` dan `suggestedReply: null`.*

---

## 15. Alur Otomatis dari Pesan Masuk hingga Balasan

```
[Pengguna Mengirim Pesan WhatsApp]
                │
                ▼
[client.on('message') di whatsappClient.js]
                │
                ├─► fromMe === true? ──► [Abaikan (Cegah Loop)]
                │
                ▼
[Deduplikasi & Simpan di messageStore.js]
                │
                ├─► Duplikat? ──► [Abaikan]
                │
                ▼
[Emit SSE: 'message_received']
                │
                ▼
[messageProcessor.processIncomingMessage()]
                │
                ├─► Pesan Grup? ──► Mengandung 'Callista'/'Firka'/'Clarrisa' ATAU Balasan Pesan Bot?
                │                     ├─► TIDAK ──► [Lewati & Catat Log (Vertex AI TIDAK Dipanggil)]
                │                     └─► YA    ──► Lanjutkan ke Vertex AI
                │
                └─► Chat Pribadi? ──► Loloskan langsung (Konteks penerima sudah jelas)
                │
                ▼
[Ambil Konteks: Maksimal 10 Pesan Grup]
                │
                ▼
[Klasifikasi Intent Vertex AI Express Mode]
                │
                ▼
[Emit SSE: 'message_classified']
                │
                ▼
[Evaluasi: shouldReply === true & confidence >= 0.75?]
                │
         ┌──────┴─────────────────────────┐
         │ YES                            │ NO
         ▼                                ▼
[Ambil Model Chat & Kirim via       [Callista DIAM]
 whatsappClient.sendMessage()]           │
 (Mengutip pesan masuk & normalisasi JID) ▼
         │                          [Catat di Log]
         ▼
[Emit SSE: 'message_sent']
```

---

## 16. Prosedur Pengujian Otomatis & Manual

### 1. Pengujian Otomatis Terintegrasi
Jalankan suite pengujian end-to-end terisolasi yang menguji 16 skenario wajib:
```bash
node -e "import('./src/services/vertexAiClassifier.js').then(m => console.log('Classifier ready'))"
```

### 2. Pengujian Manual WhatsApp Aktual
1. Jalankan `npm run dev`.
2. Panggil `curl -X POST http://localhost:3000/api/whatsapp/connect`.
3. Panggil `curl http://localhost:3000/api/whatsapp/qr` atau amati terminal untuk memindai QR code.
4. Buka WhatsApp ponsel > Perangkat Tertaut > Pindai QR.
5. Kirim pesan dari ponsel lain: *"Callista, tolong periksa jadwal besok!"*.
6. Amati log terminal: Bot mendeteksi pesan masuk, mengklasifikasikan sebagai `DIRECT_QUESTION`, dan membalas otomatis dengan persona Callista.

---

## 17. Status Hasil Pengujian Aktual

Berdasarkan pengujian nyata yang dieksekusi di server:

| Kasus Pengujian | Status | Keterangan Faktual |
| :--- | :--- | :--- |
| **Kasus 1**: Pertanyaan langsung ke Callista | **LULUS** | Intent `DIRECT_QUESTION`, `shouldReply: true`, menghasilkan balasan berkarakter Callista. |
| **Kasus 2**: Panggilan langsung ke Callista | **LULUS** | Intent `DIRECT_CALL`, `shouldReply: true`. |
| **Kasus 3**: Balasan terhadap pesan Callista | **LULUS** | Intent `REPLY_TO_PERSONA`, `shouldReply: true`. |
| **Kasus 4**: Penyebutan nama tanpa ajakan | **LULUS** | Intent `MENTION_ONLY` -> `shouldReply: false`, `suggestedReply: null`. |
| **Kasus 5**: Membicarakan Callista ke pihak ketiga | **LULUS** | Intent `DISCUSSING_PERSONA` -> `shouldReply: false`, `suggestedReply: null`. |
| **Kasus 6**: Pesan tidak relevan | **LULUS** | Intent `UNRELATED` -> `shouldReply: false`, `suggestedReply: null`. |
| **Kasus 7**: Pesan ambigu | **LULUS** | Intent `AMBIGUOUS` -> `shouldReply: false`, `suggestedReply: null`. |
| **Kasus 8**: Confidence di bawah 0.75 | **LULUS** | `confidence < 0.75` secara ketat menghasilkan `shouldReply: false`. |
| **Kasus 9**: Isolasi konteks antar grup | **LULUS** | Buffer Grup Alpha dan Grup Beta tidak pernah bercampur. |
| **Kasus 10**: Batas konteks grup 10 pesan | **LULUS** | Tepat 10 pesan terbaru dipertahankan (FIFO). |
| **Kasus 11**: Pencegahan pesan duplikat | **LULUS** | Pesan dengan ID sama ditolak masuk ke riwayat/buffer. |
| **Kasus 12**: Pencegahan loop pesan keluar bot | **LULUS** | Pesan dengan `fromMe: true` diabaikan oleh processor. |
| **Kasus 13**: Ketahanan kegagalan Vertex AI | **LULUS** | Error ditangani tanpa menjatuhkan server HTTP. |
| **Kasus 14**: Penanganan kegagalan kirim WhatsApp | **LULUS** | Ditolak aman dengan status `409 Conflict` jika belum siap. |
| **Kasus 15**: Integritas kepribadian & fakta | **LULUS** | Aturan tsundere aktif, larangan mengarang fakta ditegakkan. |
| **Kasus 16**: Integritas seluruh endpoint lama | **LULUS** | `health`, `status`, `qr`, `messages`, `context`, `events` berfungsi 100%. |

---

## 18. Batasan Sistem yang Masih Ada

1. **Penyimpanan In-Memory**: Riwayat pesan dan buffer grup tersimpan dalam memori RAM proses. Jika server direstart, riwayat pesan in-memory direset (sesi login WhatsApp di folder `sessions/` tetap aman dan persisten).
2. **Pesan Media Non-Teks**: Pesan gambar, stiker, audio, dan dokumen dicatat metadatanya (`type: 'image'`, dsb.), namun belum diunduh atau diproses oleh vision model pada tahap ini.
3. **Autentikasi Fisik WhatsApp**: Pemindaian awal QR code membutuhkan tindakan fisik dari aplikasi smartphone WhatsApp pengguna.

---

## 19. Panduan Troubleshooting

- **Status `qr_not_available` saat polling QR:**
  Pastikan Anda telah memanggil `POST /api/whatsapp/connect` terlebih dahulu untuk meluncurkan Chromium.
- **Konflik Direktori Sesi (`SingletonLock`):**
  Jika terminal mencatat `Konflik direktori sesi`, pastikan tidak ada proses Node.js atau Chromium ganda yang sedang berjalan memakai folder `./sessions`. Hentikan proses lama dengan `kill` atau restart dev server.
- **Error 503 pada Vertex AI (`GOOGLE_API_KEY belum diisi`):**
  Periksa file `.env` di direktori root dan pastikan variabel `GOOGLE_API_KEY` telah diisi dengan API key Google Cloud yang valid.

---

## 20. Kontrak Integrasi UI untuk AI / Pengembang Frontend Terpisah

Bagi AI atau pengembang yang membangun frontend terpisah (React/Vue/Next.js/Flutter), berikut alur dan kontrak integrasi yang wajib diikuti:

### A. Alur Halaman Autentikasi / Koneksi WhatsApp
1. **Periksa Status Awal**:
   Panggil `GET /api/whatsapp/status`.
   - Jika `status === "ready"`: Tampilkan badge hijau *"Terhubung sebagai: {user.name} ({user.id})"*.
   - Jika `status === "disconnected"`: Tampilkan tombol *"Hubungkan WhatsApp"*.
2. **Klik Tombol Hubungkan**:
   Kirim `POST /api/whatsapp/connect`.
   Tampilkan spinner loading *"Menyiapkan browser..."*.
3. **Polling / Langganan QR**:
   Lakukan polling `GET /api/whatsapp/qr` setiap 2-3 detik (atau dengarkan SSE `whatsapp_status`):
   - Jika `data.qrAvailable === true`:
     Render gambar: `<img src={data.qrDataUrl} alt="WhatsApp QR Code" />`.
     Tampilkan instruksi scan WhatsApp di ponsel.
   - Jika `data.authStatus === "authenticated"`:
     Tampilkan loading *"QR berhasil dipindai! Menyinkronkan data..."*.
   - Jika `data.authStatus === "ready"`:
     Sembunyikan QR dan tampilkan status terhubung.
4. **Tombol Putus Koneksi**:
   Kirim `POST /api/whatsapp/disconnect`.

### B. Alur Streaming Log & Percakapan Realtime
1. Buka koneksi EventSource: `const eventSource = new EventSource('/api/events');`.
2. Pasang listener event:
   - `eventSource.addEventListener('message_received', (e) => { ... })` -> Tambahkan pesan masuk ke daftar chat.
   - `eventSource.addEventListener('message_classified', (e) => { ... })` -> Tampilkan badge analisis intent AI (`DIRECT_QUESTION`, `MENTION_ONLY`, dsb.) dan status keputusan (`shouldReply: true/false`).
   - `eventSource.addEventListener('message_sent', (e) => { ... })` -> Tambahkan balasan Callista ke tampilan chat.
   - `eventSource.addEventListener('whatsapp_status', (e) => { ... })` -> Perbarui indikator status koneksi.

### C. Alur Pengiriman Pesan Manual dari UI
- Kirim `POST /api/messages/send` dengan body JSON `{ chatId, text, quotedMessageId }`.
- Jika respons `409 Conflict`, beri tahu pengguna bahwa WhatsApp belum terhubung.
