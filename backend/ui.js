// Generic UI Navigation & DOM bindings
function bindDOM() {
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(nav => nav.classList.remove('active'));
            views.forEach(view => view.classList.remove('active'));

            item.classList.add('active');
            const targetId = item.getAttribute('data-target');
            const targetEl = document.getElementById(targetId);
            if(targetEl) targetEl.classList.add('active');
        });
    });
}

// Custom Modal Logic
function showCustomModal(level, title, message) {
    const modal = document.getElementById('custom-modal');
    const header = document.getElementById('modal-header');
    const titleEl = document.getElementById('modal-title');
    const descEl = document.getElementById('modal-desc');

    if (!modal) return;

    titleEl.textContent = title;
    descEl.textContent = message;

    header.className = 'custom-modal-header';
    if (level === 'SIAGA1') {
        header.classList.add('siaga1');
    } else {
        header.classList.add('siaga2');
    }

    modal.classList.add('show');
}

function closeCustomModal() {
    const modal = document.getElementById('custom-modal');
    if (modal) modal.classList.remove('show');
}

// Success Modal Logic
function showSuccessModal(title, message) {
    const modal = document.getElementById('success-modal');
    const titleEl = document.getElementById('success-modal-title');
    const descEl = document.getElementById('success-modal-desc');

    if (!modal) return;

    titleEl.textContent = title;
    descEl.textContent = message;
    modal.classList.add('show');

    setTimeout(() => {
        closeSuccessModal();
    }, 3500);
}

function closeSuccessModal(event) {
    const modal = document.getElementById('success-modal');
    if (modal) modal.classList.remove('show');
}

// Global Notification Function
function sendNotification(title, options) {
    if ("Notification" in window) {
        if (Notification.permission === "granted") {
            new Notification(title, options);
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(function (permission) {
                if (permission === "granted") {
                    new Notification(title, options);
                }
            });
        }
    }
}
