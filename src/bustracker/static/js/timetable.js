import {
    timetableStopName, timetableContent, timetableRefresh,
    currentTimetableStop, setCurrentTimetableStop, setPaneOpen, syncPaneMode
} from "./state.js";

function departureTimeLabel(minutes) {
    const normalized = ((minutes % 1440) + 1440) % 1440;
    const hours = String(Math.floor(normalized / 60)).padStart(2, "0");
    const mins = String(normalized % 60).padStart(2, "0");
    return `${hours}:${mins}`;
}

function loadStopTimetable(onSelectRoute) {
    const stop = currentTimetableStop;
    if (!stop) {
        return;
    }
    timetableContent.textContent = "Loading departures\u2026";

    fetch(`/api/stop/${encodeURIComponent(stop.stop_id)}/departures`)
        .then(response => response.json().then(data => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            const departures = ok ? data.departures || [] : [];
            if (!departures.length) {
                timetableContent.textContent = "No scheduled departures in the next 3 hours.";
                return;
            }
            const nowMinutes = typeof data.now_minutes === "number" ? data.now_minutes : new Date().getHours() * 60 + new Date().getMinutes();
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
                route.addEventListener("click", () => onSelectRoute(departure.route_number, departure.agency_id, false));

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

let timetableRefreshCallback = null;

export function initTimetable(onSelectRoute) {
    timetableRefreshCallback = () => loadStopTimetable(onSelectRoute);
    timetableRefresh.addEventListener("click", timetableRefreshCallback);
    setInterval(() => {
        if (currentTimetableStop) {
            loadStopTimetable(onSelectRoute);
        }
    }, 30000);
}

export function showStopTimetable(stop) {
    setCurrentTimetableStop(stop);
    setPaneOpen(true);
    syncPaneMode();
    timetableStopName.textContent = stop.name;
    loadStopTimetable(timetableRefreshCallback || (() => {}));
}
