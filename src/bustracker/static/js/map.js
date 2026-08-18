import { irelandBounds, corkCenter, refreshIntervalMs, routeNumber } from "./utils.js";
import { buildPath, pathBearingAt } from "./geometry.js";
import { busIcon, popupContent, createMarker } from "./icons.js";
import { animateMarker, animateAlongPath } from "./animation.js";
import {
    markers, selectedVariants, shapeCache, pathCache,
    currentVehicles, setCurrentVehicles,
    allStops, setAllStops,
    fetchToken, setFetchToken,
    viewportTimer, setViewportTimer,
    status, paneToggle,
    setPaneOpen, paneOpen
} from "./state.js";
import { visibleBuses, addFamilies, addVariant, renderRouteLayer as renderRouteLayerBase, buildVariantPanel, clearSelection as clearSelectionBase, applySelection } from "./routes.js";
import { initSearch, updateClearButton, setSearchRouteCallback } from "./search.js";
import { initTimetable, showStopTimetable } from "./timetable.js";

const map = L.map("map", {
    maxBounds: irelandBounds,
    maxBoundsViscosity: 1.0,
    zoomControl: false
}).setView(corkCenter, 13);
L.control.zoom({ position: "bottomright" }).addTo(map);
const busLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const stopLayer = L.layerGroup().addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
}).addTo(map);

paneToggle.addEventListener("click", () => setPaneOpen(!paneOpen));

function ensureShape(shapeId) {
    if (!shapeId || shapeCache.has(shapeId)) {
        return;
    }
    shapeCache.set(shapeId, null);
    pathCache.delete(shapeId);
    fetch(`/api/shape/${encodeURIComponent(shapeId)}`)
        .then(response => response.json().then(data => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            shapeCache.set(shapeId, ok ? data.shape || [] : []);
        })
        .catch(() => {
            shapeCache.set(shapeId, []);
        });
}

function getCachedPath(shapeId) {
    if (pathCache.has(shapeId)) {
        return pathCache.get(shapeId);
    }
    const shape = shapeCache.get(shapeId);
    if (!shape || shape.length < 2) {
        return null;
    }
    const path = buildPath(shape);
    pathCache.set(shapeId, path);
    return path;
}

function renderStopLayer() {
    if (selectedVariants.size) {
        stopLayer.clearLayers();
        return;
    }
    if (map.getZoom() < 15) {
        stopLayer.clearLayers();
        return;
    }
    if (!allStops) {
        loadAllStops().then(() => renderStopLayer());
        return;
    }
    stopLayer.clearLayers();
    const bounds = map.getBounds();
    allStops.forEach(stop => {
        if (!bounds.contains([stop.latitude, stop.longitude])) {
            return;
        }
        const marker = L.circleMarker([stop.latitude, stop.longitude], {
            radius: 7,
            color: "#000000",
            fillColor: "#9ca3af",
            fillOpacity: 0.85,
            weight: 2
        });
        marker.on("click", () => {
            showStopTimetable(stop);
        });
        marker.addTo(stopLayer);
    });
}

function renderBuses() {
    const visible = visibleBuses(currentVehicles);
    const visibleIds = new Set();
    visible.forEach(bus => {
        const id = String(bus.id);
        visibleIds.add(id);
        const target = [bus.latitude, bus.longitude];
        const shape = shapeCache.get(bus.shape_id);
        const path = shape ? getCachedPath(bus.shape_id) : null;
        const routeBearing = path
            ? pathBearingAt(shape, target, 150, path)
            : null;
        const existing = markers.get(id);
        if (!existing) {
            markers.set(id, {
                marker: createMarker(bus, routeBearing, busLayer),
                position: target,
                animFrame: null,
                lastBearing: routeBearing,
                lastRoute: routeNumber(bus)
            });
            return;
        }
        if (existing.animFrame) {
            cancelAnimationFrame(existing.animFrame);
        }
        const current = existing.marker.getLatLng();
        const bearingChanged = routeBearing !== existing.lastBearing;
        const routeChanged = routeNumber(bus) !== existing.lastRoute;
        if (bearingChanged || routeChanged) {
            existing.marker.setIcon(busIcon(bus, routeBearing));
            existing.lastBearing = routeBearing;
            existing.lastRoute = routeNumber(bus);
        }
        existing.marker.setPopupContent(popupContent(bus));
        existing.animFrame = routeBearing != null
            ? animateAlongPath(existing.marker, [current.lat, current.lng], target, shape, refreshIntervalMs, true)
            : animateMarker(existing.marker, [current.lat, current.lng], target, refreshIntervalMs);
        existing.position = target;
    });

    markers.forEach((entry, id) => {
        if (!visibleIds.has(id)) {
            busLayer.removeLayer(entry.marker);
            markers.delete(id);
        }
    });

    const count = visibleIds.size;
    const summary = selectedVariants.size
        ? `${count} bus${count === 1 ? "" : "es"}`
        : `${count} buses in view`;
    status.textContent = `${summary} | Updated ${new Date().toLocaleTimeString()}`;
}

function bboxString() {
    const bounds = map.getBounds();
    return [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()].join(",");
}

export function updateBuses() {
    const token = fetchToken + 1;
    setFetchToken(token);
    const url = selectedVariants.size
        ? "/api/vehicles"
        : `/api/vehicles?bbox=${encodeURIComponent(bboxString())}`;
    fetch(url)
        .then(response => response.json().then(data => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            if (token !== fetchToken) {
                return;
            }
            if (!ok) {
                throw new Error(data.error || "Unable to load buses");
            }
            setCurrentVehicles(data.vehicles);
            currentVehicles.forEach(bus => ensureShape(bus.shape_id));
            renderBuses();
        })
        .catch(error => {
            if (token === fetchToken) {
                status.textContent = error.message;
            }
        });
}

function loadAllStops() {
    if (allStops) {
        return Promise.resolve(allStops);
    }
    return fetch("/api/stops")
        .then(response => response.json().then(data => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            setAllStops(ok ? data.stops || [] : []);
            return allStops;
        })
        .catch(() => {
            setAllStops([]);
            return allStops;
        });
}

function onStopClick(stop, color, marker) {
    showStopTimetable(stop);
}

function doRenderRouteLayer() {
    renderRouteLayerBase(routeLayer, stopLayer, map, onStopClick, renderBuses, () => updateClearButton(selectedVariants.size));
}

function doClearSelection() {
    clearSelectionBase(routeLayer, stopLayer, setPaneOpen, renderStopLayer, () => updateClearButton(selectedVariants.size));
}

function doApplySelection(value, families, agencyId) {
    applySelection(value, families, agencyId, addVariant, addFamilies, buildVariantPanel, doRenderRouteLayer);
    if (selectedVariants.size) {
        setPaneOpen(true);
    }
}

function onViewportChanged() {
    clearTimeout(viewportTimer);
    const timer = setTimeout(() => {
        renderStopLayer();
        if (!selectedVariants.size) {
            updateBuses();
        }
    }, 300);
    setViewportTimer(timer);
}

function selectRoute(value, agencyId, addMode) {
    fetch(`/api/routes/variants/${encodeURIComponent(value)}`)
        .then(response => response.json().then(data => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) {
                status.textContent = "Unable to load route";
                return;
            }
            if (!addMode) {
                doClearSelection();
            }
            doApplySelection(value, data.families || [], agencyId);
        })
        .catch(() => {
            status.textContent = "Unable to load route";
        });
}

function onSelectRoute(value, agencyId, addMode) {
    if (value == null) {
        doClearSelection();
        updateBuses();
        return;
    }
    selectRoute(value, agencyId, addMode);
}

setSearchRouteCallback(onSelectRoute);
initSearch(updateBuses);
initTimetable(onSelectRoute);

map.on("moveend", onViewportChanged);

updateBuses();
setInterval(updateBuses, refreshIntervalMs);
