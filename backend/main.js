// --- EXISTING HEADER LOGIC ---
auth.onAuthStateChanged(async (user) => {
    const profileWrapper = document.getElementById('profile-wrapper');
    const userNav = document.getElementById('user-navbar');
    const adminNav = document.getElementById('admin-navbar');
    const viewMonitoring = document.getElementById('view-monitoring');
    const viewDarurat = document.getElementById('view-darurat');
    const viewLapor = document.getElementById('view-lapor');
    const viewSaran = document.getElementById('view-saran');
    const viewAuth = document.getElementById('view-auth');
    const viewAdminDash = document.getElementById('view-admin-dashboard');
    const viewAdminLapor = document.getElementById('view-admin-laporan');
    const viewAdminSaran = document.getElementById('view-admin-saran');
    const viewAdminMembers = document.getElementById('view-admin-members');

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

        ['user', 'admin'].forEach(role => {
            const sidebarAvatar = document.getElementById(`sidebar-avatar-${role}`);
            const sidebarName   = document.getElementById(`sidebar-name-${role}`);
            if (sidebarAvatar) sidebarAvatar.textContent = userData.nama.charAt(0).toUpperCase();
            if (sidebarName)   sidebarName.textContent   = userData.nama;
        });

        setupFCMToken(user.uid);

        if (userData.role === 'admin') {
            if (!viewAdminDash.innerHTML) {
                viewAdminDash.innerHTML = await fetch('views/admin-dashboard.html?v=58').then(r => r.text());
                viewAdminLapor.innerHTML = await fetch('views/admin-laporan.html?v=58').then(r => r.text());
                viewAdminSaran.innerHTML = await fetch('views/admin-saran.html?v=58').then(r => r.text());
                viewAdminMembers.innerHTML = await fetch('views/admin-members.html?v=58').then(r => r.text());
            }
            adminNav.style.display = 'flex';
            userNav.style.display = 'none';
            document.body.classList.add('admin-view');
            document.body.classList.remove('user-view');
            viewAdminDash.classList.add('active');
            bindDOM();
            initChart(true);
            listenAdminData();
            startMembersListener();
            startDataListener(); 
            setTimeout(() => {
                if ('Notification' in window) updateNotificationStatusUI(Notification.permission);
            }, 500);
        } else {
            if (!viewMonitoring.innerHTML) {
                viewMonitoring.innerHTML = await fetch('views/monitoring.html?v=58').then(r => r.text());
                viewDarurat.innerHTML = await fetch('views/darurat.html?v=58').then(r => r.text());
                viewLapor.innerHTML = await fetch('views/lapor.html?v=58').then(r => r.text());
                viewSaran.innerHTML = await fetch('views/saran.html?v=58').then(r => r.text());
            }
            userNav.style.display = 'flex';
            adminNav.style.display = 'none';
            document.body.classList.add('user-view');
            document.body.classList.remove('admin-view');
            viewMonitoring.classList.add('active');
            bindDOM();
            initChart(false);
            startDataListener();
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
            viewAuth.innerHTML = await fetch('views/auth.html?v=58').then(r => r.text());
        }
        viewAuth.classList.add('active');
    }
});

async function setupFCMToken(uid) {
    const vapidKey = 'Wm4URg04btDDfqM_iEkAxE_PnynyJLVCzcd5dhOoFO0';
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        const modal = document.getElementById('fcm-permission-modal');
        const btnAllow = document.getElementById('btn-fcm-allow');
        if (modal) {
            modal.classList.add('show');
            if (btnAllow) {
                btnAllow.onclick = async () => {
                    const permission = await Notification.requestPermission();
                    modal.classList.remove('show');
                    if (permission === 'granted') {
                        registerToken(uid, vapidKey);
                    }
                };
            }
        }
    } else if (Notification.permission === 'granted') {
        registerToken(uid, vapidKey);
    }
}

async function registerToken(uid, vapidKey) {
    try {
        const messaging = firebase.messaging();
        const currentToken = await messaging.getToken({ vapidKey: vapidKey });
        if (currentToken) {
            if (database) {
                const tokenKey = btoa(currentToken).substring(0, 32).replace(/[\/\+\=]/g, '_');
                await database.ref('users/' + uid + '/fcm_tokens/' + tokenKey).set(currentToken);
                updateNotificationStatusUI('granted');
            }
        }
        messaging.onTokenRefresh(async () => {
            const refreshedToken = await messaging.getToken({ vapidKey: vapidKey });
            if (refreshedToken && database) {
                const tokenKey = btoa(refreshedToken).substring(0, 32).replace(/[\/\+\=]/g, '_');
                await database.ref('users/' + uid + '/fcm_tokens/' + tokenKey).set(refreshedToken);
            }
        });
        messaging.onMessage((payload) => {
            if(typeof sendNotification === 'function' && payload.notification) {
                sendNotification(payload.notification.title, { body: payload.notification.body });
            }
        });
    } catch(err) {
        console.error("Gagal register token:", err);
    }
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/firebase-messaging-sw.js')
            .then(reg => console.log('SW Reg!', reg))
            .catch(err => console.error('SW Fail', err));
    });
}

let deferredPrompt;
const pwaBanner = document.getElementById('pwa-install-banner');
const btnInstallPwa = document.getElementById('btn-pwa-install');
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (pwaBanner) setTimeout(() => pwaBanner.classList.add('show'), 2000);
});
if (btnInstallPwa) {
    btnInstallPwa.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        pwaBanner.classList.remove('show');
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
    });
}
window.closePWAInstallBanner = function() {
    if (pwaBanner) pwaBanner.classList.remove('show');
}

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

setInterval(() => {
    if ('Notification' in window) updateNotificationStatusUI(Notification.permission);
}, 5000);

function showNotifHelp(type) {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isAndroid = /Android/.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

    if (isIOS && !isStandalone) {
        const overlay = document.getElementById('ios-onboarding');
        if (overlay) overlay.style.display = 'flex';
        return;
    }
    
    let helpTitle = "Cara Mengaktifkan Notifikasi";
    let helpDesc = "Ikuti langkah di bawah ini:";
    if (isIOS) {
        helpTitle = "Panduan iPhone (iOS)";
        helpDesc = "1. Anda sudah menginstall aplikasi.\n2. Klik tombol 'Izinkan' di dalam aplikasi ini.\n3. Pastikan Settings -> Notifications -> SAFE sudah On.";
    } else if (isAndroid && type === 'denied') {
        helpTitle = "Buka Blokir Android";
        helpDesc = "1. Klik ikon Gembok di baris alamat.\n2. Pilih Site Settings.\n3. Pilih Notifications -> Allow.";
    } else if (type === 'denied') {
        helpTitle = "Buka Blokir Browser";
        helpDesc = "1. Klik ikon Gembok di sebelah URL.\n2. Ubah Notifikasi menjadi Allow.";
    }
    if (typeof showSuccessModal === 'function') {
        showSuccessModal(helpTitle, helpDesc);
    }
}

window.closeIOSOnboarding = function() {
    const overlay = document.getElementById('ios-onboarding');
    if (overlay) overlay.style.display = 'none';
}

window.addEventListener('load', () => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (isIOS && !isStandalone) {
        setTimeout(() => {
            const overlay = document.getElementById('ios-onboarding');
            if (overlay) overlay.style.display = 'flex';
        }, 3000);
    }
});

// --- WHATSAPP LOGIC ---
async function saveWaNumber() {
    if (!auth.currentUser) return;
    const input = document.getElementById('wa-number-input');
    const statusText = document.getElementById('wa-status-text');
    let number = input.value.trim();

    if (!number) {
        if (statusText) statusText.textContent = "Masukkan nomor WA yang valid.";
        return;
    }

    // Bersihkan nomor (hilangkan +, spasi, dll)
    number = number.replace(/[^0-9]/g, '');
    
    // Pastikan format Indonesia (08... -> 628...)
    if (number.startsWith('08')) {
        number = '628' + number.substring(1);
    }

    try {
        await database.ref('users/' + auth.currentUser.uid + '/wa_number').set(number);
        if (statusText) {
            statusText.textContent = "Nomor berhasil disimpan! (Format: " + number + ")";
            statusText.classList.add('success');
        }
        if (typeof showSuccessModal === 'function') {
            showSuccessModal("WhatsApp Berhasil", "Nomor Anda telah terdaftar untuk menerima alarm.");
        }
    } catch (e) {
        console.error(e);
        if (statusText) statusText.textContent = "Gagal menyimpan nomor.";
    }
}

async function loadWaNumber(uid) {
    const input = document.getElementById('wa-number-input');
    const statusText = document.getElementById('wa-status-text');
    if (!input) return;

    try {
        const snap = await database.ref('users/' + uid + '/wa_number').once('value');
        if (snap.exists()) {
            input.value = snap.val();
            if (statusText) {
                statusText.textContent = "Nomor terdaftar: " + snap.val();
                statusText.classList.add('success');
            }
        }
    } catch (e) {}
}

// Panggil loadWaNumber saat login
auth.onAuthStateChanged((user) => {
    if (user) {
        setTimeout(() => loadWaNumber(user.uid), 1000);
    }
});
