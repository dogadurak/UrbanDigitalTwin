import os
from dotenv import load_dotenv

# .env dosyasını yükle (varsa)
load_dotenv()

# Pilot Alan Tanımları
PILOT_LAT = float(os.getenv("PILOT_LAT", "38.4237"))
PILOT_LON = float(os.getenv("PILOT_LON", "27.1428"))
PILOT_RADIUS_METERS = int(os.getenv("PILOT_RADIUS_METERS", "500"))

# Veritabanı Bağlantı Bilgileri
DB_USER = os.getenv("DB_USER", "geotwin_user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "geotwin_password")
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = os.getenv("DB_PORT", "5433")
DB_NAME = os.getenv("DB_NAME", "geotwin_db")

# SQLAlchemy Connection String
DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
