import { escapeHtml, routeNumber } from "./utils.js";

export const BUS_ICON_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="#e31a1c" aria-hidden="true"><path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1A1.5 1.5 0 0 1 6 15.5 1.5 1.5 0 0 1 7.5 14 1.5 1.5 0 0 1 9 15.5 1.5 1.5 0 0 1 7.5 17zm9 0a1.5 1.5 0 0 1-1.5-1.5 1.5 1.5 0 0 1 1.5-1.5 1.5 1.5 0 0 1 1.5 1.5 1.5 1.5 0 0 1-1.5 1.5zM5 11V6h14v5H5z"/></svg>`;

export function busIcon(bus, bearingOverride) {
    const bearing = bearingOverride != null
        ? bearingOverride
        : (Number.isFinite(Number(bus.bearing)) ? Number(bus.bearing) : 0);
    return L.divIcon({
        className: "",
        html: `<div class="bus-icon"><div class="bus-arrow-wrap" style="transform: rotate(${bearing}deg)"><div class="bus-arrow"></div></div><div class="bus-circle">${BUS_ICON_SVG}</div><span class="route-label">${escapeHtml(routeNumber(bus))}</span></div>`,
        iconSize: [44, 58],
        iconAnchor: [22, 22],
        popupAnchor: [0, -22]
    });
}

export function popupContent(bus) {
    const lines = [];
    const route = escapeHtml(routeNumber(bus));
    lines.push(bus.destination ? `${route} - to ${escapeHtml(bus.destination)}` : route);

    const lastUpdated = bus.timestamp;
    if (Number.isFinite(Number(lastUpdated)) && lastUpdated > 0) {
        const ageSeconds = Date.now() / 1000 - lastUpdated;
        const stale = ageSeconds > 5 * 60;
        lines.push(
            `Last updated ${new Date(lastUpdated * 1000).toLocaleTimeString()}${stale ? " *" : ""}`
        );
        if (stale) {
            lines.push("No GPS Signal");
        }
    }

    lines.push(
        `<button type="button" class="popup-route-btn" data-route="${route}" data-agency="${escapeHtml(bus.agency ?? "")}">Show route</button>`
    );

    return lines.join("<br>");
}

export function createMarker(bus, bearing, layer) {
    const marker = L.marker([bus.latitude, bus.longitude], { icon: busIcon(bus, bearing) });
    marker.bindPopup(popupContent(bus));
    marker.addTo(layer);
    return marker;
}