const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const http = require('http'); // Tambahan untuk Render

// --- DUMMY HTTP SERVER UNTUK RENDER ---
const PORT = process.env.PORT || 3001; // Ubah ke 3001 agar tidak bentrok dengan web server (3000)
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Notification Server is Running OK!');
}).listen(PORT, () => {
    console.log(`Dummy server listening on port ${PORT} (Required by Render)`);
});

let serviceAccount;
if (process.env.FIREBASE_CONFIG_BASE64) {
    try {
        const decodedConfig = Buffer.from(process.env.FIREBASE_CONFIG_BASE64, 'base64').toString('utf8');
        serviceAccount = JSON.parse(decodedConfig);
        console.log("Kredensial berhasil dimuat via Base64.");
    } catch (e) {
        console.error("Gagal decode FIREBASE_CONFIG_BASE64:", e);
    }
}

if (!serviceAccount && process.env.FIREBASE_PRIVATE_KEY) {
    let pk = process.env.FIREBASE_PRIVATE_KEY.trim();
    if (pk.startsWith('"') && pk.endsWith('"')) pk = pk.substring(1, pk.length - 1);
    serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID || "safe-93f61",
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "firebase-adminsdk-fbsvc@safe-93f61.iam.gserviceaccount.com",
        privateKey: pk.replace(/\\n/g, '\n')
    };
} else if (!serviceAccount) {
    const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
    if (fs.existsSync(serviceAccountPath)) {
        serviceAccount = require(serviceAccountPath);
    } else {
        console.error("ERROR: Kredensial tidak ditemukan!");
        process.exit(1);
    }
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://safe-93f61-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "safe-93f61"
});

const db = admin.database();
const messaging = admin.messaging();

console.log("Menghubungkan ke Firebase Database...");

const LEVEL_SIAGA1 = 200;
const LEVEL_SIAGA2 = 300;
let currentStatus = "Aman";

db.ref('sensor_data/water_level').on('value', async (snapshot) => {
    const waterLevel = snapshot.val();
    if (waterLevel === null) return;

    let newStatus = "Aman";
    let title = "";
    let body = "";

    if (waterLevel >= LEVEL_SIAGA2) {
        newStatus = "Siaga 2";
        title = "🚨 SIAGA 2 — Bahaya!";
        body = `Ketinggian air mencapai ${waterLevel}cm. Segera evakuasi!`;
    } else if (waterLevel >= LEVEL_SIAGA1) {
        newStatus = "Siaga 1";
        title = "⚠️ SIAGA 1 — Waspada!";
        body = `Ketinggian air naik ke ${waterLevel}cm. Harap waspada!`;
    }

    if (newStatus !== "Aman" && newStatus !== currentStatus) {
        console.log(`[${new Date().toISOString()}] Status berubah menjadi ${newStatus}. Mengirim notifikasi...`);
        await sendNotificationToAllUsers(title, body);
    }
    currentStatus = newStatus;
});

async function sendNotificationToAllUsers(title, body) {
    try {
        const usersSnap = await db.ref('users').once('value');
        const users = usersSnap.val();
        
        console.log(`Debug: Ditemukan ${users ? Object.keys(users).length : 0} user di database.`);

        if (!users) {
            console.log("Database 'users' kosong.");
            return;
        }

        const tokenData = []; // Simpan objek {token, uid, tKey}
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
            console.log("Tidak ada token FCM aktif.");
            return;
        }

        const tokens = tokenData.map(td => td.token);
        const uniqueNames = [...new Set(tokenData.map(td => {
            const u = users[td.uid];
            return u ? u.nama : 'Anonim';
        }))];

        console.log(`Mengirim notifikasi ke ${tokens.length} token milik user: ${uniqueNames.join(', ')}`);

        // Multicast Message: Data-only untuk Web Push agar selalu diproses SW
        const message = {
            data: {
                title: title,
                body: body,
                click_action: "FLUTTER_NOTIFICATION_CLICK"
            },
            android: {
                priority: "high",
                notification: {
                    title: title,
                    body: body,
                    sound: "default"
                }
            },
            webpush: {
                headers: {
                    Urgency: "high"
                },
                data: {
                    title: title,
                    body: body
                },
                fcm_options: {
                    link: "/"
                }
            },
            tokens: tokens
        };

        const response = await messaging.sendEachForMulticast(message);
        console.log(`${response.successCount} notifikasi berhasil terkirim.`);
        
        if (response.failureCount > 0) {
            console.log(`${response.failureCount} notifikasi gagal. Membersihkan token basi...`);
            
            const cleanupPromises = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const errorCode = resp.error.code;
                    const errorMsg = resp.error.message;
                    const failedTokenInfo = tokenData[idx];

                    console.error(`Gagal [${failedTokenInfo.uid}]: ${errorMsg}`);

                    // Hapus jika token sudah tidak terdaftar (unregistered)
                    if (errorCode === 'messaging/registration-token-not-registered' || 
                        errorMsg.includes('unregistered')) {
                        console.log(`🗑️ Menghapus token basi: ${failedTokenInfo.tKey} milik ${failedTokenInfo.uid}`);
                        cleanupPromises.push(
                            db.ref(`users/${failedTokenInfo.uid}/fcm_tokens/${failedTokenInfo.tKey}`).remove()
                        );
                    }
                }
            });
            
            if (cleanupPromises.length > 0) {
                await Promise.all(cleanupPromises);
                console.log(`✅ Berhasil membersihkan ${cleanupPromises.length} token dari database.`);
            }
        }
    } catch (error) {
        console.error("Gagal mengirim:", error);
    }
}

console.log("Bot Notification Server Live & High Priority.");
