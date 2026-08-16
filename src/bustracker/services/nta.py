import json
import logging
import threading
import time
import urllib.error
import urllib.request

from . import gtfs

API_URL = "https://api.nationaltransport.ie/gtfsr/v2/Vehicles?format=json"
CACHE_TTL_SECONDS = 20
MAX_429_RETRIES = 2

log = logging.getLogger(__name__)
_cache_lock = threading.Lock()
_cache: dict = {"data": None, "fetched_at": 0.0}


def fetch_vehicles(api_key: str, route: str | None = None, bounds: tuple[float, float, float, float] | None = None) -> dict:
    now = time.time()
    with _cache_lock:
        if _cache["data"] is not None and now - _cache["fetched_at"] < CACHE_TTL_SECONDS:
            data = _cache["data"]
        else:
            data = _fetch_from_nta(api_key)
            _cache["data"] = data
            _cache["fetched_at"] = time.time()

    vehicles = []
    for entity in data["entity"]:
        vehicle_data = entity.get("vehicle", {})
        position = vehicle_data.get("position", {})
        latitude = position.get("latitude")
        longitude = position.get("longitude")
        if latitude is None or longitude is None:
            continue
        trip = vehicle_data.get("trip", {})
        trip_id = trip.get("trip_id")
        route_id = trip.get("route_id", "Unknown route")
        static_trip = gtfs.get_trip(trip_id)
        static_route = gtfs.get_route(route_id)
        vehicles.append(
            {
                "id": vehicle_data.get("vehicle", {}).get("id", entity.get("id")),
                "route_id": route_id,
                "agency": (static_route or {}).get("agency_id"),
                "route_number": (static_route or {}).get("route_short_name") or _route_number(route_id),
                "destination": (static_trip or {}).get("trip_headsign"),
                "trip_id": trip_id,
                "shape_id": (static_trip or {}).get("shape_id"),
                "direction_id": (static_trip or {}).get("direction_id", trip.get("direction_id")),
                "latitude": latitude,
                "longitude": longitude,
                "bearing": position.get("bearing"),
                "timestamp": vehicle_data.get("timestamp"),
            }
        )

    if route:
        query = route.strip().lower()
        vehicles = [vehicle for vehicle in vehicles if vehicle["route_number"].lower() == query]

    if bounds:
        min_lat, min_lng, max_lat, max_lng = bounds
        vehicles = [
            vehicle
            for vehicle in vehicles
            if min_lat <= vehicle["latitude"] <= max_lat and min_lng <= vehicle["longitude"] <= max_lng
        ]

    return {
        "timestamp": data["header"].get("timestamp"),
        "vehicles": vehicles,
    }


def _fetch_from_nta(api_key: str) -> dict:
    for attempt in range(MAX_429_RETRIES + 1):
        try:
            request = urllib.request.Request(
                API_URL,
                headers={
                    "Cache-Control": "no-cache",
                    "x-api-key": api_key,
                },
            )
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < MAX_429_RETRIES:
                time.sleep(_retry_after_seconds(error))
                continue
            raise


def _retry_after_seconds(error: urllib.error.HTTPError) -> float:
    retry_after = error.headers.get("Retry-After")
    if retry_after is None:
        return 1.5
    try:
        return min(float(retry_after), 5.0)
    except ValueError:
        return 1.5


def _route_number(route_id: str) -> str:
    parts = route_id.split(" ")
    return parts[1] if len(parts) > 1 else parts[0]
