import re

from flask import Blueprint, current_app, jsonify, make_response, request

from ..services import gtfs
from ..services.nta import fetch_vehicles

api_bp = Blueprint("api", __name__)

_SAFE_PARAM = re.compile(r"^[A-Za-z0-9_-]{1,50}$")


def _validate(value, name="parameter"):
    if not _SAFE_PARAM.match(value):
        return jsonify({"error": f"Invalid {name}"}), 400
    return None


@api_bp.get("/vehicles")
def vehicles():
    api_key = current_app.config.get("NTA_API_KEY")
    if not api_key:
        return jsonify({"error": "NTA_API_KEY is not configured"}), 503

    bbox = request.args.get("bbox")
    bounds = None
    if bbox:
        parts = bbox.split(",")
        if len(parts) != 4:
            return jsonify({"error": "bbox must be minLat,minLng,maxLat,maxLng"}), 400
        try:
            bounds = tuple(float(part) for part in parts)
        except ValueError:
            return jsonify({"error": "bbox must be four numbers"}), 400

    try:
        return jsonify(fetch_vehicles(api_key, route=request.args.get("route"), bounds=bounds))
    except Exception:
        current_app.logger.exception("Failed to fetch vehicle positions from NTA")
        return jsonify({"error": "Unable to fetch vehicle positions"}), 502


@api_bp.get("/routes")
def routes_list():
    resp = make_response(jsonify({"routes": gtfs.get_all_routes()}))
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp


@api_bp.get("/stops")
def stops_list():
    resp = make_response(jsonify({"stops": gtfs.get_all_stops()}))
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp


@api_bp.get("/route/<route_number>")
def route_detail(route_number):
    err = _validate(route_number, "route_number")
    if err:
        return err
    detail = gtfs.get_route_detail(route_number)
    if detail is None:
        return jsonify({"error": f"Route {route_number} not found"}), 404
    resp = make_response(jsonify(detail))
    resp.headers["Cache-Control"] = "public, max-age=600"
    return resp


@api_bp.get("/routes/variants/<route_number>")
def route_variants(route_number):
    err = _validate(route_number, "route_number")
    if err:
        return err
    resp = make_response(jsonify(gtfs.route_families(route_number)))
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp


@api_bp.get("/shape/<shape_id>")
def shape_detail(shape_id):
    err = _validate(shape_id, "shape_id")
    if err:
        return err
    shape = gtfs.get_shape(shape_id)
    if shape is None:
        return jsonify({"error": "Shape not found"}), 404
    return jsonify({"shape_id": shape_id, "shape": shape})


@api_bp.get("/stop/<stop_id>/departures")
def stop_departures(stop_id):
    err = _validate(stop_id, "stop_id")
    if err:
        return err
    departures = gtfs.get_stop_departures(stop_id)
    if departures is None:
        return jsonify({"error": "Stop not found"}), 404
    return jsonify({"stop_id": stop_id, "departures": departures})
