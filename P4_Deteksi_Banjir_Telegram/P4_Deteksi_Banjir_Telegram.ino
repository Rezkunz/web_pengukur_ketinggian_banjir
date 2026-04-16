/*********************************************
  Program : Deteksi Banjir - Ultra Stable Version
  Output  : LCD, Firebase RTDB
  Features: 7-sample Median, Delta Filtering, EMA Smoothing
*********************************************/ 
#include <ESP8266WiFi.h> 
#include <LiquidCrystal_I2C.h>
#include <FirebaseESP8266.h>

// Konfigurasi WiFi
char ssid[] = "Ciganitiry"; 
char pass[] = "Mabelku18";   

// Konfigurasi Firebase
#define FIREBASE_HOST "safe-93f61-default-rtdb.asia-southeast1.firebasedatabase.app"
#define FIREBASE_AUTH "AIzaSyChO4h8v33LB_ovIXcBg-yVJrmN40N0WUk"

// Variabel Firebase
FirebaseData fbdo;
FirebaseAuth auth_fb;
FirebaseConfig config_fb;
FirebaseJson json;

unsigned long lastFirebaseUpdate = 0;
const unsigned long firebaseInterval = 2000; 

unsigned long lastSensorRead = 0;
const unsigned long sensorInterval = 200; 

unsigned long lastLcdUpdate = 0;
const unsigned long lcdInterval = 500; 

// Inisialisasi Perangkat
LiquidCrystal_I2C lcd(0x27, 16, 2);
const int trigPin = 14; // D5
const int echoPin = 12; // D6

#define SOUND_VELOCITY 0.034
int H = 300;  
float filteredLevel = 0.0; // Gunakan float untuk smoothing
int displayLevel = 0;    
String currentStatus = "Aman";

// Filter Parameters
#define DELTA_LIMIT 30.0   // Maksimal perubahan cm per pembacaan (cegah lonjakan)
#define EMA_ALPHA 0.3      // Faktor smoothing (0.1 - 0.5). Semakin kecil semakin halus.
#define SAMPLES 7          // Jumlah sampel median

// Threshold Ketinggian Air
#define LEVEL_SIAGA1 50  
#define LEVEL_SIAGA2 100 

void setup() {
  Serial.begin(115200); 
  pinMode(trigPin, OUTPUT); 
  pinMode(echoPin, INPUT);

  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.print(F("  Sistem Aktif  "));
  lcd.setCursor(0,1);
  lcd.print(F("  Mode: STABIL  "));

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, pass);
  
  int timeout = 0;
  while (WiFi.status() != WL_CONNECTED && timeout < 40) {
    delay(500);
    Serial.print(".");
    timeout++;
  }
  
  lcd.clear();
  if (WiFi.status() == WL_CONNECTED) {
    lcd.print(F("Koneksi Sukses!"));
  } else {
    lcd.print(F("WiFi Gagal!"));
  }
  delay(1000);
  
  // Inisialisasi Firebase
  config_fb.host = FIREBASE_HOST;
  config_fb.signer.tokens.legacy_token = FIREBASE_AUTH;
  Firebase.begin(&config_fb, &auth_fb);
  fbdo.setBSSLBufferSize(1024, 1024);
  Firebase.reconnectWiFi(true); 
  
  // Ambil bacaan awal agar filteredLevel tidak nol
  float initialRead = getMedianReading();
  if(initialRead < 999) filteredLevel = (float)(H - initialRead);
  if(filteredLevel < 0) filteredLevel = 0;

  lcd.clear();
  lcd.print(F("Init OK..."));
  delay(1000);
  lcd.clear();
  lcd.print(F("Level="));
  lcd.setCursor(0,1);
  lcd.print(F("Status:"));
}

void loop() { 
  yield(); 

  // 1. Baca Sensor & Filter (setiap 200ms)
  if (millis() - lastSensorRead >= sensorInterval) {
    applyUltraFilter();
    lastSensorRead = millis();
  }

  // 2. Update LCD (setiap 500ms)
  if (millis() - lastLcdUpdate >= lcdInterval) {
    updateLCD();
    lastLcdUpdate = millis();
  }
  
  // 3. Update data ke Firebase (setiap 2 detik)
  if (millis() - lastFirebaseUpdate >= firebaseInterval) {
    if (WiFi.status() == WL_CONNECTED) {
      sendDataToFirebase();
    }
    lastFirebaseUpdate = millis();
  }
}

int ukur_satu() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  long dur = pulseIn(echoPin, HIGH, 25000); 
  if (dur == 0) return 999; 
  return (int)(dur * SOUND_VELOCITY / 2);
}

int getMedianReading() {
  int samples[SAMPLES];
  for(int i=0; i<SAMPLES; i++){
    samples[i] = ukur_satu();
    delay(15); // Jeda antar chirp agar gema hilang
  }

  // Sort samples
  for(int i=0; i<SAMPLES-1; i++){
    for(int j=i+1; j<SAMPLES; j++){
      if(samples[i] > samples[j]){
        int temp = samples[i];
        samples[i] = samples[j];
        samples[j] = temp;
      }
    }
  }
  return samples[SAMPLES/2]; // Nilai tengah
}

void applyUltraFilter() {
  int raw_dist = getMedianReading();
  if (raw_dist >= 999 || raw_dist <= 0) return;

  float targetLevel = (float)(H - raw_dist);
  if (targetLevel < 0) targetLevel = 0;

  // DELTA FILTER: Cegah perubahan mendadak yang tidak masuk akal
  float diff = abs(targetLevel - filteredLevel);
  if (diff > DELTA_LIMIT) {
    // Jika lonjakan terlalu besar, kita perhalus perubahannya tapi jangan langsung diabaikan total 
    // agar sensor tetap bisa mengikuti kenaikan air yang asli tapi perlahan.
    targetLevel = filteredLevel + (targetLevel > filteredLevel ? 5.0 : -5.0); 
    Serial.println(F("Spike Detected & Throttled!"));
  }

  // EMA FILTER: Smoothing pergerakan angka
  filteredLevel = (EMA_ALPHA * targetLevel) + ((1.0 - EMA_ALPHA) * filteredLevel);
  
  displayLevel = (int)(filteredLevel + 0.5); // Pembulatan

  // Update Status
  if(displayLevel >= LEVEL_SIAGA2)      currentStatus = "Siaga 2";
  else if(displayLevel >= LEVEL_SIAGA1) currentStatus = "Siaga 1";
  else                                  currentStatus = "Aman";
  
  Serial.print(F("Raw Dist: ")); Serial.print(raw_dist);
  Serial.print(F(" | Filtered Level: ")); Serial.println(displayLevel);
}

void updateLCD() {
  lcd.setCursor(6,0);
  lcd.print(displayLevel);
  lcd.print(F("cm   "));

  lcd.setCursor(7,1);
  lcd.print(currentStatus);
  lcd.print(F("    "));
}

void sendDataToFirebase() {
  json.clear();
  json.add("water_level", displayLevel);
  json.add("status", currentStatus);
  json.add("ts", (uint32_t)(millis() / 1000));

  if (!Firebase.setJSON(fbdo, "/sensor_data", json)) {
    Serial.println(F("FB Error: ") + fbdo.errorReason());
  } else {
    Serial.println(F("Firebase Updated"));
  }
}