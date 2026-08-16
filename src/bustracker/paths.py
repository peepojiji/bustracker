import os

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")
GTFS_PATH = os.path.join(DATA_DIR, "gtfs_realtime.zip")
DB_PATH = os.path.join(DATA_DIR, "gtfs_cache.sqlite")
