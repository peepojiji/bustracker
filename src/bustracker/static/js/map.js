import { irelandBounds, corkCenter, refreshIntervalMs, PALETTE, agencyLabel, escapeHtml, routeNumber, variantKey, findSegmentIndex, nextColor } from "./utils.js";
import { buildPath, projectToPath, pathBearingAt } from "./geometry.js";
import { busIcon, popupContent, createMarker } from "./icons.js";
import { animateMarker, animateAlongPath } from "./animation.js";

const map = L.map("map", {
    maxBounds: irelandBounds,
    maxBoundsViscosity: 1.0,
    zoomControl: false
}).setView(corkCenter, 13);
L.control.zoom({ position: "bottomright" }).addTo(map);
const busLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const markers = new Map();
const status = document.getElementById("status");
const routeForm = document.getElementById("route-form");
const searchInput = document.getElementById("route-search");
const clearButton = document.getElementById("clear-search");
let currentVehicles = [];
const selectedVariants = new Map();
const chipElements = new Map();
const availableFamilies = new Map();
const variantPanel = document.getElementById("variant-panel");
const suggestionsContainer = document.getElementById("route-suggestions");
const leftPane = document.getElementById("left-pane");
const paneToggle = document.getElementById("pane-toggle");
const timetableStopName = document.getElementById("timetable-stop-name");
const timetableContent = document.getElementById("timetable-content");
const timetableRefresh = document.getElementById("timetable-refresh");
let currentTimetableStop = null;
let paneOpen = false;
let routePromise = null;
let suggestionIndex = -1;
let fetchToken = 0;
let viewportTimer = null;

function setPaneOpen(open) {
    paneOpen = open;
    leftPane.classList.toggle("open", open);
    paneToggle.textContent = open ? "◀" : "☰";
    paneToggle.setAttribute("aria-expanded", String(open));
}

paneToggle.addEventListener("click", () => setPaneOpen(!paneOpen));

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
}).addTo(map);

const shapeCache = new Map();
const pathCache = new Map();

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

function visibleBuses() {
    if (!selectedVariants.size) {
        return currentVehicles;
    }
    return currentVehicles.filter(bus => selectedVariants.has(variantKey(routeNumber(bus), bus.agency)));
}

function ensureVariantDetail(key) {
    const variant = selectedVariants.get(key);
    if (!variant || variant.detail || variant.loading) {
        return;
    }
    variant.loading = true;
    fetch(`/api/route/${encodeURIComponent(variant.routeNumber)}`)
        .then(response => response.json().then(data => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            if (ok) {
                variant.detail = data;
            }
            variant.loading = false;
            renderRouteLayer();
        })
        .catch(() => {
            variant.loading = false;
        });
}

function renderRouteLayer() {
    routeLayer.clearLayers();
    const bounds = L.latLngBounds();

    selectedVariants.forEach(variant => {
        if (!variant.detail) {
            return;
        }
        (variant.detail.routes || []).forEach(route => {
            if (route.agency !== variant.agency) {
                return;
            }
            (route.shapes || []).forEach(shape => {
                if (shape.length) {
                    L.polyline(shape, { color: variant.color, weight: 4, opacity: 0.85 }).addTo(routeLayer);
                    shape.forEach(point => bounds.extend(point));
                }
            });
            (route.stops || []).forEach(stop => {
                const marker = L.circleMarker([stop.latitude, stop.longitude], {
                    radius: 5,
                    color: variant.color,
                    fillColor: variant.color,
                    fillOpacity: 0.9,
                    weight: 1
                });
                marker.on("click", () => showStopTimetable(stop));
                marker.addTo(routeLayer);
            });
        });
    });

    if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40] });
    }
    updateClearButton();
    renderBuses();
}

function addFamilies(families) {
    families.forEach(family => {
        const key = `${family.base}|${family.agency}`;
        if (!availableFamilies.has(key)) {
            availableFamilies.set(key, family);
        }
    });
}

function buildVariantPanel() {
    variantPanel.innerHTML = "";
    variantPanel.style.display = availableFamilies.size ? "block" : "none";
    chipElements.clear();

    availableFamilies.forEach(family => {
        const group = document.createElement("div");
        group.className = "variant-group";

        const label = document.createElement("span");
        label.className = "variant-group-label";
        label.textContent = `Route ${family.base} · ${agencyLabel(family.agency)}`;
        group.appendChild(label);

        family.routes.forEach(name => {
            const key = variantKey(name, family.agency);
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "variant-chip";
            chip.textContent = name;
            chipElements.set(key, chip);

            const variant = selectedVariants.get(key);
            if (variant) {
                chip.classList.add("active");
                chip.style.setProperty("--chip-color", variant.color);
            }
            chip.addEventListener("click", () => toggleVariant(key, name, family.agency));
            group.appendChild(chip);
        });

        variantPanel.appendChild(group);
    });
}

function toggleVariant(key, routeNumber, agency) {
    if (selectedVariants.has(key) && selectedVariants.size === 1) {
        status.textContent = "At least one route must stay selected — use ✕ to clear.";
        return;
    }
    if (selectedVariants.has(key)) {
        selectedVariants.delete(key);
    } else {
        selectedVariants.set(key, {
            routeNumber,
            agency,
            color: nextColor([...selectedVariants.values()].map(v => v.color)),
            detail: null,
            loading: false
        });
        ensureVariantDetail(key);
    }
    const chip = chipElements.get(key);
    if (chip) {
        chip.classList.toggle("active");
        const variant = selectedVariants.get(key);
        if (variant) {
            chip.style.setProperty("--chip-color", variant.color);
        }
    }
    renderRouteLayer();
}

function departureTimeLabel(minutes) {
    const normalized = ((minutes % 1440) + 1440) % 1440;
    const hours = String(Math.floor(normalized / 60)).padStart(2, "0");
    const mins = String(normalized % 60).padStart(2, "0");
    return `${hours}:${mins}`;
}

function loadStopTimetable() {
    const stop = currentTimetableStop;
    if (!stop) {
        return;
    }
    timetableContent.textContent = "Loading departures…";

    fetch(`/api/stop/${encodeURIComponent(stop.stop_id)}/departures`)
        .then(response => response.json().then(data => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            const departures = ok ? data.departures || [] : [];
            if (!departures.length) {
                timetableContent.textContent = "No scheduled departures in the next 3 hours.";
                return;
            }
            const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
            timetableContent.innerHTML = "";
            const list = document.createElement("div");
            list.className = "departures";
            departures.forEach(departure => {
                let occurrence = departure.minutes;
                if (occurrence < nowMinutes) {
                    occurrence += 1440;
                }
                const relative = occurrence - nowMinutes;
                const row = document.createElement("div");
                row.className = "departure-row";

                const time = document.createElement("span");
                time.className = "departure-time";
                time.textContent = departureTimeLabel(departure.minutes);

                const route = document.createElement("button");
                route.type = "button";
                route.className = "departure-route";
                route.textContent = departure.route_number;
                route.title = `Select route ${departure.route_number}`;
                route.addEventListener("click", () => submitRoute(departure.route_number, departure.agency_id, false));

                const destination = document.createElement("span");
                destination.className = "departure-dest";
                destination.textContent = departure.destination || "Unknown destination";

                const when = document.createElement("span");
                when.className = "departure-when";
                when.textContent = relative <= 1 ? "now" : `in ${relative} min`;

                row.append(time, route, destination, when);
                list.appendChild(row);
            });
            timetableContent.appendChild(list);
        })
        .catch(() => {
            timetableContent.textContent = "Unable to load departures.";
        });
}

function showStopTimetable(stop) {
    currentTimetableStop = stop;
    setPaneOpen(true);
    timetableStopName.textContent = stop.name;
    loadStopTimetable();
}

timetableRefresh.addEventListener("click", loadStopTimetable);
setInterval(() => {
    if (currentTimetableStop) {
        loadStopTimetable();
    }
}, 30000);

function clearSelection() {
    selectedVariants.clear();
    availableFamilies.clear();
    chipElements.clear();
    variantPanel.innerHTML = "";
    variantPanel.style.display = "none";
    routeLayer.clearLayers();
    updateClearButton();
    setPaneOpen(false);
}

function updateClearButton() {
    clearButton.style.display = (searchInput.value.trim() || selectedVariants.size) ? "inline-flex" : "none";
}

function clearSearch() {
    searchInput.value = "";
    closeSuggestions();
    clearSelection();
    updateBuses();
}

clearButton.addEventListener("click", clearSearch);

function addVariant(key, routeNumber, agency, detail) {
    if (selectedVariants.has(key)) {
        return false;
    }
    selectedVariants.set(key, {
        routeNumber,
        agency,
        color: nextColor([...selectedVariants.values()].map(v => v.color)),
        detail: detail ?? null,
        loading: false
    });
    if (detail == null) {
        ensureVariantDetail(key);
    }
    return true;
}

function applySelection(value, families, agencyId) {
    if (!families.length) {
        fetch(`/api/route/${encodeURIComponent(value)}`)
            .then(response => response.json().then(data => ({ ok: response.ok, data })))
            .then(({ ok, data }) => {
                if (!ok) {
                    status.textContent = data.error || "Route not found";
                    return;
                }
                const matched = agencyId
                    ? (data.routes || []).filter(route => route.agency === agencyId)
                    : (data.routes || []);
                const agencies = [...new Set(matched.map(route => route.agency))];
                const family = { agency: agencyId ?? agencies[0] ?? "?", base: value, routes: [value] };
                addFamilies([family]);
                addVariant(variantKey(value, family.agency), value, family.agency, data);
                setPaneOpen(true);
                buildVariantPanel();
                renderRouteLayer();
            })
            .catch(() => {
                status.textContent = "Unable to load route";
            });
        return;
    }

    const candidates = agencyId ? families.filter(family => family.agency === agencyId) : families;
    addFamilies(agencyId ? families.filter(family => family.agency === agencyId) : families);
    (candidates.length ? candidates : families).forEach(family => {
        const hasExact = family.routes.includes(value);
        const name = hasExact ? value : (family.base === value && family.routes.length ? family.routes[0] : null);
        if (!name) {
            return;
        }
        addVariant(variantKey(name, family.agency), name, family.agency, null);
    });

    if (selectedVariants.size) {
        setPaneOpen(true);
    }
    buildVariantPanel();
    renderRouteLayer();
}

function submitRoute(value, agencyId, addMode) {
    closeSuggestions();
    searchInput.value = value ?? "";
    const query = String(value ?? "").trim();
    if (!query) {
        clearSelection();
        updateBuses();
        return;
    }
    selectRoute(query, agencyId, addMode);
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
                clearSelection();
            }
            applySelection(value, data.families || [], agencyId);
        })
        .catch(() => {
            status.textContent = "Unable to load route";
        });
}

function getRoutes() {
    if (!routePromise) {
        routePromise = fetch("/api/routes")
            .then(response => response.json().then(data => ({ ok: response.ok, data })))
            .then(({ ok, data }) => {
                if (!ok) {
                    throw new Error(data.error || "Unable to load routes");
                }
                return data.routes || [];
            })
            .catch(error => {
                routePromise = null;
                throw error;
            });
    }
    return routePromise;
}

function filterRoutes(routes, query) {
    const prefix = query.trim().toLowerCase();
    if (!prefix) {
        return [];
    }
    const seen = new Set();
    return routes
        .filter(route => String(route.short_name).toLowerCase().startsWith(prefix))
        .filter(route => {
            const key = `${route.short_name}|${route.agency_id}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        })
        .sort((a, b) => agencyLabel(a.agency_id).localeCompare(agencyLabel(b.agency_id))
            || String(a.short_name).localeCompare(String(b.short_name)))
        .slice(0, 50);
}

function renderSuggestions(routes) {
    suggestionsContainer.innerHTML = "";
    suggestionIndex = -1;
    suggestionsContainer.style.display = routes.length ? "block" : "none";
    searchInput.setAttribute("aria-expanded", routes.length ? "true" : "false");

    const groups = new Map();
    routes.forEach(route => {
        const label = agencyLabel(route.agency_id);
        if (!groups.has(label)) {
            groups.set(label, []);
        }
        groups.get(label).push(route);
    });

    groups.forEach(groupRoutes => {
        const header = document.createElement("div");
        header.className = "route-suggestion-group";
        header.textContent = agencyLabel(groupRoutes[0].agency_id);
        suggestionsContainer.appendChild(header);

        groupRoutes
            .sort((a, b) => String(a.short_name).localeCompare(String(b.short_name)))
            .forEach(route => {
                const item = document.createElement("div");
                item.className = "route-suggestion";
                item.setAttribute("role", "option");
                item.dataset.shortName = route.short_name;
                item.dataset.agency = route.agency_id;

                const number = document.createElement("span");
                number.className = "suggestion-number";
                number.textContent = route.short_name;

                const add = document.createElement("button");
                add.type = "button";
                add.className = "suggestion-add";
                add.textContent = "+";
                add.title = `Add ${route.short_name} to the map`;
                add.setAttribute("aria-label", `Add route ${route.short_name} to the map`);

                item.append(number, add);
                item.addEventListener("mousedown", event => {
                    if (event.target.closest(".suggestion-add")) {
                        return;
                    }
                    event.preventDefault();
                    submitRoute(route.short_name, route.agency_id, false);
                });
                add.addEventListener("mousedown", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    submitRoute(route.short_name, route.agency_id, true);
                });
                suggestionsContainer.appendChild(item);
            });
    });
}

function highlightSuggestion(index) {
    suggestionsContainer.querySelectorAll(".route-suggestion").forEach((child, i) => child.classList.toggle("active", i === index));
}

function closeSuggestions() {
    suggestionsContainer.innerHTML = "";
    suggestionsContainer.style.display = "none";
    searchInput.setAttribute("aria-expanded", "false");
    suggestionIndex = -1;
}

searchInput.addEventListener("focus", () => {
    const query = searchInput.value.trim();
    if (query) {
        searchInput.dispatchEvent(new Event("input"));
    }
});

searchInput.addEventListener("input", () => {
    updateClearButton();
    const query = searchInput.value.trim();
    if (!query) {
        closeSuggestions();
        return;
    }
    getRoutes()
        .then(routes => {
            if (searchInput.value.trim() === query) {
                renderSuggestions(filterRoutes(routes, query));
            }
        })
        .catch(() => {});
});

searchInput.addEventListener("keydown", event => {
    const options = [...suggestionsContainer.querySelectorAll(".route-suggestion")];
    if (!options.length) {
        return;
    }
    if (event.key === "ArrowDown") {
        event.preventDefault();
        suggestionIndex = (suggestionIndex + 1) % options.length;
        highlightSuggestion(suggestionIndex);
    } else if (event.key === "ArrowUp") {
        event.preventDefault();
        suggestionIndex = (suggestionIndex - 1 + options.length) % options.length;
        highlightSuggestion(suggestionIndex);
    } else if (event.key === "Enter") {
        const active = options[suggestionIndex];
        if (active) {
            event.preventDefault();
            submitRoute(active.dataset.shortName, active.dataset.agency);
        }
    } else if (event.key === "Escape") {
        closeSuggestions();
    }
});

document.addEventListener("click", event => {
    if (!event.target.closest("#route-form") && !event.target.closest("#route-suggestions")) {
        closeSuggestions();
    }
});

routeForm.addEventListener("submit", event => {
    event.preventDefault();
    submitRoute(searchInput.value);
});

function renderBuses() {
    const visibleIds = new Set();
    visibleBuses().forEach(bus => {
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

function updateBuses() {
    const token = ++fetchToken;
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
            currentVehicles = data.vehicles;
            currentVehicles.forEach(bus => ensureShape(bus.shape_id));
            renderBuses();
        })
        .catch(error => {
            if (token === fetchToken) {
                status.textContent = error.message;
            }
        });
}

function onViewportChanged() {
    clearTimeout(viewportTimer);
    viewportTimer = setTimeout(() => {
        if (!selectedVariants.size) {
            updateBuses();
        }
    }, 300);
}

map.on("moveend", onViewportChanged);

updateBuses();
setInterval(updateBuses, refreshIntervalMs);
