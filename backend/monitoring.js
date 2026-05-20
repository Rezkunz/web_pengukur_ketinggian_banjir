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

        // Toleransi toleran 60 detik (mengakomodasi interval heartbeat 3 detik + jeda transmisi WiFi)
        // Menjamin tidak akan ada false offline (notif kedap-kedip) karena gangguan jaringan kecil.
        const isOffline = (diff > 60 * 1000);

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
const WEATHER_LAT = '-6.984213743617759';
const WEATHER_LON = '107.62672849717276';
let weatherIntervalTimer = null;

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

async function fetchWeatherNews() {
    const container = document.getElementById('weather-news-container');
    const badge = document.getElementById('news-refresh-badge');
    if (!container) return;

    // Google News RSS via rss2json — query khusus: banjir, cuaca ekstrem, bandung
    const rssUrl = encodeURIComponent('https://news.google.com/rss/search?q=banjir+OR+%22cuaca+ekstrem%22+OR+%22banjir+bandung%22+OR+bmkg&hl=id&gl=ID&ceid=ID:id');
    const url = `https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}`;

    try {
        const response = await fetch(url);
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

async function fetchWeatherData() {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&wind_speed_unit=ms&timezone=Asia%2FJakarta`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        if (data && data.current) {
            updateWeatherUI(data);
            if (data.hourly) renderHourlyForecast(data.hourly);
            if (data.daily) renderDailyForecast(data.daily);
        }
    } catch (err) {
        console.warn('Gagal memuat cuaca:', err);
        const descEl = document.getElementById('weather-desc');
        if (descEl) descEl.textContent = 'Gagal memuat cuaca';
    }
}

function updateWeatherUI(data) {
    const tempEl = document.getElementById('weather-temp');
    const descEl = document.getElementById('weather-desc');
    const locEl = document.getElementById('weather-location');
    const humEl = document.getElementById('weather-humidity');
    const windEl = document.getElementById('weather-wind');

    const current = data.current;
    
    if (tempEl) tempEl.textContent = `${Math.round(current.temperature_2m)}°C`;
    
    if (descEl) {
        descEl.textContent = getWmoDescription(current.weather_code);
    }
    
    if (locEl) locEl.textContent = 'Bojongsoang';
    
    if (humEl) humEl.textContent = `${current.relative_humidity_2m}%`;
    if (windEl) windEl.textContent = `${current.wind_speed_10m} m/s`;
}

function renderHourlyForecast(hourly) {
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

function renderDailyForecast(daily) {
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
    fetchWeatherData();
    fetchWeatherNews();
    // Update setiap 30 menit
    if (weatherIntervalTimer) clearInterval(weatherIntervalTimer);
    weatherIntervalTimer = setInterval(() => {
        fetchWeatherData();
        fetchWeatherNews();
    }, 30 * 60 * 1000);
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
            
            // Isi form OTA admin jika ada dan sedang tidak diketik
            const inH = document.getElementById('ota-max-height');
            if (inH && document.activeElement !== inH) {
                inH.value = conf.max_height;
                document.getElementById('ota-siaga1').value = conf.siaga1;
                document.getElementById('ota-siaga2').value = conf.siaga2;
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

    // Handle Simpan OTA
    document.addEventListener('click', (e) => {
        if (e.target.id === 'btn-save-ota') {
            const maxH = parseInt(document.getElementById('ota-max-height').value);
            const s1 = parseInt(document.getElementById('ota-siaga1').value);
            const s2 = parseInt(document.getElementById('ota-siaga2').value);
            const msg = document.getElementById('ota-status-msg');
            
            if (!maxH || !s1 || !s2) {
                msg.textContent = 'Harap isi semua kolom dengan angka!';
                msg.style.color = 'red';
                msg.style.display = 'block';
                return;
            }
            
            msg.textContent = 'Mengirim perintah kalibrasi OTA...';
            msg.style.color = '#3b82f6';
            msg.style.display = 'block';
            
            database.ref('sensor_data/config').set({
                max_height: maxH,
                siaga1: s1,
                siaga2: s2
            }).then(() => {
                msg.textContent = 'Kalibrasi berhasil! NodeMCU & Web sudah beradaptasi.';
                msg.style.color = 'green';
                setTimeout(() => msg.style.display = 'none', 5000);
            }).catch(err => {
                msg.textContent = 'Gagal mengirim OTA: ' + err.message;
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

        // Jika data di DB sudah lebih dari 60 detik yang lalu, 
        // berarti saat ini sensor sudah offline (menggunakan server time synced dengan toleransi 60 detik)
        if (diff > 60 * 1000) {
            setOfflineState(true, null, ts);
        } else {
            if (isSensorOffline) setOfflineState(false);
        }
    });
}

