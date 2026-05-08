const functions = require("firebase-functions");
const admin = require("firebase-admin");
// admin.initializeApp(); // Sudah tidak diperlukan jika function dinonaktifkan

/**
 * [NONAKTIF] Trigger otomatis saat level air berubah di Realtime Database.
 * Sekarang notifikasi ditangani oleh Server Render (server/index.js) agar ada fitur cooldown.
 */
/*
exports.sendFloodNotification = functions.database.ref('/sensor_data/water_level')
    .onUpdate(async (change, context) => {
        // ... (Logika dipindahkan ke server/index.js) ...
        return null;
    });
*/

// Anda bisa menghapus file ini atau membiarkannya ter-comment jika ingin beralih kembali nanti.
