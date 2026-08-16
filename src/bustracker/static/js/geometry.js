import { METERS_PER_DEGREE } from "./utils.js";
import { findSegmentIndex } from "./utils.js";

export function buildPath(points) {
    const lat0 = (points.reduce((sum, point) => sum + point[0], 0) / points.length) * Math.PI / 180;
    const cosLat = Math.cos(lat0) || 1;
    const xy = points.map(point => [point[0], point[1] * cosLat]);
    const cumulative = [0];
    for (let i = 1; i < xy.length; i++) {
        cumulative.push(cumulative[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
    }
    return { xy, cumulative, cosLat };
}

export function projectToPath(point, path) {
    const x = point[0];
    const y = point[1] * path.cosLat;
    let best = { cumDist: 0, segment: 0, t: 0, dist: Infinity };
    let bestDist2 = Infinity;
    let cum = 0;
    for (let i = 1; i < path.xy.length; i++) {
        const ax = path.xy[i - 1][0], ay = path.xy[i - 1][1];
        const bx = path.xy[i][0], by = path.xy[i][1];
        const abx = bx - ax, aby = by - ay;
        const apx = x - ax, apy = y - ay;
        const len2 = abx * abx + aby * aby;
        let t = len2 ? (apx * abx + apy * aby) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const px = ax + abx * t, py = ay + aby * t;
        const dx = x - px, dy = y - py;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < bestDist2) {
            bestDist2 = dist2;
            best = { cumDist: cum + Math.sqrt(len2) * t, segment: i, t, dist: Math.sqrt(dist2) };
        }
        cum += Math.sqrt(len2);
    }
    return best;
}

export function pointAtDistance(path, distance) {
    const i = findSegmentIndex(path.cumulative, distance);
    if (i === 0) {
        return [path.xy[0][0], path.xy[0][1] / path.cosLat];
    }
    const segLen = path.cumulative[i] - path.cumulative[i - 1];
    const t = segLen > 0 ? (distance - path.cumulative[i - 1]) / segLen : 0;
    const px = path.xy[i - 1][0] + (path.xy[i][0] - path.xy[i - 1][0]) * t;
    const py = path.xy[i - 1][1] + (path.xy[i][1] - path.xy[i - 1][1]) * t;
    return [px, py / path.cosLat];
}

export function bearingAtDistance(path, distance) {
    const i = Math.max(1, findSegmentIndex(path.cumulative, distance));
    const a = path.xy[i - 1];
    const b = path.xy[i];
    const angle = Math.atan2(b[0] - a[0], b[1] - a[1]);
    return (90 - angle * 180 / Math.PI + 360) % 360;
}

export function pathBearingAt(points, position, thresholdMeters, cachedPath) {
    const path = cachedPath || buildPath(points);
    const projection = projectToPath(position, path);
    if (projection.dist * METERS_PER_DEGREE > thresholdMeters) {
        return null;
    }
    const a = path.xy[projection.segment - 1];
    const b = path.xy[projection.segment];
    const angle = Math.atan2(b[0] - a[0], b[1] - a[1]);
    return (90 - angle * 180 / Math.PI + 360) % 360;
}
