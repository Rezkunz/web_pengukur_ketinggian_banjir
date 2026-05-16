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

unsigned long lastFirebaseUpdate = 0;
const unsigned long firebaseInterval = 1000; // Dikurangi ke 1 detik agar lebih stabil

// ... (Inisialisasi LCD dan Pin tetap sama) ...

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
  config_fb.host = FIREBASE_HOST;
  config_fb.api_key = FIREBASE_API_KEY;
  auth_fb.user.email = DEVICE_EMAIL;
  auth_fb.user.password = DEVICE_PASSWORD;
  
  Firebase.begin(&config_fb, &auth_fb);

  
  // Batasi SSL Buffer Firebase
  fbdo.setBSSLBufferSize(1024, 1024);
  Firebase.reconnectWiFi(true); 
  
  lcd.clear();
  lcd.print("Level=");
  lcd.setCursor(0,1);
  lcd.print("Status:");
}

void loop() { 
  yield(); // Beri napas pada ESP8266 agar terhindar dari WDT Reset

  // 1. Update bacaan sensor secara terus menerus ke variabel
  baca_level(); 
  
  // 2. Update data ke Firebase DB Web
  if (millis() - lastFirebaseUpdate >= firebaseInterval) {
    if(d_cm > 0) {
      Firebase.setInt(fbdo, "/sensor_data/water_level", level);
    }
    
    // Heartbeat: Mengirim Server Timestamp agar web tahu kapan alat terakhir aktif secara persisten
    FirebaseJson json;
    json.set(".sv", "timestamp");
    Firebase.set(fbdo, "/sensor_data/ts", json);
    
    lastFirebaseUpdate = millis();
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
    // Ambil 3 sampel cepat (~9ms total), lalu ambil median
    int a = ukur_satu(); delay(3);
    int b = ukur_satu(); delay(3);
    int c = ukur_satu();

    // Sort 3 nilai (bubble sort mini)
    if(a > b) { int t=a; a=b; b=t; }
    if(b > c) { int t=b; b=c; c=t; }
    if(a > b) { int t=a; a=b; b=t; }
    int median_cm = b; // Nilai tengah = median

    // Abaikan jika timeout (0) atau di luar jangkauan sensor
    if(median_cm <= 0 || median_cm > 400) return;

    // Simpan hasil ke variabel global
    d_cm = median_cm;
    level = H - d_cm;
    if (level < 0) level = 0;

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