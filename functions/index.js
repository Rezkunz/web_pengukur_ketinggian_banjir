const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

/**
 * Trigger otomatis saat level air berubah di Realtime Database.
 * Mengirim notifikasi push ke semua user jika status naik ke Siaga 1 atau 2.
 */
exports.sendFloodNotification = functions.database.ref('/sensor_data/water_level')
    .onUpdate(async (change, context) => {
        const beforeValue = change.before.val();
        const afterValue = change.after.val();

        // Ambang batas (Thresholds)
        const THRESHOLD_SIAGA2 = 300;
        const THRESHOLD_SIAGA1 = 200;

        let title = "";
        let body = "";

        // Logika penentuan status (Hanya kirim jika naik level)
        // Cek Siaga 2 (Bahaya) dulu karena threshold lebih tinggi
        if (afterValue >= THRESHOLD_SIAGA2 && beforeValue < THRESHOLD_SIAGA2) {
            title = "🚨 BAHAYA: STATUS SIAGA 2!";
            body = `Ketinggian air mencapai ${afterValue}cm. Segera evakuasi diri!`;
        } else if (afterValue >= THRESHOLD_SIAGA1 && beforeValue < THRESHOLD_SIAGA1) {
            title = "⚠️ PERINGATAN: STATUS SIAGA 1!";
            body = `Ketinggian air naik ke ${afterValue}cm. Waspada potensi banjir.`;
        }

        // Jika tidak ada kenaikan status yang signifikan, berhenti.
        if (!title) return null;

        console.log(`[Cloud Function] Mengirim notifikasi: ${title}`);

        try {
            // 1. Ambil semua token dari database
            const db = admin.database();
            const usersSnap = await db.ref('users').once('value');
            const users = usersSnap.val();

            if (!users) return null;

            const tokenData = [];
            Object.keys(users).forEach(uid => {
                const user = users[uid];
                if (user.fcm_tokens) {
                    Object.keys(user.fcm_tokens).forEach(tKey => {
                        const token = user.fcm_tokens[tKey];
                        if (token && typeof token === 'string') {
                            tokenData.push({ token, uid, tKey });
                        }
                    });
                }
            });

            if (tokenData.length === 0) {
                console.log("Tidak ada token aktif.");
                return null;
            }

            const tokens = tokenData.map(td => td.token);

            // 2. Siapkan Payload
            const message = {
                data: { title, body },
                android: {
                    priority: "high",
                    notification: { title, body, sound: "default" }
                },
                webpush: {
                    headers: { Urgency: "high" },
                    data: { title, body },
                    fcm_options: { link: "/" }
                },
                tokens: tokens
            };

            // 3. Kirim Notifikasi
            const response = await admin.messaging().sendEachForMulticast(message);
            console.log(`Berhasil kirim: ${response.successCount}, Gagal: ${response.failureCount}`);

            // 4. Auto-Cleanup Token Basi
            if (response.failureCount > 0) {
                const cleanupPromises = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        const errorCode = resp.error.code;
                        const failedTokenInfo = tokenData[idx];

                        if (errorCode === 'messaging/registration-token-not-registered') {
                            console.log(`🗑️ Menghapus token basi: ${failedTokenInfo.tKey}`);
                            cleanupPromises.push(
                                db.ref(`users/${failedTokenInfo.uid}/fcm_tokens/${failedTokenInfo.tKey}`).remove()
                            );
                        }
                    }
                });
                await Promise.all(cleanupPromises);
            }

            return null;
        } catch (error) {
            console.error("Error dalam Cloud Function:", error);
            return null;
        }
    });
