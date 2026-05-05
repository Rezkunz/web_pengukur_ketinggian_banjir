// Initialization and Auth Routing
document.addEventListener('DOMContentLoaded', async () => {
    if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }

    auth.onAuthStateChanged(async (user) => {
        const viewAuth = document.getElementById('view-auth');
        const viewMonitoring = document.getElementById('view-monitoring');
        const viewDarurat = document.getElementById('view-darurat');
        const viewLapor = document.getElementById('view-lapor');
        const viewSaran = document.getElementById('view-saran');
        
        const viewAdminDash = document.getElementById('view-admin-dashboard');
        const viewAdminLapor = document.getElementById('view-admin-laporan');
        const viewAdminSaran = document.getElementById('view-admin-saran');
        const viewAdminMembers = document.getElementById('view-admin-members');

        const userNav = document.getElementById('user-navbar');
        const adminNav = document.getElementById('admin-navbar');
        const profileWrapper = document.getElementById('profile-wrapper');

        const statusEl = document.getElementById('connection-status');
        if (statusEl) statusEl.style.display = 'none';

        document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));

        if (user) {
            if (profileWrapper) profileWrapper.style.display = 'flex';
            
            let snapshot = null;
            if(database) {
                try {
                    snapshot = await database.ref('users/' + user.uid).once('value');
                } catch(e) {}
            }
            
            const userData = snapshot && snapshot.exists() ? snapshot.val() : { nama: 'User', role: 'user' };
            
            const headerName = document.getElementById('header-name');
            const headerAvatar = document.getElementById('header-avatar');
            if (headerName) headerName.textContent = userData.nama;
            if (headerAvatar) headerAvatar.textContent = userData.nama.charAt(0).toUpperCase();

            // Sync ke sidebar profile (desktop)
            const initial = userData.nama.charAt(0).toUpperCase();
            ['user', 'admin'].forEach(role => {
                const sidebarAvatar = document.getElementById(`sidebar-avatar-${role}`);
                const sidebarName   = document.getElementById(`sidebar-name-${role}`);
                if (sidebarAvatar) sidebarAvatar.textContent = initial;
                if (sidebarName)   sidebarName.textContent   = userData.nama;
            });

            // Admin Setup (One off fallback)
            if ((user.email === 'rezads@gmail.com' || user.email === 'admin@safe.net') && userData.role !== 'admin') {
                 if(database) {
                     await database.ref('users/' + user.uid).set({
                         nama: user.email === 'admin@safe.net' ? 'Administrator' : 'Admin Reza',
                         email: user.email,
                         role: 'admin'
                     });
                     userData.role = 'admin';
                 }
            }

            // -- PUSH NOTIFICATION (FCM) SETUP --
            setupFCMToken(user.uid);

            if (userData.role === 'admin') {
                if (!viewAdminDash.innerHTML) {
                    viewAdminDash.innerHTML = await fetch('views/admin-dashboard.html?v=54').then(r => r.text());
                    viewAdminLapor.innerHTML = await fetch('views/admin-laporan.html?v=54').then(r => r.text());
                    viewAdminSaran.innerHTML = await fetch('views/admin-saran.html?v=54').then(r => r.text());
                    viewAdminMembers.innerHTML = await fetch('views/admin-members.html?v=54').then(r => r.text());
                }
                adminNav.style.display = 'flex';
                userNav.style.display = 'none';
                document.body.classList.add('admin-view');
                document.body.classList.remove('user-view');
                viewAdminDash.classList.add('active');
                
                bindDOM();
                // initStats(); // Removed: handled by listenAdminData
                initChart(true);
                listenAdminData();
                startMembersListener();
                startDataListener(); 
                
                // Update UI status notif setelah view dimuat
                setTimeout(() => {
                    if ('Notification' in window) updateNotificationStatusUI(Notification.permission);
                }, 500);
            } else {
                if (!viewMonitoring.innerHTML) {
                    viewMonitoring.innerHTML = await fetch('views/monitoring.html?v=54').then(r => r.text());
                    viewDarurat.innerHTML = await fetch('views/darurat.html?v=54').then(r => r.text());
                    viewLapor.innerHTML = await fetch('views/lapor.html?v=54').then(r => r.text());
                    viewSaran.innerHTML = await fetch('views/saran.html?v=54').then(r => r.text());
                }
                userNav.style.display = 'flex';
                adminNav.style.display = 'none';
                document.body.classList.add('user-view');
                document.body.classList.remove('admin-view');
                viewMonitoring.classList.add('active');

                bindDOM();
                initChart(false);
                startDataListener();

                // Update UI status notif setelah view dimuat
                setTimeout(() => {
                    if ('Notification' in window) updateNotificationStatusUI(Notification.permission);
                }, 500);
            }
        } else {
            if (profileWrapper) profileWrapper.style.display = 'none';
            if (userNav) userNav.style.display = 'none';
            if (adminNav) adminNav.style.display = 'none';
            document.body.classList.remove('admin-view');
            document.body.classList.remove('user-view');
            if (!viewAuth.innerHTML) {
                viewAuth.innerHTML = await fetch('views/auth.html?v=54').then(r => r.text());
            }
            viewAuth.classList.add('active');
        }

        // Sembunyikan global loader jika ada
        const globalLoader = document.getElementById('global-loader');
        if (globalLoader) {
            globalLoader.style.opacity = '0';
            globalLoader.style.visibility = 'hidden';
            setTimeout(() => {
                globalLoader.style.display = 'none';
            }, 500);
        }
    });
});

// Menutup FCM Modal
window.closeFCMPermissionModal = function() {
    const modal = document.getElementById('fcm-permission-modal');
    if (modal) modal.classList.remove('show');
}

// Fungsi untuk meminta izin dan menyimpan Token FCM ke Database
async function setupFCMToken(uid) {
    try {
        if (!('Notification' in window)) {
            console.warn("Browser ini tidak mendukung notifikasi.");
            return;
        }
        
        console.log("Status Izin Notifikasi saat ini:", Notification.permission);
        
        // PENTING: Ganti dengan Public VAPID Key dari Firebase Console Anda!
        const vapidKey = "Wm4URg04btDDfqM_iEkAxE_PnynyJLVCzcd5dhOoFO0"; 
        
        // Jika belum ditanya, tampilkan Custom Modal cantik
        if (Notification.permission === 'default') {
            const fcmModal = document.getElementById('fcm-permission-modal');
            const btnAllow = document.getElementById('btn-fcm-allow');
            
            if (fcmModal && btnAllow) {
                // Tampilkan custom popup
                fcmModal.classList.add('show'); 
                
                // Hapus listener lama jika ada (mencegah double trigger)
                const newBtnAllow = btnAllow.cloneNode(true);
                btnAllow.parentNode.replaceChild(newBtnAllow, btnAllow);
                
                newBtnAllow.addEventListener('click', async () => {
                    closeFCMPermissionModal();
                    // SEKARANG baru minta prompt asli browser
                    const permission = await Notification.requestPermission();
                    if (permission === 'granted') {
                        await registerToken(uid, vapidKey);
                    } else {
                        console.log("User menolak izin notifikasi di prompt browser.");
                    }
                });
            } else {
                console.error("Elemen modal FCM tidak ditemukan di HTML!");
            }
        } 
        // Jika sudah diizinkan sebelumnya, langsung daftarkan
        else if (Notification.permission === 'granted') {
            await registerToken(uid, vapidKey);
        }

    } catch (error) {
        console.error('Error saat mengatur FCM Token:', error);
    }
}

async function registerToken(uid, vapidKey) {
    console.log('Izin notifikasi FCM diberikan. Mengambil token...');
    try {
        const messaging = firebase.messaging();
        const currentToken = await messaging.getToken({ vapidKey: vapidKey });
        if (currentToken) {
            if (database) {
                // Gunakan hash pendek dari token sebagai key agar tidak konflik dan valid di Firebase
                const tokenKey = btoa(currentToken).substring(0, 32).replace(/[\/\+\=]/g, '_');
                await database.ref('users/' + uid + '/fcm_tokens/' + tokenKey).set(currentToken);
                console.log('FCM Token (' + tokenKey + ') berhasil disimpan ke list tokens.');
                
                // Update UI status jika ada
                updateNotificationStatusUI('granted');
            }
        } else {
            console.log('Gagal mendapatkan token FCM.');
        }

        messaging.onTokenRefresh(async () => {
            const refreshedToken = await messaging.getToken({ vapidKey: vapidKey });
            if (refreshedToken && database) {
                const tokenKey = btoa(refreshedToken).substring(0, 32).replace(/[\/\+\=]/g, '_');
                await database.ref('users/' + uid + '/fcm_tokens/' + tokenKey).set(refreshedToken);
            }
        });
        
        messaging.onMessage((payload) => {
            console.log("Pesan masuk (Foreground): ", payload);
            if(typeof sendNotification === 'function' && payload.notification) {
                sendNotification(payload.notification.title, { body: payload.notification.body });
            }
        });
    } catch(err) {
        console.error("Gagal register token:", err);
    }
}

// --- REGISTRASI SERVICE WORKER UNTUK PWA ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/firebase-messaging-sw.js')
            .then(reg => console.log('Service Worker Registered!', reg))
            .catch(err => console.error('Service Worker Registration Failed', err));
    });
}

// --- LOGIKA PWA INSTALL BANNER ---
let deferredPrompt;
const pwaBanner = document.getElementById('pwa-install-banner');
const btnInstallPwa = document.getElementById('btn-pwa-install');

window.addEventListener('beforeinstallprompt', (e) => {
    // Mencegah Chrome memunculkan infobar standar dari bawah
    e.preventDefault();
    deferredPrompt = e;
    
    // Tampilkan banner custom kita
    if (pwaBanner) {
        setTimeout(() => pwaBanner.classList.add('show'), 2000); // Muncul setelah 2 detik
    }
});

if (btnInstallPwa) {
    btnInstallPwa.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        
        // Sembunyikan banner custom
        pwaBanner.classList.remove('show');
        
        // Tampilkan prompt install bawaan HP (Native Install Prompt)
        deferredPrompt.prompt();
        
        // Tunggu respon pengguna
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`PWA install prompt outcome: ${outcome}`);
        
        deferredPrompt = null;
    });
}

window.closePWAInstallBanner = function() {
    if (pwaBanner) pwaBanner.classList.remove('show');
}

// --- LOGIKA STATUS NOTIFIKASI DASHBOARD ---
function updateNotificationStatusUI(permission) {
    const statusBoxes = document.querySelectorAll('.notif-status-card');
    
    statusBoxes.forEach(box => {
        const text = box.querySelector('h4');
        const icon = box.querySelector('span');
        const btn = box.querySelector('button');

        if (permission === 'granted') {
            box.className = 'notif-status-card success';
            if (text) text.textContent = 'Notifikasi Aktif';
            if (icon) icon.innerHTML = '🔔';
            if (btn) btn.style.display = 'none';
        } else if (permission === 'denied') {
            box.className = 'notif-status-card danger';
            if (text) text.textContent = 'Notifikasi Diblokir';
            if (icon) icon.innerHTML = '🚫';
            if (btn) {
                btn.style.display = 'block';
                btn.textContent = 'Cara Buka Blokir';
                btn.onclick = () => showNotifHelp('denied');
            }
        } else {
            box.className = 'notif-status-card warning';
            if (text) text.textContent = 'Notifikasi Belum Aktif';
            if (icon) icon.innerHTML = '⚠️';
            if (btn) {
                btn.style.display = 'block';
                btn.textContent = 'Aktifkan Sekarang';
                btn.onclick = () => {
                    if (window.setupFCMToken && auth.currentUser) {
                        window.setupFCMToken(auth.currentUser.uid);
                    }
                };
            }
        }
    });
}

// Pantau perubahan izin secara berkala (karena browser tidak punya event listener untuk ini)
setInterval(() => {
    if ('Notification' in window) {
        updateNotificationStatusUI(Notification.permission);
    }
}, 3000);

function showNotifHelp(type) {
    // Deteksi Device
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isAndroid = /Android/.test(navigator.userAgent);
    
    let helpTitle = "Cara Mengaktifkan Notifikasi";
    let helpDesc = "Ikuti langkah di bawah ini:";
    
    if (isIOS) {
        helpTitle = "Panduan iPhone (iOS)";
        helpDesc = "1. Klik tombol **Share** (kotak panah atas) di Safari.<br>2. Pilih **'Add to Home Screen'**.<br>3. Buka aplikasi SAFE dari layar utama.<br>4. Klik 'Izinkan' di dalam aplikasi.";
    } else if (isAndroid && type === 'denied') {
        helpTitle = "Buka Blokir Android";
        helpDesc = "1. Klik ikon **Gembok/Settings** di baris alamat browser.<br>2. Pilih **Site Settings**.<br>3. Cari **Notifications** dan pilih **Allow/Izinkan**.<br>4. Refresh halaman.";
    } else if (type === 'denied') {
        helpTitle = "Buka Blokir Browser";
        helpDesc = "1. Klik ikon Gembok di sebelah URL.<br>2. Ubah Notifikasi menjadi **Allow**.<br>3. Muat ulang halaman.";
    }

    // Gunakan Success Modal sebagai template bantuan sementara atau buat modal baru
    if (typeof showSuccessModal === 'function') {
        showSuccessModal(helpTitle, helpDesc.replace(/<br>/g, '\n'));
    }
}
