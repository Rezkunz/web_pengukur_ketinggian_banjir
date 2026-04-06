// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyChO4h8v33LB_ovIXcBg-yVJrmN40N0WUk",
    authDomain: "safe-93f61.firebaseapp.com",
    projectId: "safe-93f61",
    storageBucket: "safe-93f61.firebasestorage.app",
    messagingSenderId: "323210012333",
    appId: "1:323210012333:web:3704c556377b5a45600824",
    measurementId: "G-HSWSEVKJD1",
    databaseURL: "https://safe-93f61-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

// Global Firebase Objects
let firebaseApp;
let database;
let auth;

try {
    firebaseApp = firebase.initializeApp(firebaseConfig);
    database = firebase.database();
    auth = firebase.auth();
} catch (error) {
    console.error("Firebase Error:", error);
}

// Connection State Listener
document.addEventListener('DOMContentLoaded', () => {
    const connectionDotEl = document.querySelector('.dot');
    const statusTextEl = document.getElementById('status-text');
    
    if (database) {
        database.ref(".info/connected").on("value", (snap) => {
            if(connectionDotEl) {
                if (snap.val() === true) {
                    connectionDotEl.className = 'dot connected';
                    if(statusTextEl) statusTextEl.textContent = 'Terhubung';
                } else {
                    connectionDotEl.className = 'dot';
                    if(statusTextEl) statusTextEl.textContent = 'Menghubungkan...';
                }
            }
        });
    }
});
