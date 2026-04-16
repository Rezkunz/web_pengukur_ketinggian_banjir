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
            if(tk.includes('tinggi') || tk.includes('siaga 1') || tk.includes('parah')) badgeColor = '#e74c3c'; // merah
            else if(tk.includes('sedang') || tk.includes('siaga 2')) badgeColor = '#f39c12'; // kuning
            
            if(adminLapor) {
                adminLapor.innerHTML = `
                <div style="background: rgba(255,255,255,0.85); padding: 20px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); margin-bottom: 15px; display: flex; flex-direction: column; gap: 10px; border-left: 6px solid ${badgeColor}; transition: transform 0.2s;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <h4 style="margin: 0; color: #2c3e50; font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                            <span style="background: #ecf0f1; padding: 5px 10px; border-radius: 20px; font-size: 0.8rem; color: #7f8c8d;">👤 ${data.nama || 'Anonim'}</span>
                        </h4>
                        <span style="font-size: 0.75rem; color: #95a5a6; background: #f8f9fa; padding: 4px 8px; border-radius: 6px;">🕒 ${date.toLocaleString('id-ID')}</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 5px; margin-top: 5px;">
                        <p style="margin: 0; color: #34495e; font-size: 0.95rem;"><strong>📍 Lokasi:</strong> <span style="color: #555;">${data.lokasi || '-'}</span></p>
                        <p style="margin: 0; color: #34495e; font-size: 0.95rem; display: flex; align-items: center; gap: 5px;">
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
        if(count === 0 && adminLapor) adminLapor.innerHTML = '<div style="text-align:center; color:#95a5a6; padding:30px; background: rgba(255,255,255,0.5); border-radius: 15px; border: 2px dashed #bdc3c7;">Belum ada laporan genangan masuk.</div>';
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
                <div style="background: rgba(255,255,255,0.85); padding: 20px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); margin-bottom: 15px; border-left: 6px solid #2ecc71; transition: transform 0.2s;">
                    <div style="display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid #ecf0f1; padding-bottom: 10px; margin-bottom: 10px;">
                        <h4 style="margin: 0; color: #2c3e50; font-size: 1rem; word-break: break-all; line-height: 1.4;">✉️ ${data.email || 'Pengguna Anonim'}</h4>
                        <span style="font-size: 0.75rem; color: #95a5a6;">${date.toLocaleDateString('id-ID')} ${date.toLocaleTimeString('id-ID')}</span>
                    </div>
                    <p style="margin: 0; color: #555; font-size: 0.95rem; line-height: 1.5; font-style: italic; word-break: break-word;">"${data.pesan}"</p>
                </div>
                ` + adminSaran.innerHTML;
            }
        });
        
        if(statTotalSaran) statTotalSaran.textContent = count;
        if(count === 0 && adminSaran) adminSaran.innerHTML = '<div style="text-align:center; color:#95a5a6; padding:30px; background: rgba(255,255,255,0.5); border-radius: 15px; border: 2px dashed #bdc3c7;">Belum ada saran atau feedback.</div>';
    });
}
