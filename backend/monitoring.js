// Water Monitoring and Charting Logic
// SENSOR MENGHADAP KE ATAS: d_cm = tinggi air langsung
// Semakin tinggi nilai level = semakin tinggi air = semakin bahaya
const THRESHOLDS = {
    SIAGA1: 250, // level >= 250cm = SIAGA 1 (paling bahaya)
    SIAGA2: 200, // level >= 200cm = SIAGA 2 (bahaya)
    MAX_TANK: 400 // Batas maksimum sensor HC-SR04 (~4 meter)
};

let lastNotifState = 'AMAN';

// Chart
let waterChart;
let currentWaterLevel = 0;

const CHART_HISTORY_PATH = 'sensor_data/chart_history';
const CHART_MAX_POINTS = 7;
const CHART_INTERVAL_MS = 15 * 60 * 1000; // 15 menit dalam milidetik

// ─────────────────────────────────────────────
// CHART INIT
// ─────────────────────────────────────────────
function initChart(isAdmin = false) {
    const canvasId = isAdmin ? 'adminWaterChart' : 'waterChart';
    const canvasEl = document.getElementById(canvasId);
    if (!canvasEl) return;

    if (waterChart) waterChart.destroy();

    const ctx = canvasEl.getContext('2d');
    waterChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['-90 Mnt', '-75 Mnt', '-60 Mnt', '-45 Mnt', '-30 Mnt', '-15 Mnt', 'Sekarang'],
            datasets: [{
                label: 'Debit Air (cm)',
                data: [0, 0, 0, 0, 0, 0, 0],
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
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, max: 340, grid: { color: 'rgba(0,0,0,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });
}

// ─────────────────────────────────────────────
// REAL-TIME CHART LISTENER (baca dari Firebase)
// Semua device akan mendapat data yang sama secara real-time.
// ─────────────────────────────────────────────
function startChartHistoryListener() {
    if (!database) return;

    database.ref(CHART_HISTORY_PATH)
        .orderByKey()
        .limitToLast(CHART_MAX_POINTS)
        .on('value', (snapshot) => {
            const entries = [];
            snapshot.forEach(child => entries.push(child.val()));

            // Padded dengan 0 di depan jika data kurang dari 7
            while (entries.length < CHART_MAX_POINTS) entries.unshift(0);

            if (waterChart) {
                waterChart.data.datasets[0].data = entries;
                waterChart.update();
            }
        });
}

// ─────────────────────────────────────────────
// SMART SAVE: Simpan ke Firebase hanya jika sudah
// lewat 15 menit dari entri terakhir, atau belum ada
// data sama sekali. Tidak pakai setInterval.
// ─────────────────────────────────────────────
function maybeSaveChartPoint(value) {
    if (!database) return;

    const historyRef = database.ref(CHART_HISTORY_PATH);

    // Ambil entri terakhir untuk cek timestamp-nya
    historyRef.orderByKey().limitToLast(1).once('value', (snapshot) => {
        const now = Date.now();
        let shouldSave = true;

        snapshot.forEach(child => {
            const lastTimestamp = parseInt(child.key);
            if (!isNaN(lastTimestamp) && (now - lastTimestamp) < CHART_INTERVAL_MS) {
                shouldSave = false; // Belum 15 menit, jangan simpan
            }
        });

        if (!shouldSave) return;

        // Simpan titik baru dengan timestamp sebagai key
        historyRef.child(now.toString()).set(Math.round(value))
            .then(() => historyRef.orderByKey().once('value'))
            .then((snap) => {
                const keys = [];
                snap.forEach(child => keys.push(child.key));
                // Hapus entri lama jika melebihi batas 7
                const toDelete = keys.slice(0, Math.max(0, keys.length - CHART_MAX_POINTS));
                toDelete.forEach(key => historyRef.child(key).remove());
            })
            .catch(err => console.warn('Gagal menyimpan riwayat grafik:', err));
    });
}

// ─────────────────────────────────────────────────────
function calculatePercentage(currentValue, maxValue) {
    let percentage = (currentValue / maxValue) * 100;
    if (percentage > 100) percentage = 100;
    if (percentage < 5) percentage = 5;
    return percentage;
}

function updateUI(waterLevel) {
    if (!auth || !auth.currentUser) return;

    const currentLevelEl = document.getElementById('current-level');
    const waterFillEl = document.getElementById('water-fill');
    const alertPanelEl = document.getElementById('alert-panel');
    const alertMessageEl = document.getElementById('alert-message');
    const lastUpdateEl = document.getElementById('last-update');
    const adminStatusAir = document.getElementById('admin-status-air');

    if (currentLevelEl) currentLevelEl.textContent = Math.round(waterLevel);

    const percentage = calculatePercentage(waterLevel, THRESHOLDS.MAX_TANK);
    if (waterFillEl) waterFillEl.style.height = `${percentage}%`;

    if (alertPanelEl) alertPanelEl.className = 'alert-section glass-panel';

    let currentState = 'AMAN';

    // CEK SIAGA1 (paling bahaya, 250cm) DULU agar tidak tertangkap oleh SIAGA2 (200cm)
    if (waterLevel >= THRESHOLDS.SIAGA1) {
        if (waterFillEl)    waterFillEl.style.backgroundColor = 'var(--water-siaga1)';
        if (alertPanelEl)   alertPanelEl.classList.add('status-siaga1');
        if (alertMessageEl) { alertMessageEl.textContent = 'SIAGA 2 (Bahaya)'; alertMessageEl.style.color = 'var(--status-siaga1)'; }
        if (adminStatusAir) { adminStatusAir.textContent = 'SIAGA 2'; adminStatusAir.style.color = '#e74c3c'; }
        currentState = 'SIAGA2';
    } else if (waterLevel >= THRESHOLDS.SIAGA2) {
        if (waterFillEl)    waterFillEl.style.backgroundColor = 'var(--water-siaga2)';
        if (alertPanelEl)   alertPanelEl.classList.add('status-siaga2');
        if (alertMessageEl) { alertMessageEl.textContent = 'SIAGA 1 (Waspada)'; alertMessageEl.style.color = 'var(--status-siaga2)'; }
        if (adminStatusAir) { adminStatusAir.textContent = 'SIAGA 1'; adminStatusAir.style.color = '#f1c40f'; }
        currentState = 'SIAGA1';
    } else {
        if (waterFillEl)    waterFillEl.style.backgroundColor = 'var(--water-aman)';
        if (alertPanelEl)   alertPanelEl.classList.add('status-aman');
        if (alertMessageEl) { alertMessageEl.textContent = 'Aman'; alertMessageEl.style.color = 'var(--status-aman)'; }
        if (adminStatusAir) { adminStatusAir.textContent = 'Aman'; adminStatusAir.style.color = '#58d68d'; }
        currentState = 'AMAN';
    }

    if (currentState !== lastNotifState) {
        if (currentState === 'SIAGA1') {
            const msg1 = `Ketinggian air mencapai ${Math.round(waterLevel)}cm.\nPERINGATAN: Segera evakuasi dan pergi ke posko terdekat!`;
            sendNotification('🚨 SIAGA 1', { body: msg1 });
            showCustomModal('SIAGA1', 'Warning!', msg1);
        } else if (currentState === 'SIAGA2') {
            const lonjakanDariAman = lastNotifState === 'AMAN';
            const prefix = lonjakanDariAman
                ? `Ketinggian air mencapai ${Math.round(waterLevel)}cm.`
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

// ─────────────────────────────────────────────
// START: Listener utama untuk data sensor & grafik
// ─────────────────────────────────────────────
function startDataListener() {
    if (!database) return;

    // 1. Real-time listener untuk grafik — 100% dari Firebase, sama di semua device
    startChartHistoryListener();

    // 2. Real-time listener untuk data sensor masuk
    const waterLevelRef = database.ref('sensor_data/water_level');
    waterLevelRef.on('value', (snapshot) => {
        const data = snapshot.val();
        if (data === null) return;

        currentWaterLevel = data;
        updateUI(data);

        // 3. Cek apakah perlu mencatat titik baru ke riwayat grafik (maks 1x per 15 menit)
        maybeSaveChartPoint(data);
    });
}
