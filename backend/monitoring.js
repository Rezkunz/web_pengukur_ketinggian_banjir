// Water Monitoring and Charting Logic
let THRESHOLDS = {
    SIAGA1: 200, // Default Waspada
    SIAGA2: 300, // Default Bahaya
    MAX_TANK: 400 // Default Maksimal Tangki
};

let lastNotifState = 'AMAN';

// Chart & Global State
let waterChart;
let historyChart;
let currentWaterLevel = null;
let chartIntervalTimer = null;
let lastSavedChartTimestamp = 0; // Menghentikan race condition penyimpanan duplikat
let currentHistoryRef = null;
let chartHistoryData = [];
let chartHistoryLabels = [];

let serverTimeOffset = 0;

// Sensor Offline Detection Logic (20s polling)
const POLL_INTERVAL_MS = 5 * 1000; // Cek setiap 5 detik
const POLL_GAP_MS      = 2500;     // Jeda 2.5 detik antar sampel (menghindari false offline)
const OFFLINE_THRESHOLD_MS = 12 * 1000; // Toleransi waktu sebelum dianggap offline (12 detik)
let offlinePollTimer   = null;
let isSensorOffline    = false;
let lastOfflineCheckAt = null;
let offlineSince       = null; // Mencatat kapan sensor mulai offline

const CHART_HISTORY_PATH = 'sensor_data/chart_history';
const CHART_MAX_POINTS = 30; // Tampilkan 30 menit terakhir
const CHART_INTERVAL_MS = 1 * 60 * 1000; // 1 Menit

// Format timestamp ke Tanggal Jam:Menit (WIB)
function formatTimestamp(ts) {
    const d = new Date(parseInt(ts));
    const now = new Date();
    
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const timeStr = `${h}:${m}`;

    // Jika bukan hari ini, tambahkan tanggal agar tidak bingung
    if (d.toDateString() !== now.toDateString()) {
        const day = d.getDate();
        const month = d.getMonth() + 1;
        return `${day}/${month} ${timeStr}`;
    }
    
    return timeStr;
}

// Initialize Chart (User/Admin)
function initChart(isAdmin = false) {
    initRealtimeChart(isAdmin);
    initHistoryChart(isAdmin);
}

function initRealtimeChart(isAdmin) {
    const canvasId = isAdmin ? 'adminWaterChart' : 'waterChart';
    const canvasEl = document.getElementById(canvasId);
    if (!canvasEl) return;

    if (waterChart) waterChart.destroy();

    // Generate placeholder labels with actual HH:MM times
    const placeholderLabels = generateTimeSlotLabels();
    chartHistoryLabels = [...placeholderLabels];
    chartHistoryData = new Array(CHART_MAX_POINTS).fill(null);

    const ctx = canvasEl.getContext('2d');
    waterChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: placeholderLabels,
            datasets: [{
                label: 'Tinggi Air (cm)',
                data: new Array(CHART_MAX_POINTS).fill(null),
                borderColor: '#0ea5e9',
                backgroundColor: 'rgba(14, 165, 233, 0.15)',
                tension: 0.4,
                fill: true,
                borderWidth: 2.5,
                pointBackgroundColor: '#0369a1',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 5,
                spanGaps: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} cm` } }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 400,
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { color: '#475569', callback: v => v + 'cm', font: { size: 11 }, stepSize: 100 }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#475569', font: { size: 11 } }
                }
            }
        }
    });
}

function updateChartVisuals() {
    if (!waterChart) return;

    let displayData = [...chartHistoryData];
    let displayLabels = [...chartHistoryLabels];

    if (currentWaterLevel !== null && currentWaterLevel !== undefined && displayData.length > 0) {
        const lastIdx = displayData.length - 1;
        displayData[lastIdx] = Math.round(currentWaterLevel);
        
        const now = new Date();
        const timeShort = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
        displayLabels[lastIdx] = timeShort;
    }

    waterChart.data.labels = displayLabels;
    waterChart.data.datasets[0].data = displayData;
    waterChart.update('none');
}

/**
 * Generate time slot labels based on current time
 * Shows last CHART_MAX_POINTS slots in 1-min intervals
 * e.g. at 11:05 → ['10:36', '10:37', ..., '11:05']
 */
function generateTimeSlotLabels() {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    const labels = [];
    for (let i = CHART_MAX_POINTS - 1; i >= 0; i--) {
        const slotMinutes = currentMinutes - i;
        // Handle midnight wrap-around
        const adjustedMinutes = ((slotMinutes % 1440) + 1440) % 1440;
        const h = String(Math.floor(adjustedMinutes / 60)).padStart(2, '0');
        const m = String(adjustedMinutes % 60).padStart(2, '0');
        labels.push(`${h}:${m}`);
    }
    return labels;
}

function initHistoryChart(isAdmin = false) {
    const canvasId = isAdmin ? 'adminHistoryChart' : 'historyChart';
    const canvasEl = document.getElementById(canvasId);
    if (!canvasEl) return;

    if (historyChart) {
        historyChart.destroy();
        historyChart = null;
    }

    const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    const ctx = canvasEl.getContext('2d');
    
    // Custom Plugin to draw horizontal threshold lines
    const thresholdLines = {
        id: 'thresholdLines',
        beforeDraw(chart) {
            const { ctx, chartArea: { left, right }, scales: { y } } = chart;
            ctx.save();
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(left, y.getPixelForValue(THRESHOLDS.SIAGA1));
            ctx.lineTo(right, y.getPixelForValue(THRESHOLDS.SIAGA1));
            ctx.stroke();

            ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(left, y.getPixelForValue(THRESHOLDS.SIAGA2));
            ctx.lineTo(right, y.getPixelForValue(THRESHOLDS.SIAGA2));
            ctx.stroke();
            ctx.restore();
        }
    };

    historyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Tinggi Air (cm)',
                data: new Array(24).fill(0),
                backgroundColor: [],
                borderRadius: 5,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} cm` } }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 400,
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { color: '#475569', callback: v => v + 'cm', font: { size: 11 }, stepSize: 100 }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#475569', font: { size: 10 }, autoSkip: false }
                }
            }
        },
        plugins: [thresholdLines]
    });

    const datePickerId = isAdmin ? 'admin-history-date' : 'history-date-picker';
    const datePicker = document.getElementById(datePickerId);
    if (datePicker) {
        if (!datePicker.value) {
            const today = new Date().toISOString().split('T')[0];
            datePicker.value = today;
            datePicker.max = today;
        }
        datePicker.onchange = (e) => fetchHistoryData(e.target.value);
        fetchHistoryData(datePicker.value);
    }
}

function handleDatePickerChange(e) {
    fetchHistoryData(e.target.value);
}

async function fetchHistoryData(dateStr) {
    if (!database) return;
    
    // Detach old listener if exists
    if (currentHistoryRef) {
        currentHistoryRef.off();
        currentHistoryRef = null;
    }
    
    currentHistoryRef = database.ref(`history/${dateStr}`);
    currentHistoryRef.on('value', (snapshot) => {
        const data = snapshot.val() || {};
        const hourlyValues = Array.from({ length: 24 }, (_, i) => data[i] || 0);
        
        // Dynamic colors based on value
        const colors = hourlyValues.map(v => {
            if (v >= THRESHOLDS.SIAGA2) return 'rgba(239, 68, 68, 0.8)'; // Merah
            if (v >= THRESHOLDS.SIAGA1) return 'rgba(245, 158, 11, 0.8)'; // Kuning
            return 'rgba(14, 165, 233, 0.6)'; // Biru (Normal)
        });
        
        if (historyChart) {
            historyChart.data.datasets[0].data = hourlyValues;
            historyChart.data.datasets[0].backgroundColor = colors;
            historyChart.update();
        }
    }, (err) => {
        console.warn('Gagal mendengarkan data history:', err);
    });
}

function saveHourlyData(value) {
    if (!database || value === null || value === undefined) return;
    if (isSensorOffline) return;

    const user = auth.currentUser;
    if (!user) return;

    // Semua user klien (termasuk non-admin) diizinkan untuk auto-save data history
    // karena tidak ada server backend khusus yang menyimpan grafik per jam.
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const hour = now.getHours();

    const path = `history/${dateStr}/${hour}`;
    database.ref(path).once('value', (s) => {
        if (!s.exists()) {
            database.ref(path).set(Math.round(value));

            // Hapus data yang usianya lebih dari 30 hari agar database tidak penuh
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 31);
            const oldDateStr = thirtyDaysAgo.toISOString().split('T')[0];
            database.ref(`history/${oldDateStr}`).remove();
        }
    });
}

// Real-time Chart Listener
function startChartHistoryListener() {
    if (!database) return;

    database.ref(CHART_HISTORY_PATH)
        .orderByKey()
        .limitToLast(CHART_MAX_POINTS)
        .on('value', (snapshot) => {
            const rawData = [];
            
            snapshot.forEach(child => {
                rawData.push({
                    key: parseInt(child.key),
                    value: child.val() !== null && child.val() !== undefined ? Number(child.val()) : null
                });
            });

            // Pastikan terurut secara numerik (kronologis)
            rawData.sort((a, b) => a.key - b.key);

            const entries = rawData.map(d => d.value);
            const labels = rawData.map(d => formatTimestamp(d.key));

            // Padded dengan null di depan jika data kurang dari CHART_MAX_POINTS
            while (entries.length < CHART_MAX_POINTS) {
                entries.unshift(null);
                labels.unshift('--:--');
            }

            chartHistoryData = entries;
            chartHistoryLabels = labels;
            updateChartVisuals();
        });
}

// Save Chart Point (Max 1x per 15 minutes)
function saveChartPoint(value) {
    if (!database || value === null || value === undefined) return;
    if (isSensorOffline) return;

    const user = auth.currentUser;
    if (!user) return;

    // Semua user klien (termasuk non-admin) diizinkan auto-save titik grafik
    const historyRef = database.ref(CHART_HISTORY_PATH);
    const now = Date.now();

    historyRef.child(now.toString()).set(Math.round(value))
        .then(() => historyRef.orderByKey().once('value'))
        .then((snap) => {
            const keys = [];
            snap.forEach(child => keys.push(child.key));
            // Batasi jumlah titik maksimal (misal: 8 titik)
            const toDelete = keys.slice(0, Math.max(0, keys.length - CHART_MAX_POINTS));
            return Promise.all(toDelete.map(key => historyRef.child(key).remove()));
        })
        .catch(err => console.warn('Gagal menyimpan riwayat grafik:', err));
}

function maybeSaveChartPoint(value) {
    if (!database) return;
    if (isSensorOffline) return; // Jangan simpan jika sensor offline

    const now = Date.now();
    // 1. Cek lokal terlebih dahulu untuk mencegah race condition dari penulisan konkuren cepat
    if (now - lastSavedChartTimestamp < CHART_INTERVAL_MS) {
        return; 
    }

    const historyRef = database.ref(CHART_HISTORY_PATH);

    // 2. Ambil entri terakhir dari database untuk konfirmasi ganda
    historyRef.orderByKey().limitToLast(1).once('value', (snapshot) => {
        let shouldSave = true;

        snapshot.forEach(child => {
            const lastTimestamp = parseInt(child.key);
            if (!isNaN(lastTimestamp) && (now - lastTimestamp) < CHART_INTERVAL_MS) {
                shouldSave = false; // Belum 1 menit, jangan simpan
            }
        });

        if (shouldSave) {
            // Pasang lock lokal sebelum menulis ke Firebase
            lastSavedChartTimestamp = now;
            saveChartPoint(value);
        }
    });
}

// Auto-Save Timer
function startChartAutoSaveTimer() {
    if (chartIntervalTimer) clearInterval(chartIntervalTimer);
    chartIntervalTimer = setInterval(() => {
        if (currentWaterLevel !== null && currentWaterLevel !== undefined && !isSensorOffline) {
            saveChartPoint(currentWaterLevel);
        }
    }, CHART_INTERVAL_MS);
}

// ─────────────────────────────────────────────────────
function calculatePercentage(currentValue, maxValue) {
    let percentage = (currentValue / maxValue) * 100;
    if (percentage > 100) percentage = 100;
    if (percentage < 5) percentage = 5;
    return percentage;
}

// Helper to animate numbers smoothly using requestAnimationFrame
function animateValue(element, target, duration = 800) {
    if (!element) return;
    
    let start = parseInt(element.textContent, 10);
    if (isNaN(start)) start = 0;
    
    if (start === target) return;
    
    if (element.dataset.animationFrameId) {
        cancelAnimationFrame(parseInt(element.dataset.animationFrameId, 10));
    }
    
    const startTime = performance.now();
    
    function update(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing: easeOutCubic
        const ease = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(start + (target - start) * ease);
        
        element.textContent = current;
        
        if (progress < 1) {
            element.dataset.animationFrameId = requestAnimationFrame(update);
        } else {
            element.textContent = target;
            delete element.dataset.animationFrameId;
        }
    }
    
    element.dataset.animationFrameId = requestAnimationFrame(update);
}

function updateUI(waterLevel) {
    if (!auth || !auth.currentUser) return;

    const currentLevelEl = document.getElementById('current-level');
    const waterFillEl = document.getElementById('water-fill');
    const alertPanelEl = document.getElementById('alert-panel');
    const alertMessageEl = document.getElementById('alert-message');
    const alertIconEl = document.getElementById('alert-icon');
    const lastUpdateEl = document.getElementById('last-update');
    const adminStatusAir = document.getElementById('admin-status-air');
    const adminSensorTime = document.getElementById('admin-sensor-time');

    if (currentLevelEl) {
        animateValue(currentLevelEl, Math.round(waterLevel), 800);
    }

    const percentage = calculatePercentage(waterLevel, THRESHOLDS.MAX_TANK);
    if (waterFillEl) waterFillEl.style.height = `${percentage}%`;

    if (waterFillEl) {
        // Hapus semua class status lama
        waterFillEl.classList.remove('status-aman', 'status-siaga1', 'status-siaga2');
    }

    if (alertPanelEl) {
        alertPanelEl.classList.remove('status-aman', 'status-siaga1', 'status-siaga2', 'status-offline');
    }

    // Helper: set warna ombak langsung ke elemen SVG (CSS var tidak reliabel di SVG)
    function setWaveColors(fill1, fill2) {
        const waveSvg     = waterFillEl ? waterFillEl.querySelector('.wave-svg path')         : null;
        const waveSvgOver = waterFillEl ? waterFillEl.querySelector('.wave-svg-overlay path') : null;
        if (waveSvg)     waveSvg.setAttribute('fill', fill1);
        if (waveSvgOver) waveSvgOver.setAttribute('fill', fill2);
    }

    let currentState = 'AMAN';

    // Cek dari level tertinggi ke bawah
    if (waterLevel >= THRESHOLDS.SIAGA2) {
        // ≥ 300cm (3m) → SIAGA 2 (Bahaya) → Merah
        if (waterFillEl) {
            waterFillEl.style.setProperty('--water-color', 'linear-gradient(180deg, #ef4444 0%, #b91c1c 100%)');
            waterFillEl.classList.add('status-siaga2');
        }
        setWaveColors('rgba(255,180,180,0.45)', 'rgba(255,120,120,0.28)');
        if (alertPanelEl) alertPanelEl.classList.add('status-siaga2');
        if (alertMessageEl) {
            alertMessageEl.textContent = 'SIAGA 2 (Bahaya!)';
            alertMessageEl.style.color = 'var(--status-siaga2)';
        }
        if (alertIconEl) {
            alertIconEl.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
            `;
        }
        if (adminStatusAir) { adminStatusAir.textContent = 'SIAGA 2'; adminStatusAir.style.color = 'var(--status-siaga2)'; }
        currentState = 'SIAGA2';
    } else if (waterLevel >= THRESHOLDS.SIAGA1) {
        // ≥ 200cm (2m) → SIAGA 1 (Waspada) → Kuning
        if (waterFillEl) {
            waterFillEl.style.setProperty('--water-color', 'linear-gradient(180deg, #f59e0b 0%, #d97706 100%)');
            waterFillEl.classList.add('status-siaga1');
        }
        setWaveColors('rgba(255,230,100,0.45)', 'rgba(255,210,60,0.28)');
        if (alertPanelEl) alertPanelEl.classList.add('status-siaga1');
        if (alertMessageEl) {
            alertMessageEl.textContent = 'SIAGA 1 (Waspada)';
            alertMessageEl.style.color = 'var(--status-siaga1)';
        }
        if (alertIconEl) {
            alertIconEl.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
            `;
        }
        if (adminStatusAir) { adminStatusAir.textContent = 'SIAGA 1'; adminStatusAir.style.color = 'var(--status-siaga1)'; }
        currentState = 'SIAGA1';
    } else {
        // < 200cm → Aman → Hijau
        if (waterFillEl) {
            waterFillEl.style.setProperty('--water-color', 'linear-gradient(180deg, #10b981 0%, #059669 100%)');
            waterFillEl.classList.add('status-aman');
        }
        setWaveColors('rgba(255,255,255,0.38)', 'rgba(255,255,255,0.22)');
        if (alertPanelEl) alertPanelEl.classList.add('status-aman');
        if (alertMessageEl) { alertMessageEl.textContent = 'Aman'; alertMessageEl.style.color = 'var(--status-aman)'; }
        if (alertIconEl) {
            alertIconEl.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
            `;
        }
        if (adminStatusAir) { adminStatusAir.textContent = 'Aman'; adminStatusAir.style.color = 'var(--status-aman)'; }
        currentState = 'AMAN';
    }


    if (currentState !== lastNotifState) {
        if (currentState === 'SIAGA2') {
            const msg = `Ketinggian air mencapai ${Math.round(waterLevel)}cm.\n⚠️ PERINGATAN: Segera evakuasi dan pergi ke pos evakuasi terdekat!`;
            showCustomModal('SIAGA2', 'SIAGA 2 — Bahaya!', msg);
        } else if (currentState === 'SIAGA1') {
            const msg = `Ketinggian air mencapai ${Math.round(waterLevel)}cm.\n🔔 HIMBAUAN: Masyarakat dihimbau untuk siap-siap evakuasi.`;
            showCustomModal('SIAGA1', 'SIAGA 1 — Waspada', msg);
        }
        lastNotifState = currentState;
    }

    const now = new Date();
    const timeString = now.toLocaleTimeString('id-ID') + ' WIB';
    if (lastUpdateEl) lastUpdateEl.textContent = timeString;
    if (adminSensorTime) adminSensorTime.textContent = timeString;

    // Update titik terakhir pada grafik secara real-time mengikuti nilai sensor terbaru
    updateChartVisuals();
    
    // Hitung prediksi banjir berdasarkan trend data
    calculateFloodForecast();
}

// ─────────────────────────────────────────────
// SENSOR OFFLINE DETECTION
// ─────────────────────────────────────────────


/**
 * Update semua elemen UI terkait status offline/online
 * @param {boolean} offline
 * @param {string}  sinceText  - waktu terakhir dicek (string)
 * @param {string}  reason     - alasan offline (opsional)
 */
function updateOfflineUI(offline, sinceText, reason) {
    let msg = reason;
    
    if (!msg) {
        if (offline) {
            const dateStr = offlineSince 
                ? new Date(offlineSince).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })
                : '';
            const timeStr = offlineSince 
                ? new Date(offlineSince).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) 
                : sinceText;
            msg = `Sensor mati dari tanggal ${dateStr} jam ${timeStr} WIB`;
        } else {
            msg = `Sensor aktif — dicek ${sinceText}`;
        }
    }

    // ── Banner user ──
    const bannerUser = document.getElementById('offline-banner-user');
    if (bannerUser) {
        bannerUser.classList.toggle('visible', offline);
        const durEl = document.getElementById('offline-duration-user');
        if (durEl) durEl.textContent = msg;
    }

    // ── Banner admin ──
    const bannerAdmin = document.getElementById('offline-banner-admin');
    if (bannerAdmin) {
        bannerAdmin.classList.toggle('visible', offline);
        const durElA = document.getElementById('offline-duration-admin');
        if (durElA) durElA.textContent = msg;
    }

    // ── Admin sensor badge ──
    const badge      = document.getElementById('admin-sensor-badge');
    const badgeLabel = document.getElementById('admin-sensor-label');
    const badgeTime  = document.getElementById('admin-sensor-time');
    
    // ── New Stat Card Sensor Info ──
    const statStatus = document.getElementById('stat-sensor-status');
    const statIconWrap = document.getElementById('stat-sensor-icon');

    if (badge) {
        badge.className = `sensor-status-badge ${offline ? 'offline' : 'online'}`;
        if (badgeLabel) badgeLabel.textContent = offline ? 'Offline' : 'Online';
        // Tampilkan waktu mulai mati jika offline, atau waktu cek terakhir jika online
        if (badgeTime) {
            if (offline && offlineSince) {
                const offTime = new Date(offlineSince).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                badgeTime.textContent = `Mati sejak: ${offTime} WIB`;
            } else {
                badgeTime.textContent = `Dicek: ${sinceText}`;
            }
        }
    }

    if (statStatus) {
        statStatus.textContent = offline ? 'Offline' : 'Online';
        statStatus.style.color = offline ? 'var(--status-siaga1)' : 'var(--status-aman)';
    }

    if (statIconWrap) {
        statIconWrap.className = `stat-icon-wrap ${offline ? 'icon-orange' : 'icon-green'}`;
    }

    // ── Water tank visual ──
    const tank = document.getElementById('water-tank');
    if (tank) tank.classList.toggle('sensor-offline', offline);

    // ── Alert panel saat offline ──
    const alertPanel   = document.getElementById('alert-panel');
    const alertMessage = document.getElementById('alert-message');
    const alertIcon    = document.getElementById('alert-icon');
    if (offline && alertPanel && alertMessage) {
        alertPanel.className = 'alert-section glass-panel status-offline';
        alertMessage.textContent = 'Sensor Offline';
        alertMessage.style.color = '#888';
        if (alertIcon) {
            alertIcon.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.5"></path>
                    <path d="M5 12.5a10.94 10.94 0 0 1 5.83-2.84"></path>
                    <path d="M8.53 5.46a16.37 16.37 0 0 1 7-1.46"></path>
                    <path d="M1.63 7.21a16.59 16.59 0 0 1 2.87-1.75"></path>
                    <circle cx="12" cy="20" r="1"></circle>
                </svg>
            `;
        }
    } else if (!offline && alertPanel) {
        // Jika kembali online, jalankan updateUI untuk menampilkan data terbaru dan ikon status yang sesuai
        updateUI(currentWaterLevel);
    }

    // ── Chart offline overlays ──
    updateChartOfflineOverlays(offline);
}

/**
 * Toggle offline overlay pada semua grafik (user + admin)
 */
function updateChartOfflineOverlays(offline) {
    const overlayIds = [
        'chart-offline-realtime',
        'chart-offline-history',
        'chart-offline-admin-realtime',
        'chart-offline-admin-history'
    ];
    overlayIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('visible', offline);
    });
}

/**
 * Polling database untuk deteksi sensor offline.
 *
 * Cara kerja:
 *   1. Ambil nilai sensor_data/ts dari Firebase (sampel pertama)
 *   2. Tunggu POLL_GAP_MS (2 detik)
 *   3. Ambil lagi   sensor_data/ts (sampel kedua)
 *   4. Jika nilai berubah  → NodeMCU masih aktif kirim data = ONLINE
 *      Jika nilai sama     → tidak ada data baru dalam 2 detik    = OFFLINE
 *
 * Logika ini 100% akurat karena:
 *   - NodeMCU kirim ts (millis/1000) setiap 0.5 detik
 *   - Dalam jeda 2 detik, ts pasti berubah minimal 1
 *   - Kalau tidak berubah, berarti tidak ada write dari NodeMCU
 */
async function pollSensorStatus() {
    if (!database) return;

    try {
        // Ambil timestamp terakhir dari Firebase
        const snap = await database.ref('sensor_data/ts').once('value');
        const ts = snap.val();

        lastOfflineCheckAt = Date.now();

        if (ts === null) {
            // Fallback jika belum ada data sama sekali di database
            setOfflineState(true, 'Belum ada data sensor di database');
            return;
        }

        // Hitung selisih waktu antara Firebase Server Time dengan timestamp terakhir
        const serverTime = Date.now() + serverTimeOffset;
        const diff = serverTime - ts;

        // Toleransi waktu sebelum dianggap offline (mengakomodasi interval heartbeat 3 detik + jeda transmisi WiFi)
        // Menjamin tidak akan ada false offline (notif kedap-kedip) karena gangguan jaringan kecil.
        const isOffline = (diff > OFFLINE_THRESHOLD_MS);

        setOfflineState(isOffline, null, isOffline ? ts : null);

    } catch (err) {
        console.warn('⚠️ Gagal polling sensor status:', err.message);
    }
}

/**
 * Set status offline/online dan update semua UI
 * @param {boolean} offline
 * @param {string}  reason
 * @param {number}  timestamp - Waktu server saat sensor terakhir aktif (ms)
 */
function setOfflineState(offline, reason, timestamp) {
    if (offline === isSensorOffline && !timestamp) return; // tidak berubah, skip
    isSensorOffline = offline;

    if (offline) {
        // Jika offline, gunakan timestamp dari database (jika ada) atau waktu sekarang
        if (!offlineSince) {
            offlineSince = timestamp || Date.now();
        }
    } else {
        // Baru saja kembali online
        offlineSince = null;
    }

    const sinceText = lastOfflineCheckAt
        ? new Date(lastOfflineCheckAt).toLocaleTimeString('id-ID') + ' WIB'
        : '-';

    // Update 'Terakhir diperbarui' di bawah grafik agar sinkron dengan waktu mati
    if (offline && offlineSince) {
        const offTime = new Date(offlineSince).toLocaleTimeString('id-ID') + ' WIB';
        const offDate = new Date(offlineSince).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        const lastUpdateEl = document.getElementById('last-update');
        const adminSensorTime = document.getElementById('admin-sensor-time');
        
        if (lastUpdateEl) lastUpdateEl.textContent = `${offDate}, ${offTime}`;
        if (adminSensorTime) adminSensorTime.textContent = `${offDate}, ${offTime}`;
    }

    updateOfflineUI(offline, sinceText, reason);
}

// ─────────────────────────────────────────────
// START: Flood Forecast Logic (Prediksi Banjir)
// ─────────────────────────────────────────────
let floodForecast = {
    rateOfRise: 0,      // cm/menit
    timeToSiaga1: null, // dalam menit
    timeToSiaga2: null, // dalam menit
    status: 'normal',   // normal, moderate, urgent
    lastAlertTime: 0    // timestamp untuk cooldown alert
};

// ML Pattern Recognition untuk analisis musiman
let floodPatterns = {
    hourlyAverage: {},      // rata-rata per jam (0-23)
    dailyPeaks: [],         // peak level setiap hari
    riseRateHistory: [],    // history laju kenaikan
    predictions: {          // AI predictions
        seasonRisk: 'normal',   // normal, medium, high
        peakTimeToday: null,    // perkiraan jam peak
        avgRiseRate: 0          // rata-rata rate of rise
    }
};

/**
 * Hitung prediksi banjir berdasarkan data chart history 30 menit terakhir
 * Menggunakan linear regression untuk trend analisis
 */
function calculateFloodForecast() {
    if (!chartHistoryData || chartHistoryData.length < 2) return;
    
    // Ambil data yang valid (tidak null)
    const validPoints = chartHistoryData
        .map((val, idx) => ({ idx, val: Number(val) }))
        .filter(p => p.val !== null && !isNaN(p.val))
        .slice(-10); // Ambil 10 poin terakhir untuk akurasi
    
    if (validPoints.length < 2) return;
    
    // Hitung linear regression: y = mx + b
    const n = validPoints.length;
    const sumX = validPoints.reduce((sum, p) => sum + p.idx, 0);
    const sumY = validPoints.reduce((sum, p) => sum + p.val, 0);
    const sumXY = validPoints.reduce((sum, p) => sum + p.idx * p.val, 0);
    const sumXX = validPoints.reduce((sum, p) => sum + p.idx * p.idx, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const rateOfRise = slope; // cm per data point (setiap menit)
    
    floodForecast.rateOfRise = Math.round(rateOfRise * 100) / 100;
    
    // Hitung estimasi waktu
    const currentLevel = currentWaterLevel || 0;
    floodForecast.timeToSiaga1 = null;
    floodForecast.timeToSiaga2 = null;
    
    if (rateOfRise > 0.05) { // Hanya prediksi jika ada kenaikan signifikan (>0.05 cm/menit)
        const minutesToSiaga1 = (THRESHOLDS.SIAGA1 - currentLevel) / rateOfRise;
        const minutesToSiaga2 = (THRESHOLDS.SIAGA2 - currentLevel) / rateOfRise;
        
        if (minutesToSiaga1 > 0) {
            floodForecast.timeToSiaga1 = Math.round(minutesToSiaga1);
        }
        if (minutesToSiaga2 > 0) {
            floodForecast.timeToSiaga2 = Math.round(minutesToSiaga2);
        }
    } else if (rateOfRise < -0.05) { // Jika air menurun
        floodForecast.timeToSiaga1 = null;
        floodForecast.timeToSiaga2 = null;
    }
    
    // Tentukan status ramalan
    if (rateOfRise > 1) {
        floodForecast.status = 'urgent';   // Naiknya cepat >1 cm/menit
    } else if (rateOfRise > 0.3) {
        floodForecast.status = 'moderate'; // Sedang 0.3-1 cm/menit
    } else {
        floodForecast.status = 'normal';   // Normal
    }
    
    updateFloodForecastUI();
}

/**
 * Update ML Pattern Recognition untuk prediksi musiman
 */
function updateFloodPatterns() {
    if (!chartHistoryData || chartHistoryData.length === 0) return;
    
    // Update rate of rise history
    floodPatterns.riseRateHistory.push(floodForecast.rateOfRise);
    if (floodPatterns.riseRateHistory.length > 1440) { // Simpan 24 jam
        floodPatterns.riseRateHistory.shift();
    }
    
    // Hitung average rate of rise
    if (floodPatterns.riseRateHistory.length > 0) {
        const avg = floodPatterns.riseRateHistory.reduce((a, b) => a + b, 0) / floodPatterns.riseRateHistory.length;
        floodPatterns.predictions.avgRiseRate = Math.round(avg * 100) / 100;
    }
    
    // Tentukan risk level berdasarkan trend
    if (floodPatterns.predictions.avgRiseRate > 0.8) {
        floodPatterns.predictions.seasonRisk = 'high';
    } else if (floodPatterns.predictions.avgRiseRate > 0.3) {
        floodPatterns.predictions.seasonRisk = 'medium';
    } else {
        floodPatterns.predictions.seasonRisk = 'normal';
    }
    
    // Prediksi jam peak berdasarkan waktu (heuristic: biasanya 12-14 siang)
    const now = new Date();
    const hour = now.getHours();
    floodPatterns.predictions.peakTimeToday = (hour < 12) ? '12:00-14:00 siang' : 'sudah lewat';
}

/**
 * Alert otomatis saat kondisi darurat
 */
function checkAutoAlert() {
    const now = Date.now();
    const alertCooldown = 5 * 60 * 1000; // 5 menit cooldown
    
    // Alert jika Siaga 2 < 10 menit dan belum alert baru-baru ini
    if (floodForecast.timeToSiaga2 !== null && 
        floodForecast.timeToSiaga2 < 10 && 
        (now - floodForecast.lastAlertTime) > alertCooldown) {
        
        triggerFloodAlert('URGENT');
        floodForecast.lastAlertTime = now;
    } 
    // Alert untuk moderate jika Siaga 1 < 15 menit
    else if (floodForecast.timeToSiaga1 !== null && 
             floodForecast.timeToSiaga1 < 15 && 
             floodForecast.timeToSiaga1 >= 10 &&
             (now - floodForecast.lastAlertTime) > alertCooldown) {
        
        triggerFloodAlert('WARNING');
        floodForecast.lastAlertTime = now;
    }
}

/**
 * Trigger flood alert notification
 */
function triggerFloodAlert(severity) {
    const currentLevel = currentWaterLevel || 0;
    let message = '';
    let title = '';
    
    if (severity === 'URGENT') {
        title = '🚨 PERINGATAN DARURAT BANJIR!';
        message = `Siaga 2 akan tercapai dalam ${floodForecast.timeToSiaga2} menit. Level air: ${currentLevel}cm`;
    } else if (severity === 'WARNING') {
        title = '⚠️ Peringatan Banjir';
        message = `Siaga 1 akan tercapai dalam ${floodForecast.timeToSiaga1} menit. Level air: ${currentLevel}cm`;
    }
    
    // Show browser notification if permission granted
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, {
            body: message,
            icon: '/manifest.json',
            tag: 'flood-alert',
            requireInteraction: severity === 'URGENT'
        });
    }
    
    // Log untuk Firebase (optional)
    console.warn('[AUTO ALERT]', title, message);
}

/**
 * Update UI untuk menampilkan prediksi banjir dengan design lebih user-friendly
 */
function updateFloodForecastUI() {
    const ratePanel = document.getElementById('rate-of-rise-panel');
    const siagaPanel = document.getElementById('siaga-prediction-panel');
    if (!ratePanel) return;
    
    // Jalankan analisis pola ML terlebih dahulu agar data metrik AI terupdate
    updateFloodPatterns();
    
    // Tentukan status laju kenaikan dan deskripsinya
    let rateDescription = 'Stabil';
    let rateClass = 'status-aman'; // default safe (green)
    let iconGradient = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
    let shadowColor = 'rgba(16, 185, 129, 0.4)';
    
    if (floodForecast.rateOfRise > 1.0) {
        rateDescription = 'Kenaikan Kritis';
        rateClass = 'status-siaga2'; // red
        iconGradient = 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)';
        shadowColor = 'rgba(239, 68, 68, 0.4)';
    } else if (floodForecast.rateOfRise > 0.3) {
        rateDescription = 'Kenaikan Sedang';
        rateClass = 'status-siaga1'; // orange
        iconGradient = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
        shadowColor = 'rgba(245, 158, 11, 0.4)';
    } else if (floodForecast.rateOfRise > 0.05) {
        rateDescription = 'Kenaikan Lambat';
        rateClass = 'status-siaga1'; // orange (waspada)
        iconGradient = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
        shadowColor = 'rgba(245, 158, 11, 0.4)';
    } else if (floodForecast.rateOfRise < -0.05) {
        rateDescription = 'Air Surut';
        rateClass = 'status-aman'; // green
        iconGradient = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
        shadowColor = 'rgba(16, 185, 129, 0.4)';
    }
    
    // Format teks nilai Laju Kenaikan (Tanpa info Siaga lagi!)
    const rateValueText = `${Math.abs(floodForecast.rateOfRise).toFixed(2)} cm/menit (${rateDescription})`;
    
    // Perbarui kelas border panel rate
    ratePanel.className = `alert-section glass-panel ${rateClass}`;
    
    // Render isi panel Laju Kenaikan
    ratePanel.innerHTML = `
        <div class="alert-icon" style="background: ${iconGradient}; box-shadow: 0 4px 15px ${shadowColor};">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
        </div>
        <div class="alert-text" style="display: flex; flex-direction: column; align-items: flex-start;">
            <h3 style="text-transform: none; letter-spacing: normal;">Laju Kenaikan</h3>
            <p style="margin-bottom: 2px; text-transform: none; font-weight: 700; color: var(--text-primary); font-size: 1.25rem;">${rateValueText}</p>
        </div>
    `;
    
    // Tentukan prediksi siaga secara dinamis dan tampilkan sebagai banner terpisah
    const currentLevel = currentWaterLevel || 0;
    let siagaHTML = '';
    let urgencyClass = 'status-aman';
    
    if (currentLevel < THRESHOLDS.SIAGA1) {
        // Belum mencapai Siaga 1: Tampilkan estimasi waktu menuju Siaga 1 jika sedang naik
        if (floodForecast.timeToSiaga1 !== null && floodForecast.timeToSiaga1 > 0) {
            const hours = Math.floor(floodForecast.timeToSiaga1 / 60);
            const mins = floodForecast.timeToSiaga1 % 60;
            const timeStr = hours > 0 ? `${hours} jam ${mins} menit` : `${mins} menit`;
            urgencyClass = floodForecast.timeToSiaga1 < 30 ? 'status-siaga2' : 'status-siaga1';
            const siagaGradient = urgencyClass === 'status-siaga2' 
                ? 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)' 
                : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
            const siagaShadow = urgencyClass === 'status-siaga2' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(245, 158, 11, 0.4)';
            
            siagaHTML = `
                <div class="alert-icon" style="background: ${siagaGradient}; box-shadow: 0 4px 15px ${siagaShadow};">
                    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                </div>
                <div class="alert-text" style="display: flex; flex-direction: column; align-items: flex-start;">
                    <h3 style="text-transform: none; letter-spacing: normal;">Prediksi Siaga 1</h3>
                    <p style="margin-bottom: 2px; text-transform: none; font-weight: 700; color: var(--text-primary); font-size: 1.25rem;">${timeStr} lagi <span style="font-size: 0.85rem; font-weight: 500; color: var(--text-secondary);">(Menuju Batas 200cm)</span></p>
                </div>
            `;
        } else {
            // Aman / Stabil di bawah 200cm
            const siagaGradient = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            const siagaShadow = 'rgba(16, 185, 129, 0.4)';
            urgencyClass = 'status-aman';
            
            siagaHTML = `
                <div class="alert-icon" style="background: ${siagaGradient}; box-shadow: 0 4px 15px ${siagaShadow};">
                    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                </div>
                <div class="alert-text" style="display: flex; flex-direction: column; align-items: flex-start;">
                    <h3 style="text-transform: none; letter-spacing: normal;">Prediksi Siaga 1</h3>
                    <p style="margin-bottom: 2px; text-transform: none; font-weight: 700; color: var(--text-primary); font-size: 1.25rem;">Aman <span style="font-size: 0.85rem; font-weight: 500; color: var(--text-secondary);">(Kondisi di bawah batas)</span></p>
                </div>
            `;
        }
    } else {
        // Sudah mencapai/melebihi Siaga 1: Ganti dengan estimasi waktu menuju Siaga 2 jika sedang naik
        if (floodForecast.timeToSiaga2 !== null && floodForecast.timeToSiaga2 > 0) {
            const hours = Math.floor(floodForecast.timeToSiaga2 / 60);
            const mins = floodForecast.timeToSiaga2 % 60;
            const timeStr = hours > 0 ? `${hours} jam ${mins} menit` : `${mins} menit`;
            urgencyClass = floodForecast.timeToSiaga2 < 30 ? 'status-siaga2' : 'status-siaga1';
            const siagaGradient = urgencyClass === 'status-siaga2' 
                ? 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)' 
                : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
            const siagaShadow = urgencyClass === 'status-siaga2' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(245, 158, 11, 0.4)';
            
            siagaHTML = `
                <div class="alert-icon" style="background: ${siagaGradient}; box-shadow: 0 4px 15px ${siagaShadow};">
                    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                    </svg>
                </div>
                <div class="alert-text" style="display: flex; flex-direction: column; align-items: flex-start;">
                    <h3 style="text-transform: none; letter-spacing: normal;">Prediksi Siaga 2</h3>
                    <p style="margin-bottom: 2px; text-transform: none; font-weight: 700; color: var(--text-primary); font-size: 1.25rem;">${timeStr} lagi <span style="font-size: 0.85rem; font-weight: 500; color: var(--text-secondary);">(Menuju Batas 300cm)</span></p>
                </div>
            `;
        } else {
            // Aman / Stabil untuk Siaga 2
            const siagaGradient = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            const siagaShadow = 'rgba(16, 185, 129, 0.4)';
            urgencyClass = 'status-aman';
            
            siagaHTML = `
                <div class="alert-icon" style="background: ${siagaGradient}; box-shadow: 0 4px 15px ${siagaShadow};">
                    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                </div>
                <div class="alert-text" style="display: flex; flex-direction: column; align-items: flex-start;">
                    <h3 style="text-transform: none; letter-spacing: normal;">Prediksi Siaga 2</h3>
                    <p style="margin-bottom: 2px; text-transform: none; font-weight: 700; color: var(--text-primary); font-size: 1.25rem;">Aman <span style="font-size: 0.85rem; font-weight: 500; color: var(--text-secondary);">(Kondisi di bawah batas)</span></p>
                </div>
            `;
        }
    }
    
    // Tampilkan panel prediksi Siaga
    if (siagaPanel) {
        siagaPanel.innerHTML = siagaHTML;
        siagaPanel.className = `alert-section glass-panel ${urgencyClass}`;
        siagaPanel.style.display = 'flex';
    }
    
    // Trigger auto alerts
    checkAutoAlert();
}

/**
 * Mulai polling otomatis setiap POLL_INTERVAL_MS
 */
function startOfflineDetector() {
    if (offlinePollTimer) clearInterval(offlinePollTimer);

    // Cek pertama kali 3 detik setelah page load
    setTimeout(pollSensorStatus, 3 * 1000);

    // Polling rutin setiap 60 detik
    offlinePollTimer = setInterval(pollSensorStatus, POLL_INTERVAL_MS);
}

// ─────────────────────────────────────────────
// START: Weather Fetching Logic
// ─────────────────────────────────────────────
let weatherLat = -6.984213743617759;
let weatherLon = 107.62672849717276;
let weatherLocationName = 'Bojongsoang';
const LAMAJANG_LAT = -6.984214864265832;
const LAMAJANG_LON = 107.62672526292504;
let weatherIntervalTimer = null;
let useProxyDirectly = false;
let monitoringMap = null;
let weatherMarker = null;
let weatherLocationSubtext = 'Bojongsoang, Bandung';

function getDistanceKm(lat1, lon1, lat2, lon2) {
    const toRad = deg => deg * Math.PI / 180;
    const earthRadiusKm = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isNearDeviceArea(lat, lon) {
    return getDistanceKm(Number(lat), Number(lon), LAMAJANG_LAT, LAMAJANG_LON) <= 8;
}

async function fetchWithTimeout(url, options = {}, timeout = 2000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

async function fetchViaProxy(url, options = {}) {
    // Try AllOrigins raw proxy first
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    try {
        const response = await fetchWithTimeout(proxyUrl, options, 5000);
        if (!response.ok) throw new Error('Proxy AllOrigins raw failed');
        return response;
    } catch (err) {
        console.warn(`Proxy AllOrigins raw failed for ${url}:`, err);
        // Fallback to cors.lol
        const corsLolUrl = `https://api.cors.lol/?url=${encodeURIComponent(url)}`;
        const response = await fetchWithTimeout(corsLolUrl, options, 5000);
        if (!response.ok) throw new Error('Proxy cors.lol failed');
        return response;
    }
}

async function fetchWithFallback(url, options = {}) {
    let targetUrl = url;
    if (url.startsWith('//')) {
        const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
        targetUrl = protocol + url;
    }

    if (useProxyDirectly) {
        return fetchViaProxy(targetUrl, options);
    }

    try {
        const response = await fetchWithTimeout(targetUrl, options, 2000);
        if (!response.ok) throw new Error('Direct fetch failed');
        return response;
    } catch (err) {
        console.warn(`Direct fetch failed for ${targetUrl}, using proxy fallback:`, err);
        useProxyDirectly = true; // Use proxy directly for the rest of this session
        return fetchViaProxy(targetUrl, options);
    }
}

function getWmoDescription(code) {
    if (code === 0) return "Cerah";
    if (code === 1 || code === 2) return "Cerah Berawan";
    if (code === 3) return "Mendung";
    if (code === 45 || code === 48) return "Berkabut";
    if (code >= 51 && code <= 55) return "Gerimis";
    if (code >= 61 && code <= 65) return "Hujan";
    if (code >= 80 && code <= 82) return "Hujan Deras";
    if (code >= 95) return "Badai Petir";
    return "Berawan";
}

function getWmoIconImg(code) {
    let icon = "day";
    if (code === 0 || code === 1) icon = "day";
    else if (code === 2) icon = "cloudy-day-1";
    else if (code === 3) icon = "cloudy";
    else if (code === 45 || code === 48) icon = "cloudy";
    else if (code >= 51 && code <= 55) icon = "rainy-4";
    else if (code >= 61 && code <= 65) icon = "rainy-6";
    else if (code >= 80 && code <= 82) icon = "rainy-7";
    else if (code >= 95) icon = "thunder";
    return `<img src="https://www.amcharts.com/wp-content/themes/amcharts4/css/img/icons/weather/animated/${icon}.svg" alt="Weather Icon" style="width: 100%; height: 100%; object-fit: contain;">`;
}

function isSevenTimerWeatherData(data) {
    return data && data.source === '7timer' && Array.isArray(data.dataseries);
}

function getSevenTimerInitDate(data) {
    const init = String(data.init || '');
    if (init.length < 10) return new Date();
    const year = Number(init.slice(0, 4));
    const month = Number(init.slice(4, 6)) - 1;
    const day = Number(init.slice(6, 8));
    const hour = Number(init.slice(8, 10));
    return new Date(Date.UTC(year, month, day, hour));
}

function getSevenTimerDate(data, slot) {
    const date = getSevenTimerInitDate(data);
    date.setUTCHours(date.getUTCHours() + Number(slot.timepoint || 0));
    return date;
}

function getSevenTimerDescription(weather = '') {
    const value = weather.toLowerCase();
    if (value.includes('clear')) return 'Cerah';
    if (value.includes('pcloudy')) return 'Cerah Berawan';
    if (value.includes('cloudy')) return 'Berawan';
    if (value.includes('rain') || value.includes('shower')) return value.includes('light') ? 'Hujan Ringan' : 'Hujan';
    if (value.includes('humid')) return 'Lembap';
    if (value.includes('fog')) return 'Berkabut';
    return 'Berawan';
}

function getSevenTimerIconImg(weather = '') {
    const value = weather.toLowerCase();
    let icon = 'cloudy';
    if (value.includes('clear')) icon = 'day';
    else if (value.includes('pcloudy')) icon = 'cloudy-day-1';
    else if (value.includes('rain') || value.includes('shower')) icon = value.includes('light') ? 'rainy-4' : 'rainy-6';
    else if (value.includes('thunder')) icon = 'thunder';
    return `<img src="https://www.amcharts.com/wp-content/themes/amcharts4/css/img/icons/weather/animated/${icon}.svg" alt="Weather Icon" style="width: 100%; height: 100%; object-fit: contain;">`;
}

function isBmkgWeatherData(data) {
    return data && data.lokasi && Array.isArray(data.data) && Array.isArray(data.data[0]?.cuaca);
}

function getBmkgSlots(data) {
    if (!isBmkgWeatherData(data)) return [];
    return data.data[0].cuaca.flat().filter(Boolean);
}

function getBmkgDate(slot) {
    const raw = slot.local_datetime || slot.datetime || slot.utc_datetime;
    if (!raw) return new Date();
    if (slot.local_datetime) return new Date(raw.replace(' ', 'T') + '+07:00');
    return new Date(raw);
}

function getBmkgCurrentSlot(data) {
    const slots = getBmkgSlots(data);
    const now = Date.now();
    return slots.find(slot => getBmkgDate(slot).getTime() >= now) || slots[0];
}

function getBmkgIconImg(slot) {
    if (slot?.image) {
        return `<img src="${encodeURI(slot.image)}" alt="Weather Icon" style="width: 100%; height: 100%; object-fit: contain;">`;
    }
    return getWmoIconImg(2);
}

async function fetchBmkgWeatherData() {
    const response = await fetchWithTimeout('https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=32.04.08.2005', {}, 8000);
    if (!response.ok) throw new Error('BMKG fetch failed');
    const data = await response.json();
    data.source = 'bmkg';
    return data;
}

function formatNominatimLocation(place) {
    const address = place?.address || {};
    const name = address.village || address.town || address.city || address.suburb ||
        address.municipality || address.county || place?.name || 'Lokasi dipilih';
    const region = address.state || address.region || address.county || 'Indonesia';
    return { name, subtext: region };
}

async function updateWeatherLocationFromCoords(lat, lon) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=13&addressdetails=1`;
        const response = await fetchWithTimeout(url, { headers: { 'User-Agent': 'safe-floodmonitor/1.0' } }, 5000);
        if (!response.ok) throw new Error('Reverse geocode failed');
        const data = await response.json();
        const location = formatNominatimLocation(data);
        weatherLocationName = location.name;
        weatherLocationSubtext = location.subtext;
    } catch (error) {
        console.log('Reverse geocode failed:', error);
        weatherLocationName = `${Number(lat).toFixed(3)}, ${Number(lon).toFixed(3)}`;
        weatherLocationSubtext = 'Lokasi peta';
    }

    const locEl = document.getElementById('weather-location');
    const subEl = document.getElementById('weather-subtext');
    if (locEl) locEl.textContent = weatherLocationName;
    if (subEl) subEl.textContent = weatherLocationSubtext;
}

function setWeatherLoadingState() {
    const tempEl = document.getElementById('weather-temp');
    const descEl = document.getElementById('weather-desc');
    const humEl = document.getElementById('weather-humidity');
    const windEl = document.getElementById('weather-wind');
    const hc = document.getElementById('hourly-forecast-container');
    const dc = document.getElementById('daily-forecast-container');

    if (tempEl) tempEl.textContent = '--\u00B0C';
    if (descEl) descEl.textContent = 'Memuat...';
    if (humEl) humEl.textContent = '--%';
    if (windEl) windEl.textContent = '-- m/s';
    if (hc) hc.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#94a3b8;padding:12px;font-size:0.9rem;">Memuat prakiraan per jam...</div>';
    if (dc) dc.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:12px;font-size:0.9rem;">Memuat prakiraan harian...</div>';
}

async function fetchWeatherNews() {
    const container = document.getElementById('weather-news-container');
    const badge = document.getElementById('news-refresh-badge');
    if (!container) return;

    const rssUrl = encodeURIComponent('https://news.google.com/rss/search?q=banjir+OR+%22cuaca+ekstrem%22+OR+%22banjir+bandung%22+OR+bmkg&hl=id&gl=ID&ceid=ID:id');

    try {
        let response;
        try {
            response = await fetchWithTimeout('/api/news', {}, 3000);
            if (!response.ok || response.status === 404) {
                throw new Error('Vercel API not found');
            }
        } catch (e) {
            console.log('Vercel API for news not found, fetching directly from rss2json...');
            const url = `https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}`;
            response = await fetchWithTimeout(url, {}, 4000);
        }

        if (!response.ok) throw new Error('Network error');
        const data = await response.json();

        if (!data || data.status !== 'ok' || !data.items || data.items.length === 0)
            throw new Error('No items');

        // Update badge with last refreshed time
        const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        if (badge) badge.textContent = `Diperbarui ${now}`;

        container.innerHTML = '';

        data.items.slice(0, 4).forEach((item, i) => {
            const fullTitle = item.title || '';
            const title = fullTitle.split(' - ')[0].trim();
            const source = item.author || (fullTitle.split(' - ').slice(-1)[0]?.trim()) || 'Google News';
            const pubDate = item.pubDate || '';
            const link = item.link || '#';

            // Format waktu relatif
            const date = new Date(pubDate);
            const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
            let timeAgo = '';
            if (isNaN(diffMin) || diffMin < 0) timeAgo = 'Terbaru';
            else if (diffMin < 60) timeAgo = `${diffMin} menit lalu`;
            else if (diffMin < 1440) timeAgo = `${Math.floor(diffMin / 60)} jam lalu`;
            else timeAgo = date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

            // Badge kategori otomatis berdasarkan isi judul
            const lc = title.toLowerCase();
            let badgeHtml = '';
            if (lc.includes('banjir')) badgeHtml = '<span class="news-badge badge-banjir">🌊 Banjir</span>';
            else if (lc.includes('cuaca') || lc.includes('bmkg') || lc.includes('hujan')) badgeHtml = '<span class="news-badge badge-cuaca">🌧️ Cuaca</span>';
            else if (lc.includes('bandung')) badgeHtml = '<span class="news-badge badge-bandung">📍 Bandung</span>';
            else badgeHtml = '<span class="news-badge badge-alert">⚠️ Peringatan</span>';

            const card = `
                <a href="${link}" target="_blank" rel="noopener" class="news-card fade-in-up" style="animation-delay:${i * 0.12}s">
                    <div class="news-card-inner">
                        <div class="news-card-top">
                            ${badgeHtml}
                            <span class="news-time">${timeAgo}</span>
                        </div>
                        <div class="news-card-title">${title}</div>
                        <div class="news-card-source">
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm1-11h-2V7h2v2zm0 6h-2v-4h2v4z"/></svg>
                            ${source}
                        </div>
                    </div>
                    <div class="news-card-arrow">›</div>
                </a>
            `;
            container.innerHTML += card;
        });

     } catch (err) {
        console.warn('Gagal memuat berita:', err);
        if (badge) badge.textContent = 'Gagal memuat';
        container.innerHTML = `
            <div class="news-error">
                <span>📡</span>
                <div>Berita tidak dapat dimuat.<br><small>Periksa koneksi internet Anda.</small></div>
            </div>
        `;
    }
}

function getWttrDescription(code) {
    const c = parseInt(code);
    if (c === 113) return 'Cerah';
    if (c === 116) return 'Cerah Berawan';
    if ([119, 122].includes(c)) return 'Mendung';
    if ([143, 248, 260].includes(c)) return 'Berkabut';
    if ([176, 263, 266, 281, 284].includes(c)) return 'Gerimis';
    if ([293, 296, 353].includes(c)) return 'Hujan Ringan';
    if ([299, 302, 317, 320].includes(c)) return 'Hujan';
    if ([305, 308, 356, 359].includes(c)) return 'Hujan Deras';
    if ([200, 386, 389, 392, 395].includes(c)) return 'Badai Petir';
    return 'Berawan';
}

function getWttrIconImg(code) {
    const c = parseInt(code);
    let icon = 'day';
    if (c === 113) icon = 'day';
    else if (c === 116) icon = 'cloudy-day-1';
    else if ([119, 122].includes(c)) icon = 'cloudy';
    else if ([143, 248, 260].includes(c)) icon = 'cloudy';
    else if ([176, 263, 266, 281, 284, 293, 296, 353].includes(c)) icon = 'rainy-4';
    else if ([299, 302, 305, 308, 317, 356, 359].includes(c)) icon = 'rainy-6';
    else if ([200, 386, 389].includes(c)) icon = 'thunder';
    return `<img src="https://www.amcharts.com/wp-content/themes/amcharts4/css/img/icons/weather/animated/${icon}.svg" alt="Weather Icon" style="width: 100%; height: 100%; object-fit: contain;">`;
}

async function fetchWeatherData(lat, lon) {
    const targetLat = lat !== undefined ? lat : weatherLat;
    const targetLon = lon !== undefined ? lon : weatherLon;
    const allowBmkgFallback = isNearDeviceArea(targetLat, targetLon);
    try {
        let response;
        let data;

        // 1. Try Vercel Serverless Function first
        try {
            const url = `/api/weather?latitude=${targetLat}&longitude=${targetLon}&allowBmkg=${allowBmkgFallback ? '1' : '0'}`;
            response = await fetchWithTimeout(url, {}, 13000);
            if (response.ok) {
                data = await response.json();
            }
        } catch (e) {
            console.log('Vercel API fetch failed (possibly timeout/cold start):', e);
        }

        // 2. Try Open-Meteo Direct if Vercel failed
        if (!data) {
            try {
                console.log('Fetching directly from Open-Meteo...');
                const url = `https://api.open-meteo.com/v1/forecast?latitude=${targetLat}&longitude=${targetLon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=7&wind_speed_unit=ms&timezone=Asia%2FJakarta`;
                response = await fetchWithTimeout(url, {}, 8000);
                if (response.ok) {
                    data = await response.json();
                }
            } catch (e) {
                console.log('Open-Meteo direct fetch failed:', e);
            }
        }

        // 3. Official BMKG fallback only around the device/default area
        if (!data && allowBmkgFallback) {
            try {
                console.log('Open-Meteo failed, falling back to BMKG Bojongsoang...');
                data = await fetchBmkgWeatherData();
            } catch (e) {
                console.log('BMKG fetch failed:', e);
            }
        }

        // 4. Try Open-Meteo via Codetabs Proxy
        if (!data) {
            try {
                console.log('Fetching Open-Meteo via Proxy...');
                const rawUrl = `https://api.open-meteo.com/v1/forecast?latitude=${targetLat}&longitude=${targetLon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=7&wind_speed_unit=ms&timezone=Asia%2FJakarta`;
                const url = `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(rawUrl)}`;
                response = await fetchWithTimeout(url, {}, 8000);
                if (response.ok) {
                    data = await response.json();
                }
            } catch (e) {
                console.log('Open-Meteo proxy fetch failed:', e);
            }
        }

        // 5. Fallback to 7Timer for coordinate-based multi-day forecast
        if (!data) {
            try {
                console.log('Open-Meteo failed, falling back to 7Timer...');
                const url = `https://www.7timer.info/bin/api.pl?lon=${targetLon}&lat=${targetLat}&product=civil&output=json`;
                response = await fetchWithTimeout(url, {}, 9000);
                if (response.ok) {
                    data = await response.json();
                    data.source = '7timer';
                }
            } catch (e) {
                console.log('7Timer fetch failed:', e);
            }
        }

        // 6. Fallback to wttr.in if other coordinate-based providers failed
        if (!data) {
            try {
                console.log('Open-Meteo failed, falling back to local wttr.in bypass...');
                const url = `https://wttr.in/${targetLat},${targetLon}?format=j1`;
                response = await fetchWithTimeout(url, {}, 8000);
                if (response.ok) {
                    data = await response.json();
                }
            } catch (e) {
                console.log('wttr.in fetch failed:', e);
            }
        }

        if (!data) {
            throw new Error('All weather data sources failed');
        }
        
        if (data.current_condition) {
            // wttr.in format
            updateWeatherUIFromWttr(data);
            if (data.weather) {
                renderHourlyForecast(data.weather);
                renderDailyForecast(data.weather);
            }
        } else if (data.current) {
            // Open-Meteo format
            updateWeatherUIFromMeteo(data);
            if (data.hourly) renderHourlyForecast(data.hourly);
            if (data.daily) renderDailyForecast(data.daily);
        } else if (isBmkgWeatherData(data)) {
            updateWeatherUIFromBmkg(data);
            renderHourlyForecastFromBmkg(data);
            renderDailyForecastFromBmkg(data);
        } else if (isSevenTimerWeatherData(data)) {
            updateWeatherUIFromSevenTimer(data);
            renderHourlyForecastFromSevenTimer(data);
            renderDailyForecastFromSevenTimer(data);
        }
    } catch (err) {
        console.warn('Gagal memuat cuaca:', err);
        const tempEl = document.getElementById('weather-temp');
        const descEl = document.getElementById('weather-desc');
        if (tempEl) tempEl.textContent = '--°C';
        if (descEl) descEl.textContent = 'Gagal memuat cuaca';
        
        const hc = document.getElementById('hourly-forecast-container');
        const dc = document.getElementById('daily-forecast-container');
        if (hc) hc.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#94a3b8;padding:12px;font-size:0.9rem;">Gagal memuat prakiraan per jam</div>';
        if (dc) dc.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:12px;font-size:0.9rem;">Gagal memuat prakiraan harian</div>';
    }
}

function updateWeatherUIFromWttr(data) {
    const tempEl = document.getElementById('weather-temp');
    const descEl = document.getElementById('weather-desc');
    const locEl = document.getElementById('weather-location');
    const subEl = document.getElementById('weather-subtext');
    const humEl = document.getElementById('weather-humidity');
    const windEl = document.getElementById('weather-wind');

    const cur = data.current_condition[0];
    if (tempEl) tempEl.textContent = `${cur.temp_C}°C`;
    if (descEl) descEl.textContent = getWttrDescription(cur.weatherCode);
    if (locEl) {
        if (data.nearest_area && data.nearest_area.length > 0) {
            const area = data.nearest_area[0];
            const name = weatherLocationName || area.areaName?.[0]?.value || 'Bojongsoang';
            weatherLocationName = name;
            locEl.textContent = name;
        } else {
            weatherLocationName = weatherLocationName || 'Bojongsoang';
            locEl.textContent = weatherLocationName;
        }
    }
    if (subEl) {
        if (data.nearest_area && data.nearest_area.length > 0) {
            const area = data.nearest_area[0];
            subEl.textContent = weatherLocationSubtext || area.region?.[0]?.value || 'Jawa Barat';
        } else {
            subEl.textContent = weatherLocationSubtext || 'Jawa Barat';
        }
    }
    if (humEl) humEl.textContent = `${cur.humidity}%`;
    if (windEl) {
        const speedMs = (parseFloat(cur.windspeedKmph) / 3.6).toFixed(1);
        windEl.textContent = `${speedMs} m/s`;
    }
}

function updateWeatherUIFromMeteo(data) {
    const tempEl = document.getElementById('weather-temp');
    const descEl = document.getElementById('weather-desc');
    const locEl = document.getElementById('weather-location');
    const humEl = document.getElementById('weather-humidity');
    const windEl = document.getElementById('weather-wind');

    const current = data.current;
    if (tempEl) tempEl.textContent = `${Math.round(current.temperature_2m)}°C`;
    if (descEl) descEl.textContent = getWmoDescription(current.weather_code);
    if (locEl) locEl.textContent = weatherLocationName;
    const subEl = document.getElementById('weather-subtext');
    if (subEl) subEl.textContent = weatherLocationSubtext;
    if (humEl) humEl.textContent = `${current.relative_humidity_2m}%`;
    if (windEl) windEl.textContent = `${current.wind_speed_10m} m/s`;
}

function updateWeatherUIFromBmkg(data) {
    const tempEl = document.getElementById('weather-temp');
    const descEl = document.getElementById('weather-desc');
    const locEl = document.getElementById('weather-location');
    const subEl = document.getElementById('weather-subtext');
    const humEl = document.getElementById('weather-humidity');
    const windEl = document.getElementById('weather-wind');
    const current = getBmkgCurrentSlot(data);
    const lokasi = data.lokasi || data.data?.[0]?.lokasi || {};

    if (!current) return;
    if (tempEl) tempEl.textContent = `${Math.round(current.t)}\u00B0C`;
    if (descEl) descEl.textContent = current.weather_desc || 'Data BMKG';
    if (locEl) locEl.textContent = lokasi.kecamatan || weatherLocationName || 'Bojongsoang';
    if (subEl) subEl.textContent = [lokasi.desa, lokasi.kotkab].filter(Boolean).join(', ') || 'Data BMKG';
    if (humEl) humEl.textContent = `${current.hu}%`;
    if (windEl) windEl.textContent = `${current.ws} m/s`;
}

function updateWeatherUIFromSevenTimer(data) {
    const tempEl = document.getElementById('weather-temp');
    const descEl = document.getElementById('weather-desc');
    const locEl = document.getElementById('weather-location');
    const subEl = document.getElementById('weather-subtext');
    const humEl = document.getElementById('weather-humidity');
    const windEl = document.getElementById('weather-wind');
    const current = data.dataseries[0];

    if (!current) return;
    if (tempEl) tempEl.textContent = `${Math.round(current.temp2m)}\u00B0C`;
    if (descEl) descEl.textContent = getSevenTimerDescription(current.weather);
    if (locEl) locEl.textContent = weatherLocationName;
    if (subEl) subEl.textContent = weatherLocationSubtext;
    if (humEl) humEl.textContent = current.rh2m || '--%';
    if (windEl) windEl.textContent = `${current.wind10m?.speed ?? '--'} m/s`;
}

let _deviceWeatherRetryCount = 0;
const _DEVICE_WEATHER_MAX_RETRIES = 3;

async function fetchDeviceWeatherData() {
    try {
        let response;
        let data;

        // 1. Try Vercel Serverless Function first
        try {
            const url = `/api/weather?latitude=${LAMAJANG_LAT}&longitude=${LAMAJANG_LON}&allowBmkg=1`;
            response = await fetchWithTimeout(url, {}, 8000);
            if (response.ok) {
                data = await response.json();
            }
        } catch (e) {
            console.log('Vercel API device fetch failed:', e);
        }

        // 2. Try Open-Meteo Direct if Vercel failed
        if (!data) {
            try {
                console.log('Fetching directly from Open-Meteo for device...');
                const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAMAJANG_LAT}&longitude=${LAMAJANG_LON}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=7&wind_speed_unit=ms&timezone=Asia%2FJakarta`;
                response = await fetchWithTimeout(url, {}, 8000);
                if (response.ok) {
                    data = await response.json();
                }
            } catch (e) {
                console.log('Open-Meteo device fetch failed:', e);
            }
        }

        // 3. Official BMKG fallback for the device area
        if (!data) {
            try {
                console.log('Open-Meteo device fetch failed, falling back to BMKG Bojongsoang...');
                data = await fetchBmkgWeatherData();
            } catch (e) {
                console.log('BMKG device fetch failed:', e);
            }
        }

        // 4. Try Open-Meteo via Codetabs Proxy
        if (!data) {
            try {
                console.log('Fetching Open-Meteo via Proxy for device...');
                const rawUrl = `https://api.open-meteo.com/v1/forecast?latitude=${LAMAJANG_LAT}&longitude=${LAMAJANG_LON}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=7&wind_speed_unit=ms&timezone=Asia%2FJakarta`;
                const url = `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(rawUrl)}`;
                response = await fetchWithTimeout(url, {}, 8000);
                if (response.ok) {
                    data = await response.json();
                }
            } catch (e) {
                console.log('Open-Meteo proxy fetch failed:', e);
            }
        }

        // 5. Fallback to wttr.in if Open-Meteo completely failed
        if (!data) {
            try {
                console.log('Open-Meteo device fetch failed, falling back to wttr.in...');
                const url = `https://wttr.in/${LAMAJANG_LAT},${LAMAJANG_LON}?format=j1`;
                response = await fetchWithTimeout(url, {}, 8000);
                if (response.ok) {
                    data = await response.json();
                }
            } catch (e) {
                console.log('wttr.in device fetch failed:', e);
            }
        }

        if (!data) {
            throw new Error('All weather data sources failed');
        }
        
        // Berhasil — reset retry counter
        _deviceWeatherRetryCount = 0;

        if (data.current_condition) {
            updateDeviceWeatherUIFromWttr(data);
        } else if (data.current) {
            updateDeviceWeatherUIFromMeteo(data);
        } else if (isBmkgWeatherData(data)) {
            updateDeviceWeatherUIFromBmkg(data);
        } else if (isSevenTimerWeatherData(data)) {
            updateDeviceWeatherUIFromSevenTimer(data);
        }
    } catch (err) {
        console.warn('Gagal memuat cuaca alat:', err);
        
        // Auto-retry dengan jeda bertingkat (5s, 10s, 20s)
        if (_deviceWeatherRetryCount < _DEVICE_WEATHER_MAX_RETRIES) {
            _deviceWeatherRetryCount++;
            const delay = 5000 * Math.pow(2, _deviceWeatherRetryCount - 1);
            console.log(`Retry cuaca alat ke-${_deviceWeatherRetryCount} dalam ${delay/1000}s...`);
            
            const descEl = document.getElementById('device-weather-desc');
            if (descEl) descEl.textContent = `Mencoba ulang (${_deviceWeatherRetryCount}/${_DEVICE_WEATHER_MAX_RETRIES})...`;
            
            setTimeout(() => fetchDeviceWeatherData(), delay);
        } else {
            const tempEl = document.getElementById('device-weather-temp');
            const descEl = document.getElementById('device-weather-desc');
            if (tempEl) tempEl.textContent = '--°C';
            if (descEl) descEl.textContent = 'Gagal memuat cuaca';
        }
    }
}

function updateDeviceWeatherUIFromWttr(data) {
    const tempEl = document.getElementById('device-weather-temp');
    const descEl = document.getElementById('device-weather-desc');
    const locEl = document.getElementById('device-weather-location');
    const subEl = document.getElementById('device-weather-subtext');
    const humEl = document.getElementById('device-weather-humidity');
    const windEl = document.getElementById('device-weather-wind');

    const cur = data.current_condition[0];
    if (tempEl) tempEl.textContent = `${cur.temp_C}°C`;
    if (descEl) descEl.textContent = getWttrDescription(cur.weatherCode);
    if (locEl) locEl.textContent = 'Desa Lamajang';
    if (subEl) subEl.textContent = 'Bojongsoang, Bandung';
    if (humEl) humEl.textContent = `${cur.humidity}%`;
    if (windEl) {
        const speedMs = (parseFloat(cur.windspeedKmph) / 3.6).toFixed(1);
        windEl.textContent = `${speedMs} m/s`;
    }
}

function updateDeviceWeatherUIFromMeteo(data) {
    const tempEl = document.getElementById('device-weather-temp');
    const descEl = document.getElementById('device-weather-desc');
    const locEl = document.getElementById('device-weather-location');
    const subEl = document.getElementById('device-weather-subtext');
    const humEl = document.getElementById('device-weather-humidity');
    const windEl = document.getElementById('device-weather-wind');

    const current = data.current;
    if (tempEl) tempEl.textContent = `${Math.round(current.temperature_2m)}°C`;
    if (descEl) descEl.textContent = getWmoDescription(current.weather_code);
    if (locEl) locEl.textContent = 'Desa Lamajang';
    if (subEl) subEl.textContent = 'Bojongsoang, Bandung';
    if (humEl) humEl.textContent = `${current.relative_humidity_2m}%`;
    if (windEl) windEl.textContent = `${current.wind_speed_10m} m/s`;
}

function updateDeviceWeatherUIFromBmkg(data) {
    const tempEl = document.getElementById('device-weather-temp');
    const descEl = document.getElementById('device-weather-desc');
    const locEl = document.getElementById('device-weather-location');
    const subEl = document.getElementById('device-weather-subtext');
    const humEl = document.getElementById('device-weather-humidity');
    const windEl = document.getElementById('device-weather-wind');
    const current = getBmkgCurrentSlot(data);
    const lokasi = data.lokasi || data.data?.[0]?.lokasi || {};

    if (!current) return;
    if (tempEl) tempEl.textContent = `${Math.round(current.t)}\u00B0C`;
    if (descEl) descEl.textContent = current.weather_desc || 'Data BMKG';
    if (locEl) locEl.textContent = 'Desa Lamajang';
    if (subEl) subEl.textContent = [lokasi.kecamatan, lokasi.kotkab].filter(Boolean).join(', ') || 'Bojongsoang, Bandung';
    if (humEl) humEl.textContent = `${current.hu}%`;
    if (windEl) windEl.textContent = `${current.ws} m/s`;
}

function updateDeviceWeatherUIFromSevenTimer(data) {
    const tempEl = document.getElementById('device-weather-temp');
    const descEl = document.getElementById('device-weather-desc');
    const locEl = document.getElementById('device-weather-location');
    const subEl = document.getElementById('device-weather-subtext');
    const humEl = document.getElementById('device-weather-humidity');
    const windEl = document.getElementById('device-weather-wind');
    const current = data.dataseries[0];

    if (!current) return;
    if (tempEl) tempEl.textContent = `${Math.round(current.temp2m)}\u00B0C`;
    if (descEl) descEl.textContent = getSevenTimerDescription(current.weather);
    if (locEl) locEl.textContent = 'Desa Lamajang';
    if (subEl) subEl.textContent = 'Bojongsoang, Bandung';
    if (humEl) humEl.textContent = current.rh2m || '--%';
    if (windEl) windEl.textContent = `${current.wind10m?.speed ?? '--'} m/s`;
}

function renderHourlyForecast(hourlyOrDays) {
    if (Array.isArray(hourlyOrDays)) {
        renderHourlyForecastFromWttr(hourlyOrDays);
    } else {
        renderHourlyForecastFromMeteo(hourlyOrDays);
    }
}

function renderDailyForecast(dailyOrDays) {
    if (Array.isArray(dailyOrDays)) {
        renderDailyForecastFromWttr(dailyOrDays);
    } else {
        renderDailyForecastFromMeteo(dailyOrDays);
    }
}

function renderHourlyForecastFromWttr(weatherDays) {
    const container = document.getElementById('hourly-forecast-container');
    if (!container) return;
    container.innerHTML = '';
    const now = new Date();
    const currentHour = now.getHours();
    
    const slots = [];
    [0, 1].forEach(dayIdx => {
        if (!weatherDays[dayIdx]) return;
        const dateStr = weatherDays[dayIdx].date;
        weatherDays[dayIdx].hourly.forEach(h => {
            const slotHour = Math.floor(parseInt(h.time) / 100);
            slots.push({ dateStr, slotHour, h });
        });
    });

    const todayStr = now.toISOString().slice(0, 10);
    const future = slots.filter(s => {
        if (s.dateStr > todayStr) return true;
        if (s.dateStr === todayStr && s.slotHour >= currentHour) return true;
        return false;
    }).slice(0, 8);
    
    let delay = 0;
    future.forEach(({ slotHour, h }) => {
        const timeStr = `${String(slotHour).padStart(2, '0')}:00`;
        const temp = h.tempC || h.temp_C || '--';
        const code = h.weatherCode;
        
        const div = document.createElement('div');
        div.className = 'hourly-item fade-in-up';
        div.style.animationDelay = `${delay}s`;
        div.innerHTML = `
            <div class="hourly-time">${timeStr}</div>
            <div class="hourly-icon" style="width: 48px; height: 48px; margin-bottom: 8px;">${getWttrIconImg(code)}</div>
            <div class="hourly-temp">${temp}°</div>
        `;
        container.appendChild(div);
        delay += 0.1;
    });
}

function renderHourlyForecastFromMeteo(hourly) {
    const container = document.getElementById('hourly-forecast-container');
    if (!container) return;
    container.innerHTML = '';
    const now = new Date();
    
    let startIndex = 0;
    for (let i = 0; i < hourly.time.length; i++) {
        const time = new Date(hourly.time[i]);
        if (time >= now) {
            startIndex = i;
            break;
        }
    }
    
    let delay = 0;
    for (let i = startIndex; i < startIndex + 24 && i < hourly.time.length; i += 3) {
        const time = new Date(hourly.time[i]);
        const timeStr = time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
        const temp = Math.round(hourly.temperature_2m[i]);
        const code = hourly.weather_code[i];
        
        const div = document.createElement('div');
        div.className = 'hourly-item fade-in-up';
        div.style.animationDelay = `${delay}s`;
        div.innerHTML = `
            <div class="hourly-time">${timeStr}</div>
            <div class="hourly-icon" style="width: 48px; height: 48px; margin-bottom: 8px;">${getWmoIconImg(code)}</div>
            <div class="hourly-temp">${temp}°</div>
        `;
        container.appendChild(div);
        delay += 0.1;
    }
}

function renderHourlyForecastFromBmkg(data) {
    const container = document.getElementById('hourly-forecast-container');
    if (!container) return;
    container.innerHTML = '';

    const now = Date.now();
    const slots = getBmkgSlots(data)
        .filter(slot => getBmkgDate(slot).getTime() >= now)
        .slice(0, 8);

    let delay = 0;
    slots.forEach(slot => {
        const timeStr = getBmkgDate(slot).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
        const temp = Math.round(slot.t);

        const div = document.createElement('div');
        div.className = 'hourly-item fade-in-up';
        div.style.animationDelay = `${delay}s`;
        div.innerHTML = `
            <div class="hourly-time">${timeStr}</div>
            <div class="hourly-icon" style="width: 48px; height: 48px; margin-bottom: 8px;">${getBmkgIconImg(slot)}</div>
            <div class="hourly-temp">${temp}\u00B0</div>
        `;
        container.appendChild(div);
        delay += 0.1;
    });
}

function renderHourlyForecastFromSevenTimer(data) {
    const container = document.getElementById('hourly-forecast-container');
    if (!container) return;
    container.innerHTML = '';

    let delay = 0;
    data.dataseries.slice(0, 8).forEach(slot => {
        const timeStr = getSevenTimerDate(data, slot).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
        const temp = Math.round(slot.temp2m);

        const div = document.createElement('div');
        div.className = 'hourly-item fade-in-up';
        div.style.animationDelay = `${delay}s`;
        div.innerHTML = `
            <div class="hourly-time">${timeStr}</div>
            <div class="hourly-icon" style="width: 48px; height: 48px; margin-bottom: 8px;">${getSevenTimerIconImg(slot.weather)}</div>
            <div class="hourly-temp">${temp}\u00B0</div>
        `;
        container.appendChild(div);
        delay += 0.1;
    });
}

function renderDailyForecastFromWttr(weatherDays) {
    const container = document.getElementById('daily-forecast-container');
    if (!container) return;
    container.innerHTML = '';
    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    
    let delay = 0;
    weatherDays.forEach((day, i) => {
        const date = new Date(day.date);
        const isToday = i === 0;
        const dayName = isToday ? 'Hari Ini' : (i === 1 ? 'Besok' : dayNames[date.getDay()]);
        const min = day.mintempC;
        const max = day.maxtempC;
        const code = day.hourly?.[4]?.weatherCode || day.hourly?.[0]?.weatherCode || 113;
        
        const div = document.createElement('div');
        div.className = 'daily-item fade-in-up';
        div.style.animationDelay = `${delay}s`;
        div.innerHTML = `
            <div class="daily-day" style="flex: 1;">${dayName}</div>
            <div class="daily-icon" style="width: 32px; height: 32px;">${getWttrIconImg(code)}</div>
            <div class="daily-desc" style="flex: 1.5; padding-left: 10px; font-size: 0.85rem; color: #1e293b; font-weight: 600;">${getWttrDescription(code)}</div>
            <div class="daily-temps" style="flex: 1; text-align: right; justify-content: flex-end;">
                <span class="temp-min">${min}°</span>
                <span class="temp-max">${max}°</span>
            </div>
        `;
        container.appendChild(div);
        delay += 0.1;
    });
}

function renderDailyForecastFromBmkg(data) {
    const container = document.getElementById('daily-forecast-container');
    if (!container) return;
    container.innerHTML = '';

    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const grouped = new Map();
    getBmkgSlots(data).forEach(slot => {
        const date = getBmkgDate(slot);
        const key = date.toISOString().slice(0, 10);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(slot);
    });

    let delay = 0;
    Array.from(grouped.entries()).slice(0, 7).forEach(([dateKey, slots], i) => {
        const date = new Date(`${dateKey}T00:00:00+07:00`);
        const temps = slots.map(slot => Number(slot.t)).filter(Number.isFinite);
        const min = Math.round(Math.min(...temps));
        const max = Math.round(Math.max(...temps));
        const representative = slots[Math.min(3, slots.length - 1)] || slots[0];
        const isToday = i === 0;
        const dayName = isToday ? 'Hari Ini' : days[date.getDay()];

        const div = document.createElement('div');
        div.className = 'daily-item fade-in-up';
        div.style.animationDelay = `${delay}s`;
        div.innerHTML = `
            <div class="daily-day" style="flex: 1;">${dayName}</div>
            <div class="daily-icon" style="width: 32px; height: 32px;">${getBmkgIconImg(representative)}</div>
            <div class="daily-desc" style="flex: 1.5; padding-left: 10px; font-size: 0.85rem; color: #1e293b; font-weight: 600;">${representative.weather_desc || 'Data BMKG'}</div>
            <div class="daily-temps" style="flex: 1; text-align: right; justify-content: flex-end;">
                <span class="temp-min">${min}\u00B0</span>
                <span class="temp-max">${max}\u00B0</span>
            </div>
        `;
        container.appendChild(div);
        delay += 0.1;
    });
}

function renderDailyForecastFromSevenTimer(data) {
    const container = document.getElementById('daily-forecast-container');
    if (!container) return;
    container.innerHTML = '';

    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const grouped = new Map();
    data.dataseries.forEach(slot => {
        const date = getSevenTimerDate(data, slot);
        const key = date.toISOString().slice(0, 10);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(slot);
    });

    let delay = 0;
    Array.from(grouped.entries()).slice(0, 7).forEach(([dateKey, slots], i) => {
        const date = new Date(`${dateKey}T00:00:00`);
        const temps = slots.map(slot => Number(slot.temp2m)).filter(Number.isFinite);
        const min = Math.round(Math.min(...temps));
        const max = Math.round(Math.max(...temps));
        const representative = slots[Math.min(3, slots.length - 1)] || slots[0];
        const dayName = i === 0 ? 'Hari Ini' : (i === 1 ? 'Besok' : days[date.getDay()]);

        const div = document.createElement('div');
        div.className = 'daily-item fade-in-up';
        div.style.animationDelay = `${delay}s`;
        div.innerHTML = `
            <div class="daily-day" style="flex: 1;">${dayName}</div>
            <div class="daily-icon" style="width: 32px; height: 32px;">${getSevenTimerIconImg(representative.weather)}</div>
            <div class="daily-desc" style="flex: 1.5; padding-left: 10px; font-size: 0.85rem; color: #1e293b; font-weight: 600;">${getSevenTimerDescription(representative.weather)}</div>
            <div class="daily-temps" style="flex: 1; text-align: right; justify-content: flex-end;">
                <span class="temp-min">${min}\u00B0</span>
                <span class="temp-max">${max}\u00B0</span>
            </div>
        `;
        container.appendChild(div);
        delay += 0.1;
    });
}

function renderDailyForecastFromMeteo(daily) {
    const container = document.getElementById('daily-forecast-container');
    if (!container) return;
    container.innerHTML = '';
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    
    let delay = 0;
    for (let i = 0; i < Math.min(7, daily.time.length); i++) {
        const date = new Date(daily.time[i]);
        const isToday = i === 0;
        const dayName = isToday ? 'Hari Ini' : days[date.getDay()];
        const min = Math.round(daily.temperature_2m_min[i]);
        const max = Math.round(daily.temperature_2m_max[i]);
        const code = daily.weather_code[i];
        
        const div = document.createElement('div');
        div.className = 'daily-item fade-in-up';
        div.style.animationDelay = `${delay}s`;
        div.innerHTML = `
            <div class="daily-day" style="flex: 1;">${dayName}</div>
            <div class="daily-icon" style="width: 32px; height: 32px;">${getWmoIconImg(code)}</div>
            <div class="daily-desc" style="flex: 1.5; padding-left: 10px; font-size: 0.85rem; color: #1e293b; font-weight: 600;">${getWmoDescription(code)}</div>
            <div class="daily-temps" style="flex: 1; text-align: right; justify-content: flex-end;">
                <span class="temp-min">${min}°</span>
                <span class="temp-max">${max}°</span>
            </div>
        `;
        container.appendChild(div);
        delay += 0.1;
    }
}

function startWeatherListener() {
    fetchDeviceWeatherData();
    // Cuaca dinamis dan peta diinisialisasi saat tab Cuaca dibuka pertama kali (di ui.js)
    if (weatherIntervalTimer) clearInterval(weatherIntervalTimer);
    weatherIntervalTimer = setInterval(() => {
        fetchDeviceWeatherData();
        if (typeof monitoringMap !== 'undefined' && monitoringMap) {
            fetchWeatherData(weatherLat, weatherLon);
        }
    }, 30 * 60 * 1000);
}

function initMonitoringMap() {
    const mapContainer = document.getElementById('monitoring-map');
    if (!mapContainer) return;

    if (monitoringMap) {
        monitoringMap.remove();
        monitoringMap = null;
    }

    monitoringMap = L.map('monitoring-map', {
        zoomControl: true,
        scrollWheelZoom: false
    }).setView([weatherLat, weatherLon], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(monitoringMap);

    // Fix popup margin (agar tidak nabrak tombol X)
    const style = document.createElement('style');
    style.textContent = '.leaflet-popup-content { margin: 12px 28px 12px 16px !important; }';
    document.head.appendChild(style);

    // Icon pin biru (sensor statis)
    const sensorIcon = L.divIcon({
        html: `<div class="map-pin-pulse">
                 <div class="pulse blue-pulse"></div>
                 <svg viewBox="0 0 24 24" class="map-pin-svg blue-pin">
                   <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                 </svg>
               </div>`,
        className: 'custom-div-icon sensor-pin',
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        popupAnchor: [0, -32]
    });

    // Icon pin merah (cuaca dinamis)
    const weatherIcon = L.divIcon({
        html: `<div class="map-pin-pulse">
                 <div class="pulse red-pulse"></div>
                 <svg viewBox="0 0 24 24" class="map-pin-svg red-pin">
                   <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                 </svg>
               </div>`,
        className: 'custom-div-icon weather-pin',
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        popupAnchor: [0, -32]
    });

    // Pin biru: Sensor statis Desa Lamajang
    const sensorMarker = L.marker([LAMAJANG_LAT, LAMAJANG_LON], { icon: sensorIcon }).addTo(monitoringMap);
    sensorMarker.bindPopup(`
        <div style="font-family:'Outfit',sans-serif;text-align:center;">
            <strong style="color:#0ea5e9;font-size:0.9rem;">📍 Sensor Tinggi Air</strong><br>
            <span style="font-size:0.8rem;font-weight:600;color:#475569;">Desa Lamajang</span><br>
            <small style="color:#94a3b8;display:block;margin-top:4px;">Bojongsoang, Bandung</small>
        </div>`);

    // Pin merah: Cuaca dinamis (draggable)
    weatherMarker = L.marker([weatherLat, weatherLon], { icon: weatherIcon, draggable: true }).addTo(monitoringMap);
    weatherMarker.bindPopup(`<div style="font-family:'Outfit',sans-serif;text-align:center;font-weight:600;font-size:0.9rem;">${weatherLocationName}</div>`).openPopup();

    const bounds = L.latLngBounds([[LAMAJANG_LAT, LAMAJANG_LON], [weatherLat, weatherLon]]);
    monitoringMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });

    async function updateWeatherPoint(lat, lon, options = {}) {
        weatherLat = lat;
        weatherLon = lon;
        weatherMarker.setLatLng([lat, lon]);
        if (options.flyTo) monitoringMap.flyTo([lat, lon], 13);
        setWeatherLoadingState();
        await updateWeatherLocationFromCoords(lat, lon);
        weatherMarker.setPopupContent(`<div style="font-family:'Outfit',sans-serif;text-align:center;font-weight:600;font-size:0.9rem;">${weatherLocationName}</div>`).openPopup();
        await fetchWeatherData(lat, lon);
        weatherMarker.setPopupContent(`<div style="font-family:'Outfit',sans-serif;text-align:center;font-weight:600;font-size:0.9rem;">${weatherLocationName}</div>`).openPopup();
    }

    // Drag pin merah → update cuaca
    weatherMarker.on('dragend', async function() {
        const pos = weatherMarker.getLatLng();
        await updateWeatherPoint(pos.lat, pos.lng);
    });

    // Klik peta → pindahkan pin merah
    monitoringMap.on('click', async function(e) {
        await updateWeatherPoint(e.latlng.lat, e.latlng.lng);
    });

    // Pencarian lokasi
    const searchBtn   = document.getElementById('btn-map-search');
    const searchInput = document.getElementById('map-search-input');

    async function handleMapSearch() {
        const query = searchInput ? searchInput.value.trim() : '';
        if (!query) return;
        const origText = searchBtn ? searchBtn.textContent : '';
        if (searchBtn) { searchBtn.textContent = '⏳'; searchBtn.disabled = true; }

        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
            const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'safe-floodmonitor/1.0' } }, 6000);
            const data = await res.json();
            if (data && data.length > 0) {
                const newLat = parseFloat(data[0].lat);
                const newLon = parseFloat(data[0].lon);
                const location = formatNominatimLocation(data[0]);
                weatherLocationName = location.name;
                weatherLocationSubtext = location.subtext;
                await updateWeatherPoint(newLat, newLon, { flyTo: true });
            } else {
                alert('Lokasi tidak ditemukan. Coba nama kota/kecamatan lain.');
            }
        } catch (err) {
            console.warn('Pencarian gagal:', err);
            alert('Gagal mencari lokasi. Periksa koneksi internet.');
        } finally {
            if (searchBtn) { searchBtn.textContent = origText; searchBtn.disabled = false; }
        }
    }

    if (searchBtn) searchBtn.addEventListener('click', handleMapSearch);
    if (searchInput) searchInput.addEventListener('keypress', e => { if (e.key === 'Enter') handleMapSearch(); });

    // Muat cuaca awal untuk wilayah default
    fetchWeatherData(weatherLat, weatherLon);
    fetchWeatherNews();
}

// ─────────────────────────────────────────────
// START: Listener utama untuk data sensor & grafik
// ─────────────────────────────────────────────
function startDataListener() {
    if (!database) return;

    // Inisialisasi lastSavedChartTimestamp dari entri terakhir di database
    database.ref(CHART_HISTORY_PATH).orderByKey().limitToLast(1).once('value', (snapshot) => {
        snapshot.forEach(child => {
            const lastTs = parseInt(child.key);
            if (!isNaN(lastTs)) {
                lastSavedChartTimestamp = lastTs;
            }
        });
    });

    // Listener Konfigurasi Kalibrasi OTA
    database.ref('sensor_data/config').on('value', (snap) => {
        const conf = snap.val();
        if (conf) {
            THRESHOLDS.MAX_TANK = conf.max_height || 400;
            THRESHOLDS.SIAGA1 = conf.siaga1 || 200;
            THRESHOLDS.SIAGA2 = conf.siaga2 || 300;
            
            // Update buzzer status badge (User View)
            const buzzerBadge = document.getElementById('buzzer-status-badge');
            if (buzzerBadge) {
                const bMode = conf.buzzer_mode !== undefined ? Number(conf.buzzer_mode) : 1; // default otomatis
                buzzerBadge.className = 'buzzer-badge'; // reset
                if (bMode === 0) {
                    buzzerBadge.classList.add('status-mute');
                    buzzerBadge.textContent = '🔇 Buzzer: Senyap';
                } else if (bMode === 2) {
                    buzzerBadge.classList.add('status-test');
                    buzzerBadge.textContent = '🚨 Buzzer: Tes Hardware';
                } else {
                    buzzerBadge.classList.add('status-otomatis');
                    buzzerBadge.textContent = '🔊 Buzzer: Otomatis';
                }
            }
            
            // Isi form OTA admin jika ada dan sedang tidak diketik
            const inH = document.getElementById('ota-max-height');
            if (inH && document.activeElement !== inH) {
                inH.value = conf.max_height;
                document.getElementById('ota-siaga1').value = conf.siaga1;
                document.getElementById('ota-siaga2').value = conf.siaga2;
                
                const inBuzzer = document.getElementById('ota-buzzer-mode');
                if (inBuzzer) {
                    inBuzzer.value = conf.buzzer_mode !== undefined ? conf.buzzer_mode : 1;
                }
            }

            // Langsung perbarui UI untuk merespon perubahan batas
            if (currentWaterLevel !== null) updateUI(currentWaterLevel);

            // Update batas maksimum dan garis batas pada grafik secara dinamis
            if (waterChart) {
                waterChart.options.scales.y.max = THRESHOLDS.MAX_TANK;
                waterChart.options.scales.y.ticks.stepSize = Math.ceil(THRESHOLDS.MAX_TANK / 4);
                waterChart.update();
            }
            if (historyChart) {
                historyChart.options.scales.y.max = THRESHOLDS.MAX_TANK;
                historyChart.options.scales.y.ticks.stepSize = Math.ceil(THRESHOLDS.MAX_TANK / 4);

                // Hitung ulang warna bar secara dinamis berdasarkan batas baru
                const hourlyValues = historyChart.data.datasets[0].data || [];
                const colors = hourlyValues.map(v => {
                    if (v >= THRESHOLDS.SIAGA2) return 'rgba(239, 68, 68, 0.8)'; // Merah
                    if (v >= THRESHOLDS.SIAGA1) return 'rgba(245, 158, 11, 0.8)'; // Kuning
                    return 'rgba(14, 165, 233, 0.6)'; // Biru
                });
                historyChart.data.datasets[0].backgroundColor = colors;

                historyChart.update();
            }
        }
    });

    // Handle Simpan OTA (Kalibrasi Air)
    document.addEventListener('click', (e) => {
        if (e.target.id === 'btn-save-ota') {
            const maxH = parseInt(document.getElementById('ota-max-height').value);
            const s1 = parseInt(document.getElementById('ota-siaga1').value);
            const s2 = parseInt(document.getElementById('ota-siaga2').value);
            const msg = document.getElementById('ota-status-msg');
            
            if (isNaN(maxH) || isNaN(s1) || isNaN(s2)) {
                msg.textContent = 'Harap isi semua kolom kalibrasi dengan benar!';
                msg.style.color = 'red';
                msg.style.display = 'block';
                return;
            }
            
            if (maxH <= 0 || s1 <= 0 || s2 <= 0) {
                msg.textContent = 'Semua nilai kalibrasi harus lebih besar dari 0!';
                msg.style.color = 'red';
                msg.style.display = 'block';
                return;
            }
            
            if (s1 >= s2) {
                msg.textContent = 'Batas Siaga 1 harus lebih kecil dari Batas Siaga 2!';
                msg.style.color = 'red';
                msg.style.display = 'block';
                return;
            }
            
            if (s2 >= maxH) {
                msg.textContent = 'Batas Siaga 2 harus lebih kecil dari Tinggi Tangki Maksimal!';
                msg.style.color = 'red';
                msg.style.display = 'block';
                return;
            }
            
            msg.textContent = 'Mengirim perintah kalibrasi air...';
            msg.style.color = '#3b82f6';
            msg.style.display = 'block';
            
            database.ref('sensor_data/config').update({
                max_height: maxH,
                siaga1: s1,
                siaga2: s2
            }).then(() => {
                msg.style.display = 'none';
                showSuccessModal('Berhasil', 'Kalibrasi air berhasil!');
            }).catch(err => {
                msg.textContent = 'Gagal menyimpan kalibrasi: ' + err.message;
                msg.style.color = 'red';
            });
        }
        
        // Handle Simpan Mode Buzzer
        if (e.target.id === 'btn-save-buzzer') {
            const buzzerModeVal = parseInt(document.getElementById('ota-buzzer-mode').value);
            const msg = document.getElementById('buzzer-status-msg');
            
            if (isNaN(buzzerModeVal)) {
                msg.textContent = 'Harap pilih mode buzzer yang valid!';
                msg.style.color = 'red';
                msg.style.display = 'block';
                return;
            }
            
            msg.textContent = 'Mengirim pengaturan buzzer...';
            msg.style.color = '#3b82f6';
            msg.style.display = 'block';
            
            database.ref('sensor_data/config').update({
                buzzer_mode: buzzerModeVal
            }).then(() => {
                msg.style.display = 'none';
                showSuccessModal('Berhasil', 'Mode buzzer berhasil diperbarui!');
            }).catch(err => {
                msg.textContent = 'Gagal menyimpan mode buzzer: ' + err.message;
                msg.style.color = 'red';
            });
        }
    });

    // 0. Mulai fetch cuaca
    startWeatherListener();

    // 1. Real-time listener grafik
    startChartHistoryListener();

    // 2. Auto-save timer tiap 15 menit
    startChartAutoSaveTimer();

    // 3. Mulai offline detector (polling setiap 60 detik)
    startOfflineDetector();

    // 4. Real-time listener data sensor
    const waterLevelRef = database.ref('sensor_data/water_level');
    waterLevelRef.on('value', (snapshot) => {
        const data = snapshot.val();
        if (data === null) return;

        const finalLevel = Number(data);
        currentWaterLevel = finalLevel;
        
        // Langsung set ONLINE jika data masuk
        if (isSensorOffline) setOfflineState(false);
        
        updateUI(finalLevel);

        // Hanya simpan data jika sensor online
        if (!isSensorOffline) {
            // 5. Smart save chart (maks 1x per 15 menit)
            maybeSaveChartPoint(finalLevel);
            
            // 6. Hourly data save (Mencatat setiap jam)
            saveHourlyData(finalLevel);
        }
    });

    // 5. Sync Firebase Server Time Offset
    database.ref('.info/serverTimeOffset').on('value', (snap) => {
        serverTimeOffset = snap.val() || 0;
    });

    // 6. Real-time listener untuk sinkronisasi status offline awal
    database.ref('sensor_data/ts').on('value', (snap) => {
        const ts = snap.val();
        if (!ts) return;

        const serverTime = Date.now() + serverTimeOffset;
        const diff = serverTime - ts;

        // Jika data di DB sudah lebih dari batas toleransi, 
        // berarti saat ini sensor sudah offline (menggunakan server time synced dengan toleransi)
        if (diff > OFFLINE_THRESHOLD_MS) {
            setOfflineState(true, null, ts);
        } else {
            if (isSensorOffline) setOfflineState(false);
        }
    });
}

