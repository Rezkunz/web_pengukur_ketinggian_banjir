const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://safe-93f61-default-rtdb.asia-southeast1.firebasedatabase.app"
});

const db = admin.database();

db.ref('sensor_data').once('value').then(snap => {
    console.log(JSON.stringify(snap.val(), null, 2));
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
