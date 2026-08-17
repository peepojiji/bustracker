import csv
import io
import os
import sqlite3
import zipfile

from .paths import DB_PATH, GTFS_PATH

SCHEMA = """
CREATE TABLE routes (
    route_id TEXT PRIMARY KEY,
    short_name TEXT,
    long_name TEXT,
    agency_id TEXT
);
CREATE TABLE trips (
    trip_id TEXT PRIMARY KEY,
    route_id TEXT,
    shape_id TEXT,
    direction_id INTEGER,
    service_id TEXT,
    headsign TEXT
);
CREATE TABLE stops (
    stop_id TEXT PRIMARY KEY,
    name TEXT,
    lat REAL,
    lon REAL
);
CREATE TABLE shapes (
    shape_id TEXT,
    seq INTEGER,
    lat REAL,
    lon REAL
);
CREATE TABLE stop_times (
    trip_id TEXT,
    seq INTEGER,
    stop_id TEXT,
    departure INTEGER
);
CREATE TABLE calendar (
    service_id TEXT,
    monday INTEGER,
    tuesday INTEGER,
    wednesday INTEGER,
    thursday INTEGER,
    friday INTEGER,
    saturday INTEGER,
    sunday INTEGER,
    start_date TEXT,
    end_date TEXT
);
CREATE TABLE calendar_dates (
    service_id TEXT,
    date TEXT,
    exception_type INTEGER
);
"""

INDEXES = """
CREATE INDEX idx_routes_short ON routes(short_name);
CREATE INDEX idx_trips_route ON trips(route_id);
CREATE INDEX idx_trips_service ON trips(service_id);
CREATE INDEX idx_shapes_id ON shapes(shape_id);
CREATE INDEX idx_stop_times_trip ON stop_times(trip_id);
CREATE INDEX idx_stop_times_stop ON stop_times(stop_id);
CREATE INDEX idx_stop_times_stop_dep ON stop_times(stop_id, departure);
CREATE INDEX idx_calendar_service ON calendar(service_id);
CREATE INDEX idx_calendar_dates_date ON calendar_dates(date);
"""


def _iter_rows(archive: zipfile.ZipFile, filename: str):
    with archive.open(filename) as handle:
        text = io.TextIOWrapper(handle, encoding="utf-8-sig")
        reader = csv.reader(text)
        next(reader, None)
        yield from reader


def _chunks(rows, size=100_000):
    chunk = []
    for row in rows:
        chunk.append(row)
        if len(chunk) >= size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def _departure_minutes(value: str) -> int | None:
    parts = value.strip().split(":")
    if len(parts) != 3:
        return None
    try:
        hour, minute, _ = (int(part) for part in parts)
    except ValueError:
        return None
    return hour * 60 + minute


def build(gtfs_path: str = GTFS_PATH, db_path: str = DB_PATH) -> None:
    if os.path.exists(db_path):
        os.remove(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")
    cur = conn.cursor()
    cur.executescript(SCHEMA)

    with zipfile.ZipFile(gtfs_path) as archive:
        cur.executemany(
            "INSERT INTO routes VALUES (?,?,?,?)",
            ((row[0], row[2], row[3], row[1]) for row in _iter_rows(archive, "routes.txt")),
        )
        cur.executemany(
            "INSERT INTO stops VALUES (?,?,?,?)",
            ((row[0], row[2], float(row[4]), float(row[5])) for row in _iter_rows(archive, "stops.txt")),
        )
        def _direction(value: str) -> int | None:
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        cur.executemany(
            "INSERT INTO trips VALUES (?,?,?,?,?,?)",
            (
                (row[2], row[0], row[7], _direction(row[5]), row[1], row[3])
                for row in _iter_rows(archive, "trips.txt")
            ),
        )
        for chunk in _chunks(
            (row[0], int(row[3]), float(row[1]), float(row[2])) for row in _iter_rows(archive, "shapes.txt")
        ):
            cur.executemany("INSERT INTO shapes VALUES (?,?,?,?)", chunk)

        def _stop_time_row(row):
            departure = _departure_minutes(row[2])
            if departure is None:
                return None
            return (row[0], int(row[4]), row[3], departure)

        for chunk in _chunks(
            (_stop_time_row(row) for row in _iter_rows(archive, "stop_times.txt")),
        ):
            cleaned = [row for row in chunk if row is not None]
            if cleaned:
                cur.executemany("INSERT INTO stop_times VALUES (?,?,?,?)", cleaned)

        cur.executemany(
            "INSERT INTO calendar VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                (row[0], int(row[1]), int(row[2]), int(row[3]), int(row[4]), int(row[5]), int(row[6]), int(row[7]), row[8], row[9])
                for row in _iter_rows(archive, "calendar.txt")
            ),
        )
        cur.executemany(
            "INSERT INTO calendar_dates VALUES (?,?,?)",
            ((row[0], row[1], int(row[2])) for row in _iter_rows(archive, "calendar_dates.txt")),
        )

    cur.executescript(INDEXES)
    conn.commit()
    conn.close()

    from .services.gtfs import invalidate_caches
    invalidate_caches()


if __name__ == "__main__":
    build()
    print(f"Route cache built at {DB_PATH}")
