const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const http = require('http'); // Tambahan untuk Render

// --- DUMMY HTTP SERVER UNTUK RENDER ---
// Render 'Web Service' mewajibkan aplikasi membuka sebuah port
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Notification Server is Running OK!');
}).listen(PORT, () => {
    console.log(`Dummy server listening on port ${PORT} (Required by Render)`);
});
// --------------------------------------

// Inisialisasi Firebase Admin
let serviceAccount;

if (process.env.FIREBASE_CREDENTIALS) {
    serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
} else {
    const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
    if (!fs.existsSync(serviceAccountPath)) {
        console.error("ERROR: Kredensial tidak ditemukan!");
        process.exit(1);
    }
    serviceAccount = require(serviceAccountPath);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://safe-93f61-default-rtdb.asia-southeast1.firebasedatabase.app" 
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
        body = `Ketinggian air mencapai ${waterLevel}cm. Segera evakuasi ke tempat aman!`;
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
        if (!users) return;

        const tokens = [];
        Object.keys(users).forEach(uid => {
            const user = users[uid];
            if (user.fcm_tokens) {
                Object.keys(user.fcm_tokens).forEach(tKey => {
                    const token = user.fcm_tokens[tKey];
                    if (token && typeof token === 'string') tokens.push(token);
                });
            }
            if (user.fcm_token) tokens.push(user.fcm_token);
        });

        if (tokens.length === 0) {
            console.log("Tidak ada token FCM yang ditemukan di database.");
            return;
        }

        const message = {
            notification: { title: title, body: body },
            webpush: {
                notification: {
                    icon: "https://img.icons8.com/color/192/siren.png",
                    vibrate: [300, 100, 300, 100, 300],
                    requireInteraction: true
                }
            },
            tokens: tokens
        };

        const response = await messaging.sendEachForMulticast(message);
        console.log(`${response.successCount} pesan berhasil dikirim, ${response.failureCount} gagal.`);
    } catch (error) {
        console.error("Gagal mengirim notifikasi:", error);
    }
}

console.log("Bot Notification Server berjalan. Menunggu data sensor...");
