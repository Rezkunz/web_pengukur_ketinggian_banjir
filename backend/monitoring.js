// Water Monitoring and Charting Logic
// SENSOR MENGHADAP KE ATAS: d_cm = tinggi air langsung
// Semakin tinggi nilai level = semakin tinggi air = semakin bahaya
const THRESHOLDS = {
    SIAGA1: 250, // level >= 250cm = SIAGA 1 (paling bahaya)
    SIAGA2: 200, // level >= 200cm = SIAGA 2 (bahaya)
    MAX_TANK: 400 // Batas maksimum sensor HC-SR04 (~4 meter)
};

let lastNotifState = 'AMAN';

// Chart initialization
let waterChart;
let hourlyData = [0, 0, 0, 0, 0, 0, 0]; // Akan diisi dari Firebase saat load
let currentWaterLevel = 0; // State penyimpan nilai air terkini dr Firebase

const CHART_HISTORY_PATH = 'sensor_data/chart_history';
const CHART_MAX_POINTS = 7;

function initChart(isAdmin = false) {
    const canvasId = isAdmin ? 'adminWaterChart' : 'waterChart';
    let canvasEl = document.getElementById(canvasId);
    if(!canvasEl) return;
    
    if(waterChart) waterChart.destroy();

    const ctx = canvasEl.getContext('2d');
    waterChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['-90 Mnt', '-75 Mnt', '-60 Mnt', '-45 Mnt', '-30 Mnt', '-15 Mnt', 'Sekarang'],
            datasets: [{
                label: 'Debit Air (cm)',
                data: hourlyData,
                borderColor: '#6e93b3',
                backgroundColor: 'rgba(110, 147, 179, 0.2)',
                tension: 0.4,
                fill: true,
                borderWidth: 3,
                pointBackgroundColor: '#476a8a',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 340,
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });

    // Setelah chart dibuat, load riwayat dari Firebase
    loadChartHistoryFromFirebase();
}

/**
 * Memuat riwayat grafik dari Firebase (7 titik terakhir).
 * Dipanggil saat chart diinisialisasi agar semua device melihat data yang sama.
 */
function loadChartHistoryFromFirebase() {
    if (!database) return;
    database.ref(CHART_HISTORY_PATH)
        .orderByKey()
        .limitToLast(CHART_MAX_POINTS)
        .once('value', (snapshot) => {
            const entries = [];
            snapshot.forEach(child => {
                entries.push(child.val()); // nilai level air
            });
            // Jika data kurang dari 7, isi sisanya dengan 0 di depan
            while (entries.length < CHART_MAX_POINTS) {
                entries.unshift(0);
            }
            hourlyData = entries;
            if (waterChart) {
                waterChart.data.datasets[0].data = hourlyData;
                waterChart.update();
            }
        });
}

/**
 * Menyimpan satu titik data ke Firebase dan menghapus entri lama
 * agar hanya menyimpan maksimal CHART_MAX_POINTS entri.
 */
function saveChartPointToFirebase(value) {
    if (!database) return;
    const historyRef = database.ref(CHART_HISTORY_PATH);
    const timestamp = Date.now().toString(); // key berupa unix ms

    // 1. Simpan titik baru
    historyRef.child(timestamp).set(Math.round(value))
        .then(() => {
            // 2. Ambil semua kunci, hapus yang melebihi batas
            return historyRef.orderByKey().once('value');
        })
        .then((snapshot) => {
            const keys = [];
            snapshot.forEach(child => keys.push(child.key));
            // Hapus kunci-kunci lama jika total > CHART_MAX_POINTS
            const toDelete = keys.slice(0, Math.max(0, keys.length - CHART_MAX_POINTS));
            toDelete.forEach(key => historyRef.child(key).remove());
        })
        .catch(err => console.warn('Gagal menyimpan riwayat grafik:', err));
}

/**
 * Update grafik lokal dan sinkronisasi ke Firebase.
 */
function updateChartData(newValue) {
    if (!waterChart) return;
    hourlyData.shift();
    hourlyData.push(newValue);
    waterChart.update();

    // Simpan ke Firebase agar device lain bisa membaca riwayat yang sama
    saveChartPointToFirebase(newValue);
}

function calculatePercentage(currentValue, maxValue) {
    let percentage = (currentValue / maxValue) * 100;
    if (percentage > 100) percentage = 100;
    if (percentage < 5) percentage = 5;
    return percentage;
}

function updateUI(waterLevel) {
    if (!auth || !auth.currentUser) return; // Prevent updates when not logged in

    const currentLevelEl = document.getElementById('current-level');
    const waterFillEl = document.getElementById('water-fill');
    const alertPanelEl = document.getElementById('alert-panel');
    const alertMessageEl = document.getElementById('alert-message');
    const lastUpdateEl = document.getElementById('last-update');
    const adminStatusAir = document.getElementById('admin-status-air');

    if(currentLevelEl) currentLevelEl.textContent = Math.round(waterLevel);

    const percentage = calculatePercentage(waterLevel, THRESHOLDS.MAX_TANK);
    if(waterFillEl) waterFillEl.style.height = `${percentage}%`;

    if(alertPanelEl) alertPanelEl.className = 'alert-section glass-panel';

    let currentState = 'AMAN';

    // Siaga 2 dicek DULU (level >= 100cm, lebih bahaya dari Siaga 1)
    if (waterLevel >= THRESHOLDS.SIAGA2) {
        if(waterFillEl) waterFillEl.style.backgroundColor = 'var(--water-siaga1)';
        if(alertPanelEl) alertPanelEl.classList.add('status-siaga1');
        if(alertMessageEl) {
            alertMessageEl.textContent = 'SIAGA 2 (Bahaya)';
            alertMessageEl.style.color = 'var(--status-siaga1)';
        }
        if(adminStatusAir) {
            adminStatusAir.textContent = 'SIAGA 2';
            adminStatusAir.style.color = '#e74c3c';
        }
        currentState = 'SIAGA2';
    }
    // Siaga 1 dicek kedua (level >= 50cm, waspada)
    else if (waterLevel >= THRESHOLDS.SIAGA1) {
        if(waterFillEl) waterFillEl.style.backgroundColor = 'var(--water-siaga2)';
        if(alertPanelEl) alertPanelEl.classList.add('status-siaga2');
        if(alertMessageEl) {
            alertMessageEl.textContent = 'SIAGA 1 (Waspada)';
            alertMessageEl.style.color = 'var(--status-siaga2)';
        }
        if(adminStatusAir) {
            adminStatusAir.textContent = 'SIAGA 1';
            adminStatusAir.style.color = '#f1c40f';
        }
        currentState = 'SIAGA1';
    }
    else {
        if(waterFillEl) waterFillEl.style.backgroundColor = 'var(--water-aman)';
        if(alertPanelEl) alertPanelEl.classList.add('status-aman');
        if(alertMessageEl) {
            alertMessageEl.textContent = 'Aman';
            alertMessageEl.style.color = 'var(--status-aman)';
        }
        if(adminStatusAir) {
            adminStatusAir.textContent = 'Aman';
            adminStatusAir.style.color = '#58d68d';
        }
        currentState = 'AMAN';
    }

    if (currentState !== lastNotifState) {
        if (currentState === 'SIAGA1') {
            // Hanya tampilkan notif SIAGA 1 jika sebelumnya AMAN (bukan loncatan dari SIAGA2 ke bawah)
            const msg1 = `Ketinggian air mencapai ${Math.round(waterLevel)}cm.\nPERINGATAN: Segera evakuasi dan pergi ke posko terdekat!`;
            sendNotification('🚨 SIAGA 1', { body: msg1 });
            showCustomModal('SIAGA1', 'Warning!', msg1);
        } else if (currentState === 'SIAGA2') {
            // Jika lompatan langsung dari AMAN ke SIAGA 2, tampilkan notif SIAGA 2 saja (skip SIAGA 1)
            const lonjakanDariAman = lastNotifState === 'AMAN';
            const prefix = lonjakanDariAman
                ? `⚡ LONJAKAN MENDADAK! Ketinggian air mencapai ${Math.round(waterLevel)}cm.`
                : `Ketinggian air mencapai ${Math.round(waterLevel)}cm.`;
            const msg2 = `${prefix}\nHIMBAUAN: Masyarakat dihimbau untuk mulai evakuasi.`;
            sendNotification('⚠️ SIAGA 2', { body: msg2 });
            showCustomModal('SIAGA2', 'Warning!', msg2);
        }
        lastNotifState = currentState;
    }

    const now = new Date();
    if (lastUpdateEl) lastUpdateEl.textContent = now.toLocaleTimeString('id-ID') + ' WIB';
}

function startDataListener() {
    if (database) {
        const waterLevelRef = database.ref('sensor_data/water_level');
        waterLevelRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (data !== null) {
                currentWaterLevel = data; // Update state lokal
                if (typeof updateUI === 'function') {
                    updateUI(data);
                }
            }
        });
    }

    // Interval Timer: Memasukkan data air terbaru ke dalam Grafik setiap 15 Menit (900000 ms)
    setInterval(() => {
        updateChartData(currentWaterLevel);
    }, 900000);

    // MOCK DATA telah dihapus.
    // Sekarang aplikasi murni mengandalkan data Firebase asli dari alat fisik Anda.
}
