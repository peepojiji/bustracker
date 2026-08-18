import { agencyLabel } from "./utils.js";
import {
    searchInput, suggestionsContainer, clearButton, routeForm,
    selectedVariants, setSuggestionIndex, suggestionIndex, routePromise, setRoutePromise
} from "./state.js";

let onSelectRoute = null;

export function setSearchRouteCallback(cb) {
    onSelectRoute = cb;
}

export function updateClearButton(selectedVariantCount) {
    clearButton.style.display = (searchInput.value.trim() || selectedVariantCount) ? "inline-flex" : "none";
}

function closeSuggestions() {
    suggestionsContainer.innerHTML = "";
    suggestionsContainer.style.display = "none";
    searchInput.setAttribute("aria-expanded", "false");
    setSuggestionIndex(-1);
}

function getRoutes() {
    if (!routePromise) {
        setRoutePromise(
            fetch("/api/routes")
                .then(response => response.json().then(data => ({ ok: response.ok, data })))
                .then(({ ok, data }) => {
                    if (!ok) {
                        throw new Error(data.error || "Unable to load routes");
                    }
                    return data.routes || [];
                })
                .catch(error => {
                    setRoutePromise(null);
                    throw error;
                })
        );
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
    setSuggestionIndex(-1);
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

function submitRoute(value, agencyId, addMode) {
    closeSuggestions();
    searchInput.value = value ?? "";
    const query = String(value ?? "").trim();
    if (!query) {
        onSelectRoute(null, agencyId, addMode);
        return;
    }
    onSelectRoute(query, agencyId, addMode);
}

export function initSearch(updateBuses) {
    searchInput.addEventListener("focus", () => {
        const query = searchInput.value.trim();
        if (query) {
            searchInput.dispatchEvent(new Event("input"));
        }
    });

    searchInput.addEventListener("input", () => {
        updateClearButton(selectedVariants.size);
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
            setSuggestionIndex((suggestionIndex + 1) % options.length);
            highlightSuggestion(suggestionIndex);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setSuggestionIndex((suggestionIndex - 1 + options.length) % options.length);
            highlightSuggestion(suggestionIndex);
        } else if (event.key === "Enter") {
            if (suggestionIndex >= 0) {
                const active = options[suggestionIndex];
                if (active) {
                    event.preventDefault();
                    submitRoute(active.dataset.shortName, active.dataset.agency, false);
                }
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
        submitRoute(searchInput.value, undefined, false);
    });

    clearButton.addEventListener("click", () => {
        searchInput.value = "";
        closeSuggestions();
        onSelectRoute(null, undefined, false);
        updateBuses();
    });
}
