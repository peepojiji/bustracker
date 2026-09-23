export const markers = new Map();
export const selectedVariants = new Map();
export const chipElements = new Map();
export const availableFamilies = new Map();
export const shapeCache = new Map();
export const pathCache = new Map();

export let currentVehicles = [];
export let allStops = null;
export let currentTimetableStop = null;
export let paneOpen = false;
export let routePromise = null;
export let suggestionIndex = -1;
export let fetchToken = 0;
export let viewportTimer = null;

export function setCurrentVehicles(v) { currentVehicles = v; }
export function setAllStops(s) { allStops = s; }
export function setCurrentTimetableStop(s) { currentTimetableStop = s; }
export function setPaneOpenState(v) { paneOpen = v; }
export function setRoutePromise(v) { routePromise = v; }
export function setSuggestionIndex(v) { suggestionIndex = v; }
export function setFetchToken(v) { fetchToken = v; }
export function setViewportTimer(v) { viewportTimer = v; }

export const status = document.getElementById("status");
export const routeForm = document.getElementById("route-form");
export const searchInput = document.getElementById("route-search");
export const clearButton = document.getElementById("clear-search");
export const variantPanel = document.getElementById("variant-panel");
export const suggestionsContainer = document.getElementById("route-suggestions");
export const leftPane = document.getElementById("left-pane");
export const paneToggle = document.getElementById("pane-toggle");
export const timetableStopName = document.getElementById("timetable-stop-name");
export const timetableContent = document.getElementById("timetable-content");
export const timetableRefresh = document.getElementById("timetable-refresh");

export function setPaneOpen(open) {
    setPaneOpenState(open);
    leftPane.classList.toggle("open", open);
    paneToggle.textContent = open ? "\u25c0" : "\u2630";
    paneToggle.setAttribute("aria-expanded", String(open));
}

export function syncPaneMode() {
    const showingTimetable = Boolean(currentTimetableStop);
    leftPane.classList.toggle("compact", !showingTimetable);
    const timetableSection = document.getElementById("pane-timetable");
    if (timetableSection) {
        timetableSection.style.display = showingTimetable ? "" : "none";
    }
}
