import { buildPath, projectToPath, pointAtDistance, bearingAtDistance } from "./geometry.js";

export function animateMarker(marker, from, to, duration) {
    const start = performance.now();
    let frameId;
    function frame(now) {
        const progress = Math.min((now - start) / duration, 1);
        const latitude = from[0] + (to[0] - from[0]) * progress;
        const longitude = from[1] + (to[1] - from[1]) * progress;
        marker.setLatLng([latitude, longitude]);
        if (progress < 1) {
            frameId = requestAnimationFrame(frame);
        }
    }
    frameId = requestAnimationFrame(frame);
    return frameId;
}

export function animateAlongPath(marker, from, to, shape, duration, trackBearing) {
    if (shape.length < 2) {
        return animateMarker(marker, from, to, duration);
    }
    const path = buildPath(shape);
    const fromDistance = projectToPath(from, path).cumDist;
    const toDistance = projectToPath(to, path).cumDist;
    const total = path.cumulative[path.cumulative.length - 1];
    const fromStart = Math.max(0, Math.min(fromDistance, total));
    const toEnd = Math.max(0, Math.min(toDistance, total));
    const start = performance.now();
    let frameId;

    function frame(now) {
        const progress = Math.min((now - start) / duration, 1);
        const distance = fromStart + (toEnd - fromStart) * progress;
        marker.setLatLng(pointAtDistance(path, distance));
        if (trackBearing) {
            const wrap = marker.getElement()?.querySelector(".bus-arrow-wrap");
            if (wrap) {
                wrap.style.transform = `rotate(${bearingAtDistance(path, distance)}deg)`;
            }
        }
        if (progress < 1) {
            frameId = requestAnimationFrame(frame);
        }
    }

    frameId = requestAnimationFrame(frame);
    return frameId;
}
