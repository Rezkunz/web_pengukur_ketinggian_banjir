/**
 * SAFE — Set Admin Custom Claims Script
 * ======================================
 * Gunakan script ini untuk meng-grant atau me-revoke role ADMIN
 * pada akun Firebase Authentication.
 *
 * Custom Claims adalah JWT yang di-sign oleh Google, tidak bisa
 * dimanipulasi oleh user dari browser/database.
 *
 * CARA PAKAI:
 *   node set-admin-claim.js grant email@example.com
 *   node set-admin-claim.js revoke email@example.com
 *   node set-admin-claim.js list
 *
 * REQUIREMENT (pilih salah satu):
 *   1. Taruh file serviceAccountKey.json di folder server/ ini
 *   2. ATAU buat file server/.env dengan isi: FIREBASE_CONFIG_BASE64=<base64>
 *   3. ATAU set environment variable FIREBASE_CONFIG_BASE64 di sistem
 */

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

// Coba load .env lokal jika ada (opsional, tidak wajib punya dotenv)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
            const key = trimmed.substring(0, eqIdx).trim();
            const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
            if (!process.env[key]) process.env[key] = val;
        }
    });
    console.log('📄 Loaded environment dari server/.env');
}

// ── Inisialisasi Firebase Admin ──────────────────────────────────────────────
let serviceAccount;

if (process.env.FIREBASE_CONFIG_BASE64) {
    serviceAccount = JSON.parse(
        Buffer.from(process.env.FIREBASE_CONFIG_BASE64, 'base64').toString('utf8')
    );
    console.log('✅ Kredensial dimuat via FIREBASE_CONFIG_BASE64.');
} else {
    const keyPath = path.join(__dirname, 'serviceAccountKey.json');
    if (!fs.existsSync(keyPath)) {
        console.error('❌ ERROR: serviceAccountKey.json tidak ditemukan di folder server/');
        console.error('   Download dari Firebase Console → Project Settings → Service Accounts → Generate new private key');
        process.exit(1);
    }
    serviceAccount = require(keyPath);
    console.log('✅ Kredensial dimuat dari serviceAccountKey.json (lokal).');
}

// Hindari inisialisasi ulang jika sudah ada instance
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: 'https://safe-93f61-default-rtdb.asia-southeast1.firebasedatabase.app'
    });
}

const db = admin.database();

// ── Helper: Cari UID dari email ──────────────────────────────────────────────
async function getUidByEmail(email) {
    try {
        const userRecord = await admin.auth().getUserByEmail(email);
        return userRecord.uid;
    } catch (e) {
        if (e.code === 'auth/user-not-found') {
            console.error(`❌ Pengguna dengan email "${email}" tidak ditemukan di Firebase Auth.`);
        } else {
            console.error('❌ Error:', e.message);
        }
        return null;
    }
}

// ── Operasi: GRANT admin ─────────────────────────────────────────────────────
async function grantAdmin(email) {
    console.log(`\n🔐 Meng-grant Custom Claim admin kepada: ${email}`);
    const uid = await getUidByEmail(email);
    if (!uid) return;

    await admin.auth().setCustomUserClaims(uid, { admin: true });
    console.log(`✅ BERHASIL: ${email} (UID: ${uid}) sekarang memiliki Custom Claim { admin: true }.`);
    console.log('   ⚠️  User harus logout & login ulang (atau tunggu 1 jam) agar token JWT diperbarui.\n');

    // Opsional: sinkronisasi field 'role' di Realtime Database untuk tampilan UI
    try {
        await db.ref(`users/${uid}`).update({ role: 'admin' });
        console.log(`   📝 Field "role" di Realtime Database juga diperbarui ke "admin" (hanya untuk tampilan UI).`);
    } catch (e) {
        console.warn(`   ⚠️  Gagal update DB (tidak kritis): ${e.message}`);
    }
}

// ── Operasi: REVOKE admin ────────────────────────────────────────────────────
async function revokeAdmin(email) {
    console.log(`\n🔓 Me-revoke Custom Claim admin dari: ${email}`);
    const uid = await getUidByEmail(email);
    if (!uid) return;

    await admin.auth().setCustomUserClaims(uid, { admin: false });
    console.log(`✅ BERHASIL: ${email} (UID: ${uid}) — Custom Claim admin telah dicabut.`);
    console.log('   ⚠️  User harus logout & login ulang (atau tunggu 1 jam) agar token JWT diperbarui.\n');

    // Opsional: sinkronisasi field 'role' di Realtime Database untuk tampilan UI
    try {
        await db.ref(`users/${uid}`).update({ role: 'user' });
        console.log(`   📝 Field "role" di Realtime Database juga diperbarui ke "user" (hanya untuk tampilan UI).`);
    } catch (e) {
        console.warn(`   ⚠️  Gagal update DB (tidak kritis): ${e.message}`);
    }
}

// ── Operasi: LIST semua admin ────────────────────────────────────────────────
async function listAdmins() {
    console.log('\n📋 Mengambil daftar pengguna dari Realtime Database...\n');
    try {
        const snap = await db.ref('users').once('value');
        const users = snap.val();
        if (!users) {
            console.log('   Database users kosong.');
            return;
        }

        // Untuk setiap user di DB, cek Custom Claims via Auth
        const uids = Object.keys(users);
        console.log(`   Total ${uids.length} pengguna ditemukan.\n`);
        console.log('   UID                          | Email                          | DB Role | Claim Admin');
        console.log('   ' + '-'.repeat(85));

        for (const uid of uids) {
            const userData = users[uid];
            try {
                const authUser = await admin.auth().getUser(uid);
                const claims   = authUser.customClaims || {};
                const isAdmin  = claims.admin === true;
                const dbRole   = userData.role || '(none)';
                const email    = authUser.email || '(no email)';
                const flag     = isAdmin ? '✅ YES (ADMIN)' : '— no';
                console.log(`   ${uid.substring(0, 28).padEnd(28)} | ${email.substring(0, 30).padEnd(30)} | ${dbRole.padEnd(7)} | ${flag}`);
            } catch (e) {
                console.log(`   ${uid.substring(0, 28).padEnd(28)} | (error: ${e.message})`);
            }
        }
        console.log('');
    } catch (e) {
        console.error('❌ Gagal ambil data:', e.message);
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const [,, action, email] = process.argv;

    if (!action || action === 'help') {
        console.log(`
╔══════════════════════════════════════════════════════╗
║        SAFE — Admin Custom Claims Manager            ║
╚══════════════════════════════════════════════════════╝

  Perintah:
    node set-admin-claim.js grant  <email>   → Jadikan user sebagai Admin
    node set-admin-claim.js revoke <email>   → Cabut role Admin dari user
    node set-admin-claim.js list             → Lihat semua user & status Admin

  Contoh:
    node set-admin-claim.js grant  reza@example.com
    node set-admin-claim.js revoke reza@example.com
    node set-admin-claim.js list
`);
        process.exit(0);
    }

    if (action === 'list') {
        await listAdmins();
    } else if (action === 'grant') {
        if (!email) { console.error('❌ Harap sertakan email. Contoh: node set-admin-claim.js grant email@example.com'); process.exit(1); }
        await grantAdmin(email);
    } else if (action === 'revoke') {
        if (!email) { console.error('❌ Harap sertakan email. Contoh: node set-admin-claim.js revoke email@example.com'); process.exit(1); }
        await revokeAdmin(email);
    } else {
        console.error(`❌ Perintah tidak dikenal: "${action}". Gunakan: grant, revoke, atau list`);
        process.exit(1);
    }

    process.exit(0);
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
