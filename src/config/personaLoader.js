import fs from 'fs';
import path from 'path';

/**
 * Validasi dan pemuatan konfigurasi statis persona Callista
 */
function loadAndValidatePersona() {
  const personaPath = path.resolve(process.cwd(), 'src/config/persona.json');

  if (!fs.existsSync(personaPath)) {
    throw new Error(`File konfigurasi persona tidak ditemukan di ${personaPath}`);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(personaPath, 'utf8'));
  } catch (err) {
    throw new Error(`File persona.json tidak valid: ${err.message}`);
  }

  const settings = raw?.personaSettings;
  if (!settings) {
    throw new Error("Konfigurasi persona wajib memuat 'personaSettings'");
  }

  if (!settings.name || typeof settings.name !== 'string') {
    throw new Error("Nama persona wajib berupa string");
  }

  const { personality, speakingStyle, conversationBehavior, languagePreferences, behaviorRules, silenceConditions } = settings;

  if (!personality || typeof personality !== 'object') {
    throw new Error("Section 'personality' wajib ada dalam personaSettings");
  }

  // Validasi skor numerik personality (0 - 100)
  for (const [key, val] of Object.entries(personality)) {
    if (typeof val !== 'number' || val < 0 || val > 100) {
      throw new Error(`Nilai personality '${key}' harus berupa angka antara 0 dan 100 (didapat: ${val})`);
    }
  }

  // Validasi silence conditions
  if (!silenceConditions || typeof silenceConditions !== 'object') {
    throw new Error("Section 'silenceConditions' wajib ada dalam personaSettings");
  }

  const minConf = silenceConditions.minimumConfidence;
  if (typeof minConf !== 'number' || minConf < 0 || minConf > 1) {
    throw new Error(`Nilai 'minimumConfidence' harus berupa angka antara 0 dan 1 (didapat: ${minConf})`);
  }

  if (!behaviorRules || !Array.isArray(behaviorRules.customRules)) {
    throw new Error("Section 'behaviorRules.customRules' wajib berupa array");
  }

  // Bekukan objek agar immutable di memori (tidak dapat ditimpa dari runtime/request)
  const frozenPersona = Object.freeze(JSON.parse(JSON.stringify(raw)));
  console.log(`[PERSONA] Konfigurasi persona '${settings.name}' berhasil dimuat dan divalidasi (minimumConfidence: ${minConf}).`);
  return frozenPersona;
}

// Inisialisasi sekali saat server dimulai
export const personaConfig = loadAndValidatePersona();
export default personaConfig;
