import csv
import io
import os
import re
import sqlite3
import threading
import zipfile
from collections import OrderedDict
from datetime import datetime
from functools import lru_cache

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "..", "data")
GTFS_PATH = os.path.join(DATA_DIR, "gtfs_realtime.zip")
DB_PATH = os.path.join(DATA_DIR, "gtfs_cache.sqlite")

_active_services_cache: dict[str, set[str]] = {}


def _get_active_services(date_str: str, weekday_col: str) -> set[str]:
    if date_str in _active_services_cache:
        return _active_services_cache[date_str]
    with sqlite3.connect(DB_PATH) as conn:
        services: set[str] = set()
        for row in conn.execute(
            f"SELECT service_id FROM calendar WHERE {weekday_col} = 1 AND start_date <= ? AND end_date >= ?",
            (date_str, date_str),
        ):
            services.add(row[0])
        for row in conn.execute(
            "SELECT service_id FROM calendar_dates WHERE date = ? AND exception_type = 1",
            (date_str,),
        ):
            services.add(row[0])
        for row in conn.execute(
            "SELECT service_id FROM calendar_dates WHERE date = ? AND exception_type = 2",
            (date_str,),
        ):
            services.discard(row[0])
    _active_services_cache[date_str] = services
    return services


def _rows(filename: str) -> list[dict]:
    with zipfile.ZipFile(GTFS_PATH) as archive, archive.open(filename) as handle:
        text = io.TextIOWrapper(handle, encoding="utf-8-sig")
        return list(csv.DictReader(text))


@lru_cache(maxsize=1)
def trips() -> dict[str, dict]:
    if not os.path.exists(GTFS_PATH):
        return {}
    return {row["trip_id"]: row for row in _rows("trips.txt")}


@lru_cache(maxsize=1)
def routes() -> dict[str, dict]:
    if not os.path.exists(GTFS_PATH):
        return {}
    return {row["route_id"]: row for row in _rows("routes.txt")}


def get_trip(trip_id: str | None) -> dict | None:
    if not trip_id:
        return None
    return trips().get(trip_id)


def get_route(route_id: str | None) -> dict | None:
    if not route_id:
        return None
    return routes().get(route_id)


def get_stop_departures(stop_id: str, now: datetime | None = None) -> list[dict] | None:
    if not os.path.exists(DB_PATH):
        return None
    now = now or datetime.now().astimezone()
    date_str = now.strftime("%Y%m%d")
    weekday_col = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][now.weekday()]
    now_minutes = now.hour * 60 + now.minute

    active_services = _get_active_services(date_str, weekday_col)

    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.cursor()
        if cur.execute("SELECT 1 FROM stops WHERE stop_id = ? LIMIT 1", (stop_id,)).fetchone() is None:
            return None

        cur.execute(
            """SELECT st.departure, t.headsign, r.short_name, r.agency_id
               FROM stop_times st
               JOIN trips t ON t.trip_id = st.trip_id
               JOIN routes r ON r.route_id = t.route_id
               WHERE st.stop_id = ? AND t.service_id IN ({})
               ORDER BY st.departure""".format(",".join("?" * len(active_services))),
            (stop_id, *active_services),
        )
        rows = cur.fetchall()

    departures = []
    for departure, headsign, route_number, agency_id in rows:
        occurrence = departure
        while occurrence < now_minutes:
            occurrence += 1440
        if occurrence - now_minutes > 180:
            continue
        departures.append(
            {
                "route_number": route_number,
                "agency_id": agency_id,
                "destination": headsign,
                "minutes": departure,
            }
        )
    if departures:
        route_numbers = sorted({departure["route_number"] for departure in departures})
        threading.Thread(target=_warm_route_details, args=(route_numbers,), daemon=True).start()
    return departures[:50]


def _warm_route_details(route_numbers: list[str]) -> None:
    for route_number in route_numbers:
        get_route_detail(route_number)


@lru_cache(maxsize=256)
def route_families(route_number: str) -> dict:
    """Group a route number into variant families, split by agency.

    A letter-suffixed number (220A, 220X) is a variant of its digit base (220).
    Pure-digit routes are never treated as variants of a shorter digit prefix
    (202 is not a variant of 20). Families are kept per agency because the same
    number can describe unrelated services in different cities.
    """
    if not os.path.exists(DB_PATH):
        return {"number": route_number, "families": []}

    base = _route_base(route_number) or route_number
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT DISTINCT short_name, agency_id FROM routes WHERE short_name IS NOT NULL"
        ).fetchall()

    groups: dict[str, dict[str, set]] = {}
    for name, agency in rows:
        family_base = _route_base(name)
        if family_base is None:
            continue
        groups.setdefault(family_base, {}).setdefault(agency, set()).add(name)

    families = [
        {"agency": agency, "base": base, "routes": sorted(names)}
        for agency, names in sorted(groups.get(base, {}).items())
    ]
    return {"number": route_number, "base": base, "families": families}


def _route_base(name: str) -> str | None:
    if re.fullmatch(r"\d+[A-Za-z]+", name):
        return re.match(r"(\d+)", name).group(1)
    if re.fullmatch(r"\d+", name):
        return name
    return None


def get_shape(shape_id: str | None) -> list[list[float]] | None:
    if not shape_id or not os.path.exists(DB_PATH):
        return None
    with _db_lock:
        cached = _shape_cache.get(shape_id, _MISSING)
        if cached is not _MISSING:
            _shape_cache.move_to_end(shape_id)
            return cached or None
        rows = _read_conn().execute(
            "SELECT lat, lon FROM shapes WHERE shape_id = ? ORDER BY seq", (shape_id,)
        ).fetchall()
        data = [[round(row[0], 6), round(row[1], 6)] for row in rows] if rows else []
        _shape_cache[shape_id] = data
        _trim_shape_cache()
        return data or None


def get_shapes(shape_ids: list[str]) -> dict[str, list[list[float]]]:
    """Fetch many shapes in a single query, reusing already-cached shapes."""
    if not shape_ids or not os.path.exists(DB_PATH):
        return {}
    with _db_lock:
        result: dict[str, list[list[float]]] = {}
        missing: list[str] = []
        for shape_id in shape_ids:
            cached = _shape_cache.get(shape_id, _MISSING)
            if cached is not _MISSING:
                _shape_cache.move_to_end(shape_id)
                result[shape_id] = cached
            else:
                missing.append(shape_id)

        if missing:
            placeholders = ",".join("?" * len(missing))
            rows = _read_conn().execute(
                f"SELECT shape_id, lat, lon FROM shapes WHERE shape_id IN ({placeholders}) ORDER BY shape_id, seq",
                missing,
            ).fetchall()
            by_id: dict[str, list[list[float]]] = {}
            for shape_id, lat, lon in rows:
                by_id.setdefault(shape_id, []).append([round(lat, 6), round(lon, 6)])
            for shape_id in missing:
                data = by_id.get(shape_id, [])
                _shape_cache[shape_id] = data
                result[shape_id] = data
            _trim_shape_cache()

    return {shape_id: data for shape_id, data in result.items()}


_MISSING = object()
_SHAPE_CACHE_MAX = 512
_shape_cache: OrderedDict[str, list[list[float]]] = OrderedDict()
_db_lock = threading.Lock()
_db_conn: sqlite3.Connection | None = None


def _read_conn() -> sqlite3.Connection:
    global _db_conn
    if _db_conn is None:
        _db_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    return _db_conn


def _trim_shape_cache() -> None:
    while len(_shape_cache) > _SHAPE_CACHE_MAX:
        _shape_cache.popitem(last=False)


def route_exists(route_number: str) -> bool:
    if not os.path.exists(DB_PATH):
        return False
    with sqlite3.connect(DB_PATH) as conn:
        return conn.execute("SELECT 1 FROM routes WHERE short_name = ? LIMIT 1", (route_number,)).fetchone() is not None


def get_all_routes() -> list[dict]:
    """All route numbers, one row per (route, agency), sorted for the search dropdown."""
    if not os.path.exists(DB_PATH):
        return []
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT route_id, short_name, long_name, agency_id FROM routes WHERE short_name IS NOT NULL"
        ).fetchall()
    return [
        {
            "route_id": row["route_id"],
            "short_name": row["short_name"],
            "long_name": row["long_name"],
            "agency_id": row["agency_id"],
        }
        for row in rows
    ]


def get_all_stops() -> list[dict]:
    if not os.path.exists(DB_PATH):
        return []
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT stop_id, name, lat, lon FROM stops").fetchall()
    return [
        {
            "stop_id": row["stop_id"],
            "name": row["name"],
            "latitude": row["lat"],
            "longitude": row["lon"],
        }
        for row in rows
    ]


@lru_cache(maxsize=256)
def get_route_detail(route_number: str) -> dict | None:
    if not os.path.exists(DB_PATH):
        return None
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT route_id, long_name, agency_id FROM routes WHERE short_name = ?", (route_number,))
        found = cur.fetchall()
        if not found:
            return None

        routes_detail = []
        for row in found:
            route_id = row["route_id"]
            routes_detail.append(
                {
                    "route_id": route_id,
                    "agency": row["agency_id"],
                    "route_name": row["long_name"],
                    "shapes": _route_shapes(cur, route_id),
                    "stops": _route_stops(cur, route_id),
                }
            )

    return {"route_number": route_number, "routes": routes_detail}


def _route_shapes(cur: sqlite3.Cursor, route_id: str) -> list[list[list[float]]]:
    cur.execute(
        """SELECT t.direction_id, s.shape_id, COUNT(*) AS pts
           FROM shapes s
           JOIN (SELECT DISTINCT shape_id, direction_id FROM trips WHERE route_id = ?) t
                ON t.shape_id = s.shape_id
           GROUP BY t.direction_id, s.shape_id""",
        (route_id,),
    )
    best: dict[int | None, tuple[str, int]] = {}
    for row in cur.fetchall():
        direction = row["direction_id"]
        if direction not in best or row["pts"] > best[direction][1]:
            best[direction] = (row["shape_id"], row["pts"])

    result = []
    for _, (shape_id, _) in sorted(best.items(), key=lambda item: (item[0] is None, item[0])):
        cur.execute("SELECT lat, lon FROM shapes WHERE shape_id = ? ORDER BY seq", (shape_id,))
        points = [[row["lat"], row["lon"]] for row in cur.fetchall()]
        if points:
            result.append(points)
    return result


def _route_stops(cur: sqlite3.Cursor, route_id: str) -> list[dict]:
    cur.execute(
        """SELECT st.trip_id, COUNT(*) AS c
           FROM stop_times st
           WHERE st.trip_id IN (SELECT trip_id FROM trips WHERE route_id = ? AND direction_id IS NOT NULL)
           GROUP BY st.trip_id""",
        (route_id,),
    )
    counts = {row["trip_id"]: row["c"] for row in cur.fetchall()}

    cur.execute(
        "SELECT trip_id, direction_id FROM trips WHERE route_id = ? AND direction_id IS NOT NULL",
        (route_id,),
    )
    directions = {row["trip_id"]: row["direction_id"] for row in cur.fetchall()}

    best: dict[int, tuple[int, str]] = {}
    for trip_id, count in counts.items():
        direction = directions.get(trip_id)
        if direction is None:
            continue
        if direction not in best or count > best[direction][0]:
            best[direction] = (count, trip_id)

    stops = []
    for direction, (_, trip_id) in best.items():
        cur.execute("SELECT stop_id FROM stop_times WHERE trip_id = ? ORDER BY seq", (trip_id,))
        stop_ids = [row["stop_id"] for row in cur.fetchall()]
        if not stop_ids:
            continue

        placeholders = ",".join("?" * len(stop_ids))
        cur.execute(f"SELECT stop_id, name, lat, lon FROM stops WHERE stop_id IN ({placeholders})", stop_ids)
        stop_map = {row["stop_id"]: row for row in cur.fetchall()}

        for stop_id in stop_ids:
            if stop_id in stop_map:
                row = stop_map[stop_id]
                stops.append(
                    {
                        "stop_id": row["stop_id"],
                        "name": row["name"],
                        "latitude": row["lat"],
                        "longitude": row["lon"],
                        "direction_id": direction,
                    }
                )
    return stops


def invalidate_caches():
    trips.cache_clear()
    routes.cache_clear()
    get_route_detail.cache_clear()
    route_families.cache_clear()
    _active_services_cache.clear()
    global _db_conn
    _shape_cache.clear()
    if _db_conn is not None:
        _db_conn.close()
        _db_conn = None
