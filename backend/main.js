// --- EXISTING HEADER LOGIC ---
auth.onAuthStateChanged(async (user) => {
    const profileWrapper = document.getElementById('profile-wrapper');
    const userNav = document.getElementById('user-navbar');
    const adminNav = document.getElementById('admin-navbar');
    
    // View Sections
    const views = document.querySelectorAll('.view-section');
    const viewAuth = document.getElementById('view-auth');
    const viewMonitoring = document.getElementById('view-monitoring');
    const viewDarurat = document.getElementById('view-darurat');
    const viewLapor = document.getElementById('view-lapor');
    const viewSaran = document.getElementById('view-saran');
    const viewAdminDash = document.getElementById('view-admin-dashboard');
    const viewAdminLapor = document.getElementById('view-admin-laporan');
    const viewAdminSaran = document.getElementById('view-admin-saran');
    const viewAdminMembers = document.getElementById('view-admin-members');

    // Sembunyikan SEMUA view dulu agar tidak bertumpukan
    views.forEach(v => v.classList.remove('active'));

    if (user) {
        if (profileWrapper) profileWrapper.style.display = 'flex';
        let snapshot = null;
        if(database) {
            try {
                snapshot = await database.ref('users/' + user.uid).once('value');
            } catch(e) {}
        }
        const userData = snapshot && snapshot.exists() ? snapshot.val() : {};
        const nama = userData.nama || userData.displayName || user.displayName || 'User';
        const headerName = document.getElementById('header-name');
        const headerAvatar = document.getElementById('header-avatar');
        if (headerName) headerName.textContent = nama;
        if (headerAvatar) headerAvatar.textContent = nama.charAt(0).toUpperCase();

        ['user', 'admin'].forEach(role => {
            const sidebarAvatar = document.getElementById(`sidebar-avatar-${role}`);
            const sidebarName   = document.getElementById(`sidebar-name-${role}`);
            if (sidebarAvatar) sidebarAvatar.textContent = nama.charAt(0).toUpperCase();
            if (sidebarName)   sidebarName.textContent   = nama;
        });

        // [SECURITY] Role authority dari Custom Claims (JWT), BUKAN dari database.
        // Nilai 'role' di database hanya untuk tampilan UI, tidak bisa dijadikan otoritas.
        const isAdmin = await checkUserRole(user);

        // Panggil pendaftaran token
        setupFCMToken(user.uid);

        if (isAdmin) {
            if (!viewAdminDash.innerHTML) {
                viewAdminDash.innerHTML = await fetch('views/admin-dashboard.html?v=109').then(r => r.text());
                viewAdminLapor.innerHTML = await fetch('views/admin-laporan.html?v=109').then(r => r.text());
                viewAdminSaran.innerHTML = await fetch('views/admin-saran.html?v=109').then(r => r.text());
                viewAdminMembers.innerHTML = await fetch('views/admin-members.html?v=109').then(r => r.text());
            }
            if (adminNav) adminNav.style.display = 'flex';
            if (userNav) userNav.style.display = 'none';
            document.body.classList.add('admin-view');
            document.body.classList.remove('user-view');
            viewAdminDash.classList.add('active');
            setThemeFabVisible(true);
            bindDOM();
            initChart(true);
            listenAdminData();
            startMembersListener();
            startDataListener(); 
        } else {
            if (!viewMonitoring.innerHTML) {
                viewMonitoring.innerHTML = await fetch('views/monitoring.html?v=109').then(r => r.text());
                viewDarurat.innerHTML = await fetch('views/darurat.html?v=109').then(r => r.text());
                viewLapor.innerHTML = await fetch('views/lapor.html?v=109').then(r => r.text());
                viewSaran.innerHTML = await fetch('views/saran.html?v=109').then(r => r.text());
            }
            if (userNav) userNav.style.display = 'flex';
            if (adminNav) adminNav.style.display = 'none';
            document.body.classList.add('user-view');
            document.body.classList.remove('admin-view');
            viewMonitoring.classList.add('active');
            setThemeFabVisible(true);
            bindDOM();
            initChart(false);
            startDataListener();
        }
    } else {
        if (profileWrapper) profileWrapper.style.display = 'none';
        if (userNav) userNav.style.display = 'none';
        if (adminNav) adminNav.style.display = 'none';
        document.body.classList.remove('admin-view');
        document.body.classList.remove('user-view');
        setThemeFabVisible(false);
        
        // Hide all other views
        document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
        
        if (!viewAuth.innerHTML) {
            viewAuth.innerHTML = await fetch('views/auth.html?v=109').then(r => r.text());
        }
        viewAuth.classList.add('active');
    }
});

async function setupFCMToken(uid) {
    const vapidKey = 'BO45gbDhurKw3FKYmqpiOJ2HaJSK3DYVLG1OF6fUACSKy7DgCdLD9bSRzE4DNNN3OoiURKm1_ykQCEWhYJUr8Zc';
    if (!('Notification' in window)) return;
    
    if ('serviceWorker' in navigator) {
        try {
            // Tunggu sampai Service Worker ada dan AKTIF
            let reg = await navigator.serviceWorker.ready;
            
            // Jika belum aktif, tunggu event statechange
            if (!reg.active) {
                console.log("[SW] Menunggu Service Worker aktif...");
                await new Promise((resolve) => {
                    const sw = reg.installing || reg.waiting;
                    if (sw) {
                        sw.addEventListener('statechange', (e) => {
                            if (e.target.state === 'activated') resolve();
                        });
                    } else {
                        resolve();
                    }
                });
            }

            console.log("[SW] Service Worker sudah aktif. Melanjutkan registrasi token...");
            
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
                                registerToken(uid, vapidKey, reg);
                            }
                        };
                    }
                }
            } else if (Notification.permission === 'granted') {
                registerToken(uid, vapidKey, reg);
            }
        } catch (e) {
            console.error("Gagal inisialisasi SW Notifikasi:", e);
        }
    }
}

async function registerToken(uid, vapidKey, registration) {
    try {
        const messaging = firebase.messaging();
        
        // Pastikan ada Service Worker yang AKTIF
        if (!registration.active) {
            console.log("[SW] Menunggu Service Worker menjadi aktif...");
            await new Promise((resolve) => {
                const sw = registration.installing || registration.waiting;
                if (sw) {
                    sw.addEventListener('statechange', (e) => {
                        if (e.target.state === 'activated') resolve();
                    });
                } else {
                    resolve();
                }
            });
        }

        // Tunggu sebentar lagi untuk sinkronisasi browser
        await new Promise(r => setTimeout(r, 1000));

        try {
            const currentToken = await messaging.getToken({ 
                vapidKey: vapidKey,
                serviceWorkerRegistration: registration 
            });
            
            if (currentToken) {
                if (database) {
                    const tokenKey = btoa(currentToken).substring(0, 32).replace(/[\/\+\=]/g, '_');
                    await database.ref('users/' + uid + '/fcm_tokens/' + tokenKey).set(currentToken);
                    console.log('FCM Token (' + tokenKey + ') berhasil didaftarkan.');
                }
            }
        } catch (err) {
            console.error("Gagal mendapatkan token:", err);
        }
    } catch(err) {
        console.error("Gagal inisialisasi messaging:", err);
    }
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/firebase-messaging-sw.js')
            .then(reg => {
                console.log('SW Reg!', reg);
                // Paksa update jika ada versi baru
                reg.update();
            })
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
