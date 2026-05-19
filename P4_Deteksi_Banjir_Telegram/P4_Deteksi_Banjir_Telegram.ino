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

void baca_level();

// Timer & Variabel Filter Penstabil Sinyal
unsigned long lastSensorRead = 0;
const unsigned long sensorInterval = 80;       // Baca sensor setiap 80ms (Super Real-time & Responsif)
unsigned long lastHeartbeatUpdate = 0;
const unsigned long heartbeatInterval = 3000;  // Kirim detak jantung setiap 3 detik jika air tenang
unsigned long lastFirebaseTxTime = 0;          // Catat waktu kirim WiFi terakhir untuk cooldown tegangan
unsigned long lastOtaCheck = 0;
const unsigned long otaInterval = 15000;       // Cek OTA setiap 15 detik (mengambil konfigurasi terbaru)

void setup() {
  Serial.begin(115200); 
  pinMode(trigPin, OUTPUT); 
  pinMode(echoPin, INPUT);

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
  if (Firebase.getInt(fbdo, "/sensor_data/config/max_height")) {
      H = fbdo.intData();
  }
  if (Firebase.getInt(fbdo, "/sensor_data/config/siaga1")) {
      LEVEL_SIAGA1 = fbdo.intData();
  }
  if (Firebase.getInt(fbdo, "/sensor_data/config/siaga2")) {
      LEVEL_SIAGA2 = fbdo.intData();
  }
  
  lcd.clear();
  lcd.print("Level=");
  lcd.setCursor(0,1);
  lcd.print("Status:");
}

int lastSentLevel = -999;
String lastStatus = "";

void loop() { 
  yield(); // Beri napas pada ESP8266 agar terhindar dari WDT Reset

  // 1. Baca sensor setiap 80ms, HANYA jika tegangan sudah stabil (minimal 150ms setelah transmisi WiFi terakhir)
  if (millis() - lastSensorRead >= sensorInterval && millis() - lastFirebaseTxTime >= 150) {
    baca_level(); 
    lastSensorRead = millis();
    
    // Cek apakah status siaga berubah (aman/siaga1/siaga2)
    bool statusChanged = (status != lastStatus);

    // 2. TRUE REAL-TIME: Kirim instan jika ketinggian berubah (meski 1cm) agar LCD & Web selalu sinkron 100%!
    if (d_cm > 0 && level != lastSentLevel) {
      if (Firebase.setInt(fbdo, "/sensor_data/water_level", level)) {
        lastSentLevel = level;
        lastStatus = status;
        lastFirebaseTxTime = millis(); // Catat waktu kirim untuk cooldown tegangan sensor
      }
    }
  }
  
  // 3. Heartbeat berkala agar web tahu alat tetap aktif (online)
  if (millis() - lastHeartbeatUpdate >= heartbeatInterval) {
    FirebaseJson json;
    json.set(".sv", "timestamp");
    if (Firebase.set(fbdo, "/sensor_data/ts", json)) {
      lastFirebaseTxTime = millis(); // Catat waktu kirim heartbeat juga
    }
    lastHeartbeatUpdate = millis();
  }

  // 4. Update konfigurasi OTA secara berkala (setiap 15 detik)
  if (millis() - lastOtaCheck >= otaInterval) {
    lastOtaCheck = millis();
    bool updated = false;

    if (Firebase.getInt(fbdo, "/sensor_data/config/max_height")) {
      int new_H = fbdo.intData();
      if (new_H != H) {
        H = new_H;
        updated = true;
      }
    }
    if (Firebase.getInt(fbdo, "/sensor_data/config/siaga1")) {
      int new_s1 = fbdo.intData();
      if (new_s1 != LEVEL_SIAGA1) {
        LEVEL_SIAGA1 = new_s1;
        updated = true;
      }
    }
    if (Firebase.getInt(fbdo, "/sensor_data/config/siaga2")) {
      int new_s2 = fbdo.intData();
      if (new_s2 != LEVEL_SIAGA2) {
        LEVEL_SIAGA2 = new_s2;
        updated = true;
      }
    }

    if (updated) {
      Serial.println("Konfigurasi OTA Diperbarui secara Real-time!");
      baca_level(); // Segera hitung ulang & kirim ke Firebase/LCD jika ada perubahan
    }
  }
}

// Fungsi bantu: ukur satu sampel d_cm (dalam cm)
int ukur_satu() {
    digitalWrite(trigPin, LOW);
    delayMicroseconds(2);
    digitalWrite(trigPin, HIGH);
    delayMicroseconds(10);
    digitalWrite(trigPin, LOW);
    long dur = pulseIn(echoPin, HIGH, 30000);
    return (int)(dur * SOUND_VELOCITY / 2);
}

void baca_level() {
    // Ambil 3 sampel cepat dengan jeda 50ms agar pantulan gelombang (echo) sebelumnya hilang (Minimal 60ms siklus disarankan datasheet HC-SR04)
    int a = ukur_satu(); delay(50);
    int b = ukur_satu(); delay(50);
    int c = ukur_satu();

    // Sort 3 nilai (bubble sort mini untuk mengambil nilai median tengah)
    if(a > b) { int t=a; a=b; b=t; }
    if(b > c) { int t=b; b=c; c=t; }
    if(a > b) { int t=a; a=b; b=t; }
    int median_cm = b;

    // Abaikan jika timeout (0) atau di luar jangkauan sensor
    if(median_cm <= 0 || median_cm > 400) return;

    // Simpan hasil ke variabel global
    d_cm = median_cm;
    int raw_level = H - d_cm;
    if (raw_level < 0) raw_level = 0;

    // Smart Adaptive Filter (Sangat Real-time & Stabil)
    static float smoothed_level = -1.0;
    if (smoothed_level < 0) {
        smoothed_level = raw_level;
    } else {
        float diff = abs(raw_level - smoothed_level);
        if (diff >= 3.0) {
            // Perubahan drastis (misal ditutup tangan): Langsung lompat ke target INSTAN 100% tanpa delay lambat!
            smoothed_level = raw_level;
        } else {
            // Fluktuasi kecil 1-2 cm (riak air): Saring perlahan agar angka tetap kokoh dan diam
            smoothed_level = (0.3 * raw_level) + (0.7 * smoothed_level);
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