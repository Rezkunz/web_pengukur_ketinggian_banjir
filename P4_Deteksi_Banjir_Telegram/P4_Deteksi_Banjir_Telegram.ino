/*********************************************
  Program : Deteksi Banjir - Firebase RTDB Only (Real-Time Responsif)
  Output  : LCD, Firebase RTDB
*********************************************/ 
#include <ESP8266WiFi.h> 
#include <LiquidCrystal_I2C.h>
#include <FirebaseESP8266.h>

// Konfigurasi WiFi
char ssid[] = "Ciganitiry"; 
char pass[] = "Mabelku18";   


// Konfigurasi Firebase Anda
#define FIREBASE_HOST "safe-93f61-default-rtdb.asia-southeast1.firebasedatabase.app"
#define FIREBASE_API_KEY "AIzaSyChO4h8v33LB_ovIXcBg-yVJrmN40N0WUk"
#define DEVICE_EMAIL "device@safe.id"
#define DEVICE_PASSWORD "device_safe_123" // Ganti dengan password yang Anda buat di Firebase Auth

// Variabel Firebase
FirebaseData fbdo;
FirebaseAuth auth_fb;
FirebaseConfig config_fb;

// Inisialisasi Perangkat
LiquidCrystal_I2C lcd(0x27, 16, 2);
const int trigPin = 14; // Pin D5 pada NodeMCU
const int echoPin = 12; // Pin D6 pada NodeMCU
const int buzzerPin = 13; // Pin D7 pada NodeMCU

#define SOUND_VELOCITY 0.034
long duration;
int d_cm;
int H = 400;          // Default Tinggi tangki, akan di-overwrite oleh OTA
int level;            // Tinggi air dalam cm = H - d_cm (sensor menghadap ke BAWAH)
int s1 = 0, s2 = 0; 
String status;

// Variabel Ambang Ketinggian Air OTA (Default Pengmas, akan di-overwrite oleh OTA)
int LEVEL_SIAGA1 = 200; 
int LEVEL_SIAGA2 = 300; 
int buzzerMode = 1;      // Default: 1 (Otomatis)

// Variabel Non-blocking beeping buzzer
unsigned long lastBuzzerToggle = 0;
bool buzzerState = false; 
String lastBuzzerStatus = "Aman";
unsigned long statusChangeTime = 0;
const unsigned long buzzerTimeout = 120000; // 2 menit timeout untuk auto-silence alarm
 

void baca_level(int median_d);

// Timer & Variabel Filter Penstabil Sinyal
unsigned long lastSensorRead = 0;
const unsigned long sensorInterval = 80;       // Baca sensor setiap 80ms (Super Real-time & Responsif)
unsigned long lastHeartbeatUpdate = 0;
const unsigned long heartbeatInterval = 3000;  // Kirim detak jantung setiap 3 detik jika air tenang
unsigned long lastFirebaseTxTime = 0;          // Catat waktu kirim WiFi terakhir untuk cooldown tegangan
unsigned long lastOtaCheck = 0;
const unsigned long otaInterval = 2000;       // Cek OTA setiap 2 detik (sangat responsif & real-time)

// Buffer untuk Moving Median
int samples[3] = {0, 0, 0};
int sampleIdx = 0;

// Throttling Firebase (Mencegah spam write fluktuasi kecil)
unsigned long lastFirebaseWrite = 0;
const unsigned long firebaseWriteInterval = 1500; // Kirim fluktuasi kecil maksimal tiap 1.5 detik
unsigned long lastFirebaseLevelWrite = 0;
const unsigned long firebaseForceWriteInterval = 300000; // Force write level minimal setiap 5 menit (300,000 ms)
unsigned long lastSuccessfulTxTime = 0; // Catat waktu komunikasi Firebase terakhir yang berhasil

int ukur_satu(); // Deklarasi fungsi ukur

void setup() {
  Serial.begin(115200); 
  pinMode(trigPin, OUTPUT); 
  pinMode(echoPin, INPUT);
  pinMode(buzzerPin, OUTPUT);
  digitalWrite(buzzerPin, LOW);

  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.print("  Sistem Aktif  ");
  lcd.setCursor(0,1);
  lcd.print("  Cek WiFi...   ");

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, pass);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  lcd.clear();
  lcd.print("Koneksi Sukses!");
  delay(1000);


  
  // Inisialisasi Firebase SECURE (Email/Password)
  lcd.clear();
  lcd.print("Auth Firebase...");
  
  // WAJIB panggil ini SEBELUM Firebase.begin() untuk mencegah Crash/Mentok karena kehabisan RAM!
  fbdo.setBSSLBufferSize(1024, 1024);
  
  config_fb.database_url = FIREBASE_HOST;
  config_fb.api_key = FIREBASE_API_KEY;
  auth_fb.user.email = DEVICE_EMAIL;
  auth_fb.user.password = DEVICE_PASSWORD;
  
  Firebase.begin(&config_fb, &auth_fb);
  Firebase.reconnectWiFi(true); 

  // --- DOWNLOAD KONFIGURASI OTA (Over-The-Air) DARI FIREBASE ---
  lcd.clear();
  lcd.print("Kalibrasi OTA...");
  if (Firebase.getJSON(fbdo, "/sensor_data/config")) {
    FirebaseJson &json = fbdo.jsonObject();
    FirebaseJsonData data;
    
    if (json.get(data, "/max_height") && data.success && data.type == "int") {
      H = data.intValue;
    }
    if (json.get(data, "/siaga1") && data.success && data.type == "int") {
      LEVEL_SIAGA1 = data.intValue;
    }
    if (json.get(data, "/siaga2") && data.success && data.type == "int") {
      LEVEL_SIAGA2 = data.intValue;
    }
    if (json.get(data, "/buzzer_mode") && data.success && data.type == "int") {
      buzzerMode = data.intValue;
    }
  }
  
  // Isi buffer sampel awal untuk sensor
  for (int i = 0; i < 3; i++) {
    samples[i] = ukur_satu();
    delay(60);
  }
  
  lcd.clear();
  lcd.print("Level=");
  lcd.setCursor(0,1);
  lcd.print("Status:");
  lastSuccessfulTxTime = millis(); // Mulai hitung watchdog dari akhir setup
}

int lastSentLevel = -999;
String lastStatus = "";

void loop() { 
  yield(); // Beri napas pada ESP8266 agar terhindar dari WDT Reset

  // 1. Baca 1 sampel sensor setiap 80ms, HANYA jika tegangan sudah stabil (minimal 50ms setelah transmisi WiFi terakhir)
  if (millis() - lastSensorRead >= sensorInterval && millis() - lastFirebaseTxTime >= 50) {
    lastSensorRead = millis();
    int new_sample = ukur_satu();
    
    // Validasi jangkauan sensor HC-SR04 (2cm s.d 400cm)
    if (new_sample >= 2 && new_sample <= 400) {
      samples[sampleIdx] = new_sample;
      sampleIdx = (sampleIdx + 1) % 3;
      
      // Ambil median dari 3 sampel terakhir
      int a = samples[0];
      int b = samples[1];
      int c = samples[2];
      if(a > b) { int t=a; a=b; b=t; }
      if(b > c) { int t=b; b=c; c=t; }
      if(a > b) { int t=a; a=b; b=t; }
      int median_d = b;
      
      baca_level(median_d); // Proses ketinggian air (EMA filter) & update LCD
      
      // Cek kondisi pengiriman ke Firebase
      bool statusChanged = (status != lastStatus);
      bool levelChangedSignificantly = (abs(level - lastSentLevel) >= 3);
      bool timeToUpdate = (millis() - lastFirebaseWrite >= firebaseWriteInterval);
      bool forceWrite = (millis() - lastFirebaseLevelWrite >= firebaseForceWriteInterval);
      
      // 2. SMART ADAPTIVE REPORTING: Kirim instan jika status berubah atau level berubah drastis,
      //    atau jika sudah lama tidak kirim (forceWrite) agar grafik tidak macet saat tenang.
      if ((level != lastSentLevel && (statusChanged || levelChangedSignificantly || timeToUpdate)) || forceWrite) {
        if (Firebase.setInt(fbdo, "/sensor_data/water_level", level)) {
          lastSentLevel = level;
          lastStatus = status;
          lastFirebaseWrite = millis();
          lastFirebaseLevelWrite = millis();
          lastFirebaseTxTime = millis(); // Catat waktu transmisi WiFi
          lastSuccessfulTxTime = millis(); // Catat sukses transmisi
        }
      }
    }
  }
  
  // 3. Heartbeat berkala agar web tahu alat tetap aktif (online)
  if (millis() - lastHeartbeatUpdate >= heartbeatInterval) {
    FirebaseJson json;
    json.set(".sv", "timestamp");
    if (Firebase.set(fbdo, "/sensor_data/ts", json)) {
      lastFirebaseTxTime = millis(); // Catat waktu kirim heartbeat juga
      lastSuccessfulTxTime = millis(); // Catat sukses transmisi
    }
    lastHeartbeatUpdate = millis();
  }

  // 4. Update konfigurasi OTA secara berkala (setiap 15 detik) menggunakan single request JSON
  if (millis() - lastOtaCheck >= otaInterval) {
    lastOtaCheck = millis();
    bool updated = false;

    if (Firebase.getJSON(fbdo, "/sensor_data/config")) {
      lastSuccessfulTxTime = millis(); // Catat sukses komunikasi
      FirebaseJson &json = fbdo.jsonObject();
      FirebaseJsonData data;
      
      if (json.get(data, "/max_height") && data.success && data.type == "int") {
        int new_H = data.intValue;
        if (new_H != H) { H = new_H; updated = true; }
      }
      if (json.get(data, "/siaga1") && data.success && data.type == "int") {
        int new_s1 = data.intValue;
        if (new_s1 != LEVEL_SIAGA1) { LEVEL_SIAGA1 = new_s1; updated = true; }
      }
      if (json.get(data, "/siaga2") && data.success && data.type == "int") {
        int new_s2 = data.intValue;
        if (new_s2 != LEVEL_SIAGA2) { LEVEL_SIAGA2 = new_s2; updated = true; }
      }
      if (json.get(data, "/buzzer_mode") && data.success && data.type == "int") {
        int new_buzzerMode = data.intValue;
        if (new_buzzerMode != buzzerMode) { buzzerMode = new_buzzerMode; updated = true; }
      }
    }

    if (updated) {
      Serial.println("Konfigurasi OTA Diperbarui secara Real-time!");
      // Hitung ulang level air menggunakan nilai median terakhir
      int a = samples[0];
      int b = samples[1];
      int c = samples[2];
      if(a > b) { int t=a; a=b; b=t; }
      if(b > c) { int t=b; b=c; c=t; }
      if(a > b) { int t=a; a=b; b=t; }
      baca_level(b);
    }
  }

  // 5. Logika Buzzer Non-blocking
  if (buzzerMode == 0) {
    // Mode 0: Senyap / Mute
    digitalWrite(buzzerPin, LOW);
    buzzerState = false;
  } 
  else if (buzzerMode == 2) {
    // Mode 2: Tes Bunyi (Aktif Terus)
    digitalWrite(buzzerPin, HIGH);
    buzzerState = true;
  } 
  else {
    // Mode 1: Otomatis (Mengikuti Ketinggian Air)
    
    // Deteksi jika status alarm berubah (misal Aman -> Siaga 1, atau Siaga 1 -> Siaga 2)
    if (status != lastBuzzerStatus) {
      lastBuzzerStatus = status;
      statusChangeTime = millis(); // Reset waktu awal bunyi
    }

    // Cek apakah bunyi alarm sudah melebihi batas waktu (timeout)
    bool isExpired = (millis() - statusChangeTime >= buzzerTimeout);

    if ((status == "Siaga 2" || status == "Siaga 1") && !isExpired) {
      if (status == "Siaga 2") {
        // Siaga 2 (Bahaya) -> Beep cepat: 150ms ON, 150ms OFF
        if (millis() - lastBuzzerToggle >= 150) {
          lastBuzzerToggle = millis();
          buzzerState = !buzzerState;
          digitalWrite(buzzerPin, buzzerState ? HIGH : LOW);
        }
      } 
      else if (status == "Siaga 1") {
        // Siaga 1 (Waspada) -> Beep lambat: 600ms ON, 600ms OFF
        if (millis() - lastBuzzerToggle >= 600) {
          lastBuzzerToggle = millis();
          buzzerState = !buzzerState;
          digitalWrite(buzzerPin, buzzerState ? HIGH : LOW);
        }
      }
    } 
    else {
      // Aman ATAU waktu berbunyi sudah habis -> matikan buzzer
      digitalWrite(buzzerPin, LOW);
      buzzerState = false;
    }
  }

  // 6. Watchdog Auto-Reboot (Restart jika hilang koneksi Firebase selama > 2 menit / 120 detik)
  if (millis() - lastSuccessfulTxTime >= 120000) {
    Serial.println("⚠️ Kehilangan koneksi Firebase terlalu lama! Merestart perangkat...");
    lcd.clear();
    lcd.print(" Koneksi Hilang ");
    lcd.setCursor(0,1);
    lcd.print(" Auto Restart...");
    delay(1500);
    ESP.restart();
  }
}

// Fungsi bantu: ukur satu sampel d_cm (dalam cm) dengan timeout lebih responsif
int ukur_satu() {
    digitalWrite(trigPin, LOW);
    delayMicroseconds(2);
    digitalWrite(trigPin, HIGH);
    delayMicroseconds(10);
    digitalWrite(trigPin, LOW);
    // Timeout 24000us (24ms) cukup untuk mendeteksi jarak pantulan maksimal ~4 meter
    long dur = pulseIn(echoPin, HIGH, 24000);
    return (int)(dur * SOUND_VELOCITY / 2);
}

void baca_level(int median_d) {
    // Simpan hasil ke variabel global
    d_cm = median_d;
    int raw_level = H - d_cm;
    if (raw_level < 0) raw_level = 0;

    // Smart Adaptive Filter (Tahan Lonjakan / Noise Rejection)
    static float smoothed_level = -1.0;
    static int spike_counter = 0;

    if (smoothed_level < 0) {
        smoothed_level = raw_level;
    } else {
        float diff = abs(raw_level - smoothed_level);
        if (diff >= 5.0) {
            // Jika beda lebih dari 5cm, jangan langsung lompat (bisa jadi noise/lonjakan).
            // Tunggu sampai 3 kali pembacaan berturut-turut konsisten jauh, baru kita anggap perubahan valid.
            spike_counter++;
            if (spike_counter >= 3) {
                smoothed_level = raw_level;
                spike_counter = 0;
            }
        } else {
            // Fluktuasi kecil di bawah 5cm: Saring perlahan agar angka tetap kokoh dan diam (EMA filter)
            smoothed_level = (0.15 * raw_level) + (0.85 * smoothed_level);
            spike_counter = 0; // reset counter karena pembacaan kembali normal
        }
    }
    level = (int)(smoothed_level + 0.5);

    // LCD baris 1: tampilkan level (tinggi air)
    lcd.setCursor(6,0);
    lcd.print(level);
    lcd.print("cm   ");

    // Kondisi Siaga 2 (paling bahaya - dicek DULU karena threshold lebih tinggi)
    if(level >= LEVEL_SIAGA2){
      s2 = 1; s1 = 0;
      status = "Siaga 2";
      lcd.setCursor(7,1); lcd.print("Siaga 2 ");
    }
    // Kondisi Siaga 1 (waspada)
    else if(level >= LEVEL_SIAGA1){
      s1 = 1; s2 = 0;
      status = "Siaga 1";
      lcd.setCursor(7,1); lcd.print("Siaga 1 ");
    }
    // Kondisi Aman
    else {
      status = "Aman";
      s1 = 0; s2 = 0;
      lcd.setCursor(7,1); lcd.print("Aman    ");
    }
}