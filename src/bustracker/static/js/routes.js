import { agencyLabel, routeNumber, variantKey, nextColor } from "./utils.js";
import { selectedVariants, availableFamilies, chipElements, status, variantPanel, setCurrentTimetableStop, syncPaneMode } from "./state.js";

export function visibleBuses(currentVehicles) {
    if (!selectedVariants.size) {
        return currentVehicles;
    }
    return currentVehicles.filter(bus => selectedVariants.has(variantKey(routeNumber(bus), bus.agency)));
}

export function ensureVariantDetail(key, onComplete) {
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
            onComplete?.();
        })
        .catch(() => {
            variant.loading = false;
        });
}

export function addFamilies(families) {
    families.forEach(family => {
        const key = `${family.base}|${family.agency}`;
        if (!availableFamilies.has(key)) {
            availableFamilies.set(key, family);
        }
    });
}

export function addVariant(key, rn, agency, detail, onComplete) {
    if (selectedVariants.has(key)) {
        return false;
    }
    selectedVariants.set(key, {
        routeNumber: rn,
        agency,
        color: nextColor([...selectedVariants.values()].map(v => v.color)),
        detail: detail ?? null,
        loading: false
    });
    if (detail == null) {
        ensureVariantDetail(key, onComplete);
    }
    return true;
}

export function toggleVariant(key, rn, agency, onComplete) {
    if (selectedVariants.has(key) && selectedVariants.size === 1) {
        status.textContent = "At least one route must stay selected \u2014 use \u2715 to clear.";
        return;
    }
    if (selectedVariants.has(key)) {
        selectedVariants.delete(key);
    } else {
        selectedVariants.set(key, {
            routeNumber: rn,
            agency,
            color: nextColor([...selectedVariants.values()].map(v => v.color)),
            detail: null,
            loading: false
        });
        ensureVariantDetail(key, onComplete);
    }
    const chip = chipElements.get(key);
    if (chip) {
        chip.classList.toggle("active");
        const variant = selectedVariants.get(key);
        if (variant) {
            chip.style.setProperty("--chip-color", variant.color);
        }
    }
    if (!selectedVariants.has(key)) {
        onComplete?.();
    }
}

export function buildVariantPanel(onToggle) {
    variantPanel.innerHTML = "";
    variantPanel.style.display = availableFamilies.size ? "block" : "none";
    chipElements.clear();

    availableFamilies.forEach(family => {
        const group = document.createElement("div");
        group.className = "variant-group";

        const label = document.createElement("span");
        label.className = "variant-group-label";
        label.textContent = `Route ${family.base} \u00b7 ${agencyLabel(family.agency)}`;
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
            chip.addEventListener("click", () => toggleVariant(key, name, family.agency, onToggle));
            group.appendChild(chip);
        });

        variantPanel.appendChild(group);
    });
}

export function renderRouteLayer(routeLayer, stopLayer, map, onStopClick, renderBuses, updateClearButton) {
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
                    radius: 7,
                    color: "#000000",
                    fillColor: variant.color,
                    fillOpacity: 0.9,
                    weight: 2,
                    bubblingMouseEvents: false
                });
                marker.on("click", () => onStopClick(stop, variant.color, marker));
                marker.addTo(routeLayer);
            });
        });
    });

    if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40] });
    }
    stopLayer.clearLayers();
    updateClearButton();
    renderBuses();
}

export function clearSelection(routeLayer, stopLayer, setPaneOpen, renderStopLayer, updateClearButton) {
    selectedVariants.clear();
    availableFamilies.clear();
    chipElements.clear();
    variantPanel.innerHTML = "";
    variantPanel.style.display = "none";
    routeLayer.clearLayers();
    setCurrentTimetableStop(null);
    syncPaneMode();
    setPaneOpen(false);
    renderStopLayer();
    updateClearButton();
}

export function applySelection(value, families, agencyId, addVariant, addFamilies, buildVariantPanel, renderRouteLayer) {
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
                buildVariantPanel(renderRouteLayer);
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
        addVariant(variantKey(name, family.agency), name, family.agency, null, renderRouteLayer);
    });

    buildVariantPanel(renderRouteLayer);
    renderRouteLayer();
}
