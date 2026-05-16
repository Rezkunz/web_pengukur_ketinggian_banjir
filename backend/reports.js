// Form Submit Handlers
function getGPSLocation() {
    const btn = document.getElementById('btn-gps');
    const input = document.getElementById('lapor-lokasi');
    if (!navigator.geolocation) {
        showCustomModal('SIAGA1', 'Gagal', 'Sistem GPS tidak didukung di browser ini.');
        return;
    }
    
    btn.textContent = '⏳';
    btn.disabled = true;
    
    navigator.geolocation.getCurrentPosition((position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        input.value = `Koordinat Pencarian: ${lat}, ${lon} (via GPS Google Maps)`;
        btn.textContent = '✅ GPS';
        setTimeout(() => { btn.textContent = '📍 GPS'; btn.disabled = false; }, 2000);
    }, (error) => {
        btn.textContent = '📍 GPS';
        btn.disabled = false;
        showCustomModal('SIAGA1', 'GPS Gagal', 'Mohon izinkan akses lokasi (GPS) pada browser/HP Anda.');
    });
}

function submitLapor(e) {
    e.preventDefault();
    if(!auth.currentUser) return;
    
    const nama = document.getElementById('lapor-nama').value;
    const lokasi = document.getElementById('lapor-lokasi').value;
    const tingkat = document.getElementById('lapor-tingkat').value;
    
    if (database) {
        database.ref('laporan').push({
            uid: auth.currentUser.uid,
            nama: nama,
            lokasi: lokasi,
            tingkat: tingkat,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        }).catch(err => console.error(err));
    }
    showSuccessModal('Success', 'Laporan berhasil dikirim, terima kasih!');
    e.target.reset();
}

function submitSaran(e) {
    e.preventDefault();
    if(!auth.currentUser) return;
    
    const email = document.getElementById('saran-email').value;
    const pesan = document.getElementById('saran-pesan').value;
    
    if (database) {
        database.ref('saran').push({
            uid: auth.currentUser.uid,
            email: email,
            pesan: pesan,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        }).catch(err => console.error(err));
    }
    
    showSuccessModal('Success', 'Saran dan masukan Anda berhasil dikirim!');
    e.target.reset();
}

// ADMIN DASHBOARD LOGICS
function listenAdminData() {
    if(!database) return;

    // 1. Listen to TOTAL USERS
    database.ref('users').on('value', snap => {
        const totalUserEl = document.getElementById('stat-total-pengguna');
        if(totalUserEl) totalUserEl.textContent = snap.numChildren();
    });

    // 2. Listen to Laporan count
    database.ref('laporan').on('value', snap => {
        const adminLapor = document.getElementById('admin-laporan-list');
        const adminTotalLaporanLegacy = document.getElementById('admin-total-laporan');
        const statTotalLaporan = document.getElementById('stat-total-laporan');
        
        if(adminLapor) adminLapor.innerHTML = '';
        
        let count = 0;
        snap.forEach(child => {
            count++;
            const data = child.val();
            const date = new Date(data.timestamp || Date.now());
            
            // Determine badge color based on tingkat
            let badgeColor = '#3498db'; // default biru
            let tk = data.tingkat ? data.tingkat.toLowerCase() : '';
            if(tk.includes('siaga 2') || tk.includes('bahaya') || tk.includes('parah')) badgeColor = '#ef4444'; // merah
            else if(tk.includes('siaga 1') || tk.includes('waspada')) badgeColor = '#f59e0b'; // kuning/orange
            
            if(adminLapor) {
                adminLapor.innerHTML = `
                <div class="admin-report-card" style="border-left: 6px solid ${badgeColor};">
                    <div class="admin-report-header">
                        <h4 class="admin-report-title">
                            <span class="admin-report-name">👤 ${data.nama || 'Anonim'}</span>
                        </h4>
                        <span class="admin-report-time">🕒 ${date.toLocaleString('id-ID')}</span>
                    </div>
                    <div class="admin-report-body">
                        <p class="admin-report-detail"><strong>📍 Lokasi:</strong> <span>${data.lokasi || '-'}</span></p>
                        <p class="admin-report-detail" style="display: flex; align-items: center; gap: 5px;">
                            <strong>🌊 Tingkat:</strong> 
                            <span style="background: ${badgeColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem; font-weight: bold;">${data.tingkat || '-'}</span>
                        </p>
                    </div>
                </div>
                ` + adminLapor.innerHTML;
            }
        });
        
        if(adminTotalLaporanLegacy) adminTotalLaporanLegacy.textContent = count;
        if(statTotalLaporan) statTotalLaporan.textContent = count;
        if(count === 0 && adminLapor) adminLapor.innerHTML = '<div class="admin-empty-state">Belum ada laporan genangan masuk.</div>';
    });
    
    // 3. Listen to Saran
    database.ref('saran').on('value', snap => {
        const adminSaran = document.getElementById('admin-saran-list');
        const statTotalSaran = document.getElementById('stat-total-saran');

        if(adminSaran) adminSaran.innerHTML = '';
        
        let count = 0;
        snap.forEach(child => {
            count++;
            const data = child.val();
            const date = new Date(data.timestamp || Date.now());
            
            if(adminSaran) {
                adminSaran.innerHTML = `
                <div class="admin-saran-card">
                    <div class="admin-saran-header">
                        <h4 class="admin-saran-email">✉️ ${data.email || 'Pengguna Anonim'}</h4>
                        <span class="admin-saran-time">${date.toLocaleDateString('id-ID')} ${date.toLocaleTimeString('id-ID')}</span>
                    </div>
                    <p class="admin-saran-pesan">"${data.pesan}"</p>
                </div>
                ` + adminSaran.innerHTML;
            }
        });
        
        if(statTotalSaran) statTotalSaran.textContent = count;
        if(count === 0 && adminSaran) adminSaran.innerHTML = '<div class="admin-empty-state">Belum ada saran atau feedback.</div>';
    });
}
