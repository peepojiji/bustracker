export const irelandBounds = [
    [51.35, -10.75],
    [55.45, -5.4]
];
export const corkCenter = [51.8985, -8.4756];
export const refreshIntervalMs = 15000;
export const PALETTE = ["#2563eb", "#16a34a", "#9333ea", "#dc2626", "#0891b2", "#d97706", "#db2777", "#4d7c0f", "#0e7490", "#7c2d12"];
export const METERS_PER_DEGREE = 111000;
export const OFF_ROUTE_METERS = 150;
export const AGENCY_NAMES = {
    "1": "Dublin Bus",
    "2": "Bus Éireann",
    "3": "Go-Ahead Ireland",
    "03C": "Go-Ahead Ireland",
    "WFRD": "Bus Éireann Waterford",
    "10000": "Luas",
    "IR": "Irish Rail"
};
export function agencyLabel(agency) {
    return AGENCY_NAMES[agency] || `Operator ${agency}`;
}
export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        "\"": "&quot;"
    })[character]);
}
export function routeNumber(bus) {
    if (bus.route_number) {
        return bus.route_number;
    }
    const parts = String(bus.route_id ?? "Unknown").split(" ");
    return parts.length > 1 ? parts[1] : parts[0];
}
export function variantKey(routeNumber, agency) {
    return `${agency}|${routeNumber}`;
}
export function findSegmentIndex(cumulative, distance) {
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] < distance) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}
export function nextColor(usedColors) {
    const used = new Set(usedColors);
    return PALETTE.find(color => !used.has(color)) || PALETTE[used.size % PALETTE.length];
}
