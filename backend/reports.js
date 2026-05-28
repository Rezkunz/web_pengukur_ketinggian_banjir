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

// --- UTILITAS KOMPRESI GAMBAR ---
function compressImage(file, maxWidth = 800) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scaleSize = Math.min(1, maxWidth / img.width);
                canvas.width = img.width * scaleSize;
                canvas.height = img.height * scaleSize;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.7)); // Kompres ke JPEG 70%
            };
            img.onerror = err => reject(err);
        };
        reader.onerror = err => reject(err);
    });
}

// Event Listener untuk Preview Foto
document.addEventListener('DOMContentLoaded', () => {
    const laporFoto = document.getElementById('lapor-foto');
    if (laporFoto) {
        laporFoto.addEventListener('change', function() {
            const stateEmpty = document.getElementById('upload-state-empty');
            const stateFilled = document.getElementById('upload-state-filled');
            const preview = document.getElementById('lapor-foto-preview');
            const fileNameSpan = document.getElementById('lapor-foto-name');
            const uploadBox = document.getElementById('upload-box');
            
            if (this.files && this.files[0]) {
                const file = this.files[0];
                const reader = new FileReader();
                reader.onload = function(e) {
                    preview.src = e.target.result;
                    if(stateEmpty) stateEmpty.style.display = 'none';
                    if(stateFilled) stateFilled.style.display = 'flex';
                    if(uploadBox) {
                        uploadBox.style.padding = '20px';
                        uploadBox.style.borderStyle = 'solid';
                    }
                    if(fileNameSpan) fileNameSpan.textContent = file.name || "foto_kamera.jpg";
                }
                reader.readAsDataURL(file);
            } else {
                if(stateEmpty) stateEmpty.style.display = 'flex';
                if(stateFilled) stateFilled.style.display = 'none';
                if(preview) preview.src = '';
                if(uploadBox) {
                    uploadBox.style.padding = '30px 20px';
                    uploadBox.style.borderStyle = 'dashed';
                }
            }
        });
    }
});

function submitLapor(e) {
    e.preventDefault();
    if(!auth.currentUser) return;
    
    // --- RATE LIMITING LOGIC ---
    const RATE_LIMIT_HOURS = 1;
    const MAX_REPORTS = 3;
    const now = Date.now();
    let userReports = JSON.parse(localStorage.getItem('user_reports_log') || '[]');
    
    // Clean up old logs (older than 1 hour)
    userReports = userReports.filter(time => now - time < RATE_LIMIT_HOURS * 3600000);
    
    if (userReports.length >= MAX_REPORTS) {
        showCustomModal('SIAGA2', 'Terlalu Banyak Laporan', 'Anda telah mencapai batas maksimal (3 laporan per jam). Silakan coba lagi nanti untuk mencegah spam.');
        return;
    }
    
    const form = e.target;
    const btnSubmit = form.querySelector('button[type="submit"]');
    const originalBtnText = btnSubmit ? btnSubmit.textContent : '';
    
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.textContent = 'Memproses...';
    }
    
    const nama = document.getElementById('lapor-nama').value;
    const lokasi = document.getElementById('lapor-lokasi').value;
    const tingkat = document.getElementById('lapor-tingkat').value;
    const fotoInput = document.getElementById('lapor-foto');
    
    const processSubmit = async () => {
        try {
            // 1. Ambil & Kompres Foto
            let base64Foto = null;
            if (fotoInput && fotoInput.files && fotoInput.files[0]) {
                base64Foto = await compressImage(fotoInput.files[0]);
            }
            
            if (btnSubmit) btnSubmit.textContent = 'Mengirim...';
            
            // 2. Simpan ke Firebase
            if (database) {
                await database.ref('laporan').push({
                    uid: auth.currentUser.uid,
                    nama: nama,
                    lokasi: lokasi,
                    tingkat: tingkat,
                    foto: base64Foto,
                    timestamp: firebase.database.ServerValue.TIMESTAMP
                });
                
                // 3. Catat waktu untuk rate limiting
                userReports.push(now);
                localStorage.setItem('user_reports_log', JSON.stringify(userReports));
                
                showSuccessModal('Success', 'Laporan berhasil dikirim, terima kasih!');
                form.reset();
                
                // Reset Preview UI
                const stateEmpty = document.getElementById('upload-state-empty');
                const stateFilled = document.getElementById('upload-state-filled');
                const preview = document.getElementById('lapor-foto-preview');
                const uploadBox = document.getElementById('upload-box');
                
                if(stateEmpty) stateEmpty.style.display = 'flex';
                if(stateFilled) stateFilled.style.display = 'none';
                if(preview) preview.src = '';
                if(uploadBox) {
                    uploadBox.style.padding = '30px 20px';
                    uploadBox.style.borderStyle = 'dashed';
                }
            }
        } catch (err) {
            console.error("Gagal mengirim laporan:", err);
            showCustomModal('SIAGA2', 'Gagal Mengirim', 'Laporan Anda gagal disimpan: ' + err.message);
        } finally {
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.textContent = originalBtnText;
            }
        }
    };
    
    processSubmit();
}

function submitSaran(e) {
    e.preventDefault();
    if(!auth.currentUser) return;
    
    const form = e.target;
    const btnSubmit = form.querySelector('button[type="submit"]');
    const originalBtnText = btnSubmit ? btnSubmit.textContent : '';
    
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.textContent = 'Mengirim...';
    }
    
    const email = document.getElementById('saran-email').value;
    const pesan = document.getElementById('saran-pesan').value;
    
    if (database) {
        database.ref('saran').push({
            uid: auth.currentUser.uid,
            email: email,
            pesan: pesan,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        })
        .then(() => {
            showSuccessModal('Success', 'Saran dan masukan Anda berhasil dikirim!');
            form.reset();
        })
        .catch(err => {
            console.error("Gagal mengirim saran:", err);
            showCustomModal('SIAGA2', 'Gagal Mengirim', 'Saran Anda gagal disimpan: ' + err.message);
        })
        .finally(() => {
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.textContent = originalBtnText;
            }
        });
    }
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
            if(tk.includes('siaga 2') || tk.includes('bahaya') || tk.includes('parah') || tk.includes('pinggang') || tk.includes('dada')) badgeColor = '#ef4444'; // merah
            else if(tk.includes('siaga 1') || tk.includes('waspada') || tk.includes('lutut')) badgeColor = '#f59e0b'; // kuning/orange
            
            if(adminLapor) {
                const safeNama = escapeHTML(data.nama || 'Anonim');
                const safeLokasi = escapeHTML(data.lokasi || '-');
                const safeTingkat = escapeHTML(data.tingkat || '-');
                const safeTime = date.toLocaleString('id-ID');

                let fotoElement = data.foto ? `<div style="margin-top: 15px;"><img src="${data.foto}" style="max-height: 250px; width: auto; max-width: 100%; border-radius: 8px; border: 1px solid rgba(0,0,0,0.1); object-fit: contain; background: #000;"></div>` : '';

                adminLapor.innerHTML = `
                <div class="admin-report-card" style="border-left: 6px solid ${badgeColor}; display: flex; flex-direction: column; position: relative;">
                    <div class="admin-report-header" style="padding-right: 40px;">
                        <h4 class="admin-report-title">
                            <span class="admin-report-name">👤 ${safeNama}</span>
                        </h4>
                        <span class="admin-report-time">🕒 ${safeTime}</span>
                    </div>
                    <div class="admin-report-body">
                        <p class="admin-report-detail"><strong>Lokasi:</strong> <span>${safeLokasi}</span></p>
                        <p class="admin-report-detail" style="display: flex; align-items: center; gap: 5px;">
                            <strong>Tingkat:</strong> 
                            <span style="background: ${badgeColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem; font-weight: bold;">${safeTingkat}</span>
                        </p>
                        ${fotoElement}
                    </div>
                    
                    <!-- Tombol Hapus di Kanan Bawah agar proper -->
                    <div style="margin-top: 15px; display: flex; justify-content: flex-end; border-top: 1px solid rgba(0,0,0,0.05); padding-top: 10px;">
                        <button onclick="hapusLaporan('${child.key}')" title="Hapus Laporan" style="background: #fee2e2; color: #ef4444; border: 1px solid #fca5a5; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; gap: 5px;">
                            <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; fill: currentColor;"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                            Hapus Laporan
                        </button>
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
                const safeEmail = escapeHTML(data.email || 'Pengguna Anonim');
                const safePesan = escapeHTML(data.pesan || '-');
                const safeTime = date.toLocaleDateString('id-ID') + ' ' + date.toLocaleTimeString('id-ID');

                adminSaran.innerHTML = `
                <div class="admin-saran-card">
                    <div class="admin-saran-header">
                        <h4 class="admin-saran-email">✉️ ${safeEmail}</h4>
                        <span class="admin-saran-time">${safeTime}</span>
                    </div>
                    <p class="admin-saran-pesan">"${safePesan}"</p>
                    <div style="margin-top: 10px; text-align: right;">
                        <button onclick="hapusSaran('${child.key}')" title="Hapus Saran" style="background: rgba(239, 68, 68, 0.12); border: none; padding: 8px; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: 0.3s;">
                            <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: #ef4444;"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                        </button>
                    </div>
                </div>
                ` + adminSaran.innerHTML;
            }
        });
        
        if(statTotalSaran) statTotalSaran.textContent = count;
        if(count === 0 && adminSaran) adminSaran.innerHTML = '<div class="admin-empty-state">Belum ada saran atau feedback.</div>';
    });
}

// Fungsi Hapus untuk Admin
window.hapusLaporan = function(key) {
    if (confirm('Yakin ingin menghapus laporan ini? Tindakan ini tidak dapat dibatalkan.')) {
        if (database) {
            database.ref('laporan/' + key).remove()
            .then(() => {
                showSuccessModal('Sukses', 'Laporan berhasil dihapus dari sistem.');
            })
            .catch(err => {
                console.error('Gagal hapus laporan:', err);
                showCustomModal('SIAGA2', 'Gagal Menghapus', err.message);
            });
        }
    }
};

window.hapusSaran = function(key) {
    if (confirm('Yakin ingin menghapus feedback/saran ini?')) {
        if (database) {
            database.ref('saran/' + key).remove()
            .then(() => {
                showSuccessModal('Sukses', 'Saran berhasil dihapus dari sistem.');
            })
            .catch(err => {
                console.error('Gagal hapus saran:', err);
                showCustomModal('SIAGA2', 'Gagal Menghapus', err.message);
            });
        }
    }
};
