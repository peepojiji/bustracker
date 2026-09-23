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
    setPaneOpen, paneOpen, syncPaneMode
} from "./state.js";
import { visibleBuses, addFamilies, addVariant, renderRouteLayer as renderRouteLayerBase, buildVariantPanel, clearSelection as clearSelectionBase, applySelection } from "./routes.js";
import { initSearch, updateClearButton, setSearchRouteCallback } from "./search.js";
import { initTimetable, showStopTimetable } from "./timetable.js";

function parseHashView() {
    const match = window.location.hash.match(/^#(\d{1,2})\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
    if (!match) {
        return null;
    }
    const zoom = Number(match[1]);
    const lat = Number(match[2]);
    const lng = Number(match[3]);
    const valid = Number.isFinite(zoom) && Number.isFinite(lat) && Number.isFinite(lng)
        && zoom >= 0 && zoom <= 22 && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    return valid ? { center: [lat, lng], zoom } : null;
}

function syncHashToView() {
    try {
        const center = map.getCenter();
        const hash = `#${map.getZoom()}/${center.lat.toFixed(5)}/${center.lng.toFixed(5)}`;
        if (window.location.hash !== hash) {
            history.replaceState(null, "", hash);
        }
    } catch (error) {
        // hash sync must never break map rendering
    }
}

const initialView = parseHashView() || { center: corkCenter, zoom: 13 };

const map = L.map("map", {
    maxBounds: irelandBounds,
    maxBoundsViscosity: 1.0,
    zoomControl: false
});

map.on("moveend", syncHashToView);
map.setView(initialView.center, initialView.zoom, { animate: false });

L.control.zoom({ position: "bottomright" }).addTo(map);

const LOCATE_ICON = '<i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i>';

const USER_LOCATION_HTML = `
    <div class="user-location">
        <span class="user-location-pulse"></span>
        <span class="user-location-dot"></span>
    </div>`;

function showUserLocation(latitude, longitude) {
    if (!userLocationMarker) {
        userLocationMarker = L.marker([latitude, longitude], {
            icon: L.divIcon({
                className: "user-location-icon",
                html: USER_LOCATION_HTML,
                iconSize: [0, 0],
                iconAnchor: [0, 0]
            }),
            interactive: false
        }).addTo(userLocationLayer);
    } else {
        userLocationMarker.setLatLng([latitude, longitude]);
    }
}

function locateUser() {
    if (!navigator.geolocation) {
        status.textContent = "Geolocation is not supported by this browser.";
        return;
    }
    if (locationWatchId !== null) {
        if (userLocationMarker) {
            recenterOnUser(Math.max(map.getZoom(), 16));
            status.textContent = "Located";
        }
        return;
    }
    status.textContent = "Locating you…";
    userMoved = false;
    locateConvergingUntil = performance.now() + 12000;
    locationWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;
            showUserLocation(latitude, longitude);
            if (!userMoved && performance.now() < locateConvergingUntil) {
                status.textContent = "Located";
                recenterOnUser(Math.max(map.getZoom(), 16));
            }
        },
        (error) => {
            status.textContent = `Location unavailable: ${error.message}`;
            navigator.geolocation.clearWatch(locationWatchId);
            locationWatchId = null;
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
}

let userMoved = false;
let locationSuppressPan = false;
let locateConvergingUntil = 0;

function recenterOnUser(zoom) {
    if (!userLocationMarker) {
        return;
    }
    locationSuppressPan = true;
    map.setView(userLocationMarker.getLatLng(), zoom, { animate: false });
    setTimeout(() => {
        locationSuppressPan = false;
    }, 0);
}

map.on("movestart", () => {
    if (!locationSuppressPan) {
        userMoved = true;
    }
});

const locateControl = L.control({ position: "bottomright" });
locateControl.onAdd = function () {
    const container = L.DomUtil.create("div", "leaflet-bar leaflet-control locate-bar");
    const button = L.DomUtil.create("a", "leaflet-control-locate", container);
    button.href = "#";
    button.title = "Find my location";
    button.setAttribute("role", "button");
    button.setAttribute("aria-label", "Find my location");
    button.innerHTML = LOCATE_ICON;
    L.DomEvent.on(button, "click", event => {
        L.DomEvent.preventDefault(event);
        locateUser();
    });
    L.DomEvent.disableClickPropagation(button);
    return container;
};
locateControl.addTo(map);

const zoomElement = document.querySelector(".leaflet-control-zoom");
const locateBar = document.querySelector(".locate-bar");
if (zoomElement && locateBar) {
    zoomElement.parentNode.insertBefore(locateBar, zoomElement);
}

const busLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const stopLayer = L.layerGroup().addTo(map);

const userLocationLayer = L.layerGroup().addTo(map);
let userLocationMarker = null;
let locationWatchId = null;

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
}).addTo(map);

paneToggle.addEventListener("click", () => setPaneOpen(!paneOpen));
map.on("click", () => {
    if (paneOpen) {
        setPaneOpen(false);
    }
});

const pendingShapes = new Set();
let shapeRequestScheduled = false;

function flushShapeRequests() {
    shapeRequestScheduled = false;
    if (!pendingShapes.size) {
        return;
    }
    const ids = [...pendingShapes];
    pendingShapes.clear();
    fetch(`/api/shapes?ids=${encodeURIComponent(ids.join(","))}`)
        .then(response => response.json().then(data => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            const shapes = (ok && data.shapes) || {};
            ids.forEach(id => {
                shapeCache.set(id, Array.isArray(shapes[id]) ? shapes[id] : []);
                pathCache.delete(id);
            });
            renderBuses();
        })
        .catch(() => {
            ids.forEach(id => {
                shapeCache.delete(id);
                pathCache.delete(id);
                pendingShapes.add(id);
            });
            if (!shapeRequestScheduled && pendingShapes.size) {
                shapeRequestScheduled = true;
                setTimeout(flushShapeRequests, 5000);
            }
        });
}

function ensureShape(shapeId) {
    if (!shapeId || shapeCache.has(shapeId) || pendingShapes.has(shapeId)) {
        return;
    }
    pendingShapes.add(shapeId);
    pathCache.delete(shapeId);
    if (!shapeRequestScheduled) {
        shapeRequestScheduled = true;
        queueMicrotask(flushShapeRequests);
    }
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
            weight: 2,
            bubblingMouseEvents: false
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
            const marker = createMarker(bus, routeBearing, busLayer);
            popupRouteButton(marker);
            markers.set(id, {
                marker,
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

function popupRouteButton(marker) {
    marker.on("popupopen", event => {
        const button = event.popup.getElement()?.querySelector?.(".popup-route-btn");
        if (!button) {
            return;
        }
        button.onclick = () => {
            const agency = button.dataset.agency || null;
            selectRoute(button.dataset.route, agency, false);
        };
    });
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
    syncPaneMode();
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
