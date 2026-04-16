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

        const userNav = document.getElementById('user-navbar');
        const adminNav = document.getElementById('admin-navbar');
        const profileWrapper = document.getElementById('profile-wrapper');

        const statusEl = document.getElementById('connection-status');
        if (statusEl) statusEl.style.display = 'none';

        document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));

        if (user) {
            profileWrapper.style.display = 'flex';
            
            let snapshot = null;
            if(database) {
                try {
                    snapshot = await database.ref('users/' + user.uid).once('value');
                } catch(e) {}
            }
            
            const userData = snapshot && snapshot.exists() ? snapshot.val() : { nama: 'User', role: 'user' };
            
            document.getElementById('header-name').textContent = userData.nama;
            document.getElementById('header-avatar').textContent = userData.nama.charAt(0).toUpperCase();

            // Sync ke sidebar profile (desktop)
            const initial = userData.nama.charAt(0).toUpperCase();
            ['user', 'admin'].forEach(role => {
                const sidebarAvatar = document.getElementById(`sidebar-avatar-${role}`);
                const sidebarName   = document.getElementById(`sidebar-name-${role}`);
                if (sidebarAvatar) sidebarAvatar.textContent = initial;
                if (sidebarName)   sidebarName.textContent   = userData.nama;
            });

            // Admin Setup (One off)
            if (user.email === 'rezads@gmail.com' && userData.role !== 'admin') {
                 if(database) {
                     await database.ref('users/' + user.uid).set({
                         nama: 'Admin Reza',
                         email: 'rezads@gmail.com',
                         role: 'admin'
                     });
                     userData.role = 'admin';
                 }
            }

            if (userData.role === 'admin') {
                if (!viewAdminDash.innerHTML) {
                    viewAdminDash.innerHTML = await fetch('views/admin-dashboard.html?v=16').then(r => r.text());
                    viewAdminLapor.innerHTML = await fetch('views/admin-laporan.html?v=16').then(r => r.text());
                    viewAdminSaran.innerHTML = await fetch('views/admin-saran.html?v=16').then(r => r.text());
                }
                adminNav.style.display = 'flex';
                userNav.style.display = 'none';
                viewAdminDash.classList.add('active');
                
                bindDOM();
                initChart(true);
                listenAdminData();
                startDataListener(); // Will attach UI update functions properly to admin elements if mapped
            } else {
                if (!viewMonitoring.innerHTML) {
                    viewMonitoring.innerHTML = await fetch('views/monitoring.html?v=16').then(r => r.text());
                    viewDarurat.innerHTML = await fetch('views/darurat.html?v=16').then(r => r.text());
                    viewLapor.innerHTML = await fetch('views/lapor.html?v=16').then(r => r.text());
                    viewSaran.innerHTML = await fetch('views/saran.html?v=16').then(r => r.text());
                }
                userNav.style.display = 'flex';
                adminNav.style.display = 'none';
                viewMonitoring.classList.add('active');

                bindDOM();
                initChart();
                startDataListener();
            }
        } else {
            profileWrapper.style.display = 'none';
            userNav.style.display = 'none';
            adminNav.style.display = 'none';
            if (!viewAuth.innerHTML) {
                viewAuth.innerHTML = await fetch('views/auth.html?v=15').then(r => r.text());
            }
            viewAuth.classList.add('active');
        }
    });
});
