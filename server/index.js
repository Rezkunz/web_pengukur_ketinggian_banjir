const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Pastikan file serviceAccountKey.json ada di folder yang sama
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

if (!fs.existsSync(serviceAccountPath)) {
    console.error("ERROR: File serviceAccountKey.json tidak ditemukan!");
    console.error("Silakan download dari Firebase Console -> Project Settings -> Service Accounts -> Generate New Private Key.");
    process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

// Inisialisasi Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://safe-93f61-default-rtdb.asia-southeast1.firebasedatabase.app" // Pastikan URL ini benar
});

const db = admin.database();
const messaging = admin.messaging();

console.log("Menghubungkan ke Firebase Database...");

// Threshold Level Air (Pastikan sama dengan Arduino)
const LEVEL_SIAGA1 = 200;
const LEVEL_SIAGA2 = 300;

// Variabel untuk mencegah spam notifikasi beruntun
let currentStatus = "Aman";

// Dengarkan perubahan pada water_level
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

    // Jika status berubah menjadi Siaga 1 atau Siaga 2, kirim notifikasi
    if (newStatus !== "Aman" && newStatus !== currentStatus) {
        console.log(`[${new Date().toISOString()}] Status berubah menjadi ${newStatus}. Mengirim notifikasi...`);
        await sendNotificationToAllUsers(title, body);
    }

    currentStatus = newStatus;
});

async function sendNotificationToAllUsers(title, body) {
    try {
        // Ambil semua data users
        const usersSnap = await db.ref('users').once('value');
        const users = usersSnap.val();
        
        if (!users) return;

        const tokens = [];
        
        // Loop setiap user dan cari fcm_token
        Object.keys(users).forEach(uid => {
            const user = users[uid];
            // Hanya kirim ke admin atau user yang memiliki token
            if (user.fcm_token) {
                tokens.push(user.fcm_token);
            }
        });

        if (tokens.length === 0) {
            console.log("Tidak ada token FCM yang ditemukan di database.");
            return;
        }

        const message = {
            notification: {
                title: title,
                body: body
            },
            webpush: {
                notification: {
                    icon: "https://img.icons8.com/color/192/siren.png", // Ikon sirine agar terlihat darurat
                    vibrate: [300, 100, 300, 100, 300], // Getaran khusus di HP (SOS)
                    requireInteraction: true // Notifikasi tidak akan hilang sendiri sebelum di-klik/ditutup
                }
            },
            tokens: tokens
        };

        const response = await messaging.sendEachForMulticast(message);
        console.log(`${response.successCount} pesan berhasil dikirim, ${response.failureCount} gagal.`);
        
        // Jika ada token yang gagal (misal sudah tidak valid), kita bisa menghapusnya di sini
        // Namun untuk kesederhanaan, kita biarkan saja dulu.
    } catch (error) {
        console.error("Gagal mengirim notifikasi:", error);
    }
}

console.log("Bot Notification Server berjalan. Menunggu data sensor...");
