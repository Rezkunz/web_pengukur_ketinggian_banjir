const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Load credentials from the same place as the server
const serviceAccountPath = path.join(__dirname, '..', 'server', 'serviceAccountKey.json');
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://safe-93f61-default-rtdb.asia-southeast1.firebasedatabase.app/"
});

const db = admin.database();

async function clearAllTokens() {
    console.log("Mengambil data user...");
    const usersSnap = await db.ref('users').once('value');
    const users = usersSnap.val();

    if (!users) {
        console.log("Tidak ada user ditemukan.");
        process.exit(0);
    }

    const updates = {};
    Object.keys(users).forEach(uid => {
        if (users[uid].fcm_token) {
            console.log(`Menghapus token untuk user: ${uid}`);
            updates[`users/${uid}/fcm_token`] = null;
        }
    });

    if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
        console.log("Semua token berhasil dihapus!");
    } else {
        console.log("Tidak ada token yang perlu dihapus.");
    }
    
    process.exit(0);
}

clearAllTokens().catch(err => {
    console.error(err);
    process.exit(1);
});
