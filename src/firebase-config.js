// Konfigurasi Firebase proyek "Smart AC" (smart-ac-9f7f6).
// Nilai ini sama dengan yang dipakai dashboard web dan ESP32.
export const firebaseConfig = {
  apiKey: "AIzaSyD0JuujCZIOaozA9jXIoEi97Trq1kopoXg",
  authDomain: "smart-ac-9f7f6.firebaseapp.com",
  databaseURL: "https://smart-ac-9f7f6-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "smart-ac-9f7f6",
  storageBucket: "smart-ac-9f7f6.firebasestorage.app",
  messagingSenderId: "931745038175",
  appId: "1:931745038175:web:07087ce8dc469e435540ea",
};

// Folder utama di Realtime Database (harus sama dengan kode ESP32)
export const ROOT_PATH = "coolsense";

// ESP32 dianggap terputus kalau tidak mengirim kabar selama ini (milidetik)
export const OFFLINE_MS = 15000;
