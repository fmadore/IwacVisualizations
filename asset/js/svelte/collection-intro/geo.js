/**
 * The six countries as SVG paths, from the committed
 * asset/geo/iwac-countries.geojson.
 *
 * A plain equirectangular projection, its longitudes shortened by the cosine
 * of the middle latitude: between 4° and 24° N the distortion is a few per
 * cent, far below what a reader of a locator map notices, and it needs no
 * projection library. Points closer than half a unit to the one before are
 * dropped, which takes the geometry from ~6,600 points to the few hundred a
 * map this size can show.
 *
 * Labels sit inside their country, on two lines when one is too wide.
 * Togo and Benin are too narrow for their names at any useful size, so they
 * are placed outside, with a leader: Togo to the west, where no country is
 * drawn, Benin to the south, over the Gulf of Guinea. Those two placements
 * are tied to this geometry file and its six countries; a country the table
 * does not know is labelled inside.
 */

/** Width of the drawing in SVG units; the height follows the countries. */
export const MAP_WIDTH = 600;
/** Label size in SVG units: ~13 px when the map is drawn ~330 px wide. */
export const LABEL_SIZE = 24;
/** Average advance of a label character, as a share of the font size. */
const CHAR_WIDTH = 0.56;
const OUTSIDE = { TGO: 'west', BEN: 'south' };

/** A name as a comparison key: NFC, lower case, one kind of apostrophe. */
export function nameKey(name) {
    return String(name == null ? '' : name).normalize('NFC').toLowerCase().replace(/[’`´]/g, '\'').trim();
}

function polygonsOf(geometry) {
    if (!geometry || !Array.isArray(geometry.coordinates)) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates;
    return [];
}

/** Shoelace area (signed) and centroid of one projected ring. */
function ringStats(ring) {
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x0, y0] = ring[j];
        const [x1, y1] = ring[i];
        const cross = x0 * y1 - x1 * y0;
        area += cross;
        cx += (x0 + x1) * cross;
        cy += (y0 + y1) * cross;
    }
    area /= 2;
    if (Math.abs(area) < 1e-9) {
        const xs = ring.map((p) => p[0]);
        const ys = ring.map((p) => p[1]);
        return { area: 0, cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
    }
    return { area: Math.abs(area), cx: cx / (6 * area), cy: cy / (6 * area) };
}

const round = (v) => Math.round(v * 10) / 10;

/**
 * @param {object} geo  a GeoJSON FeatureCollection
 * @param {Map<string, object>} byName  nameKey(country) → the ledger row it draws
 * @returns {{width:number, height:number, shapes:object[]}|null}
 */
export function projectCountries(geo, byName) {
    const features = (geo && Array.isArray(geo.features) ? geo.features : [])
        .map((f) => ({ f, polys: polygonsOf(f && f.geometry) }))
        .filter((x) => x.polys.length);
    if (!features.length) return null;

    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const { polys } of features) {
        for (const poly of polys) {
            for (const [lon, lat] of poly[0] || []) {
                if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
                if (lon < minLon) minLon = lon;
                if (lon > maxLon) maxLon = lon;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            }
        }
    }
    if (!(maxLon > minLon && maxLat > minLat)) return null;
    const kx = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const scale = MAP_WIDTH / ((maxLon - minLon) * kx);
    const project = ([lon, lat]) => [(lon - minLon) * kx * scale, (maxLat - lat) * scale];
    const height = Math.round((maxLat - minLat) * scale);

    const shapes = [];
    for (const { f, polys } of features) {
        const props = f.properties || {};
        const name = props.name || props.name_en || '';
        const row = byName.get(nameKey(name)) || null;
        let d = '';
        let main = null;
        for (const poly of polys) {
            poly.forEach((ring, r) => {
                const pts = [];
                for (const coord of ring) {
                    if (!Array.isArray(coord) || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) continue;
                    const p = project(coord);
                    const last = pts[pts.length - 1];
                    if (!last || Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= 0.5) pts.push(p);
                }
                if (pts.length < 3) return;
                d += 'M' + pts.map((p) => round(p[0]) + ',' + round(p[1])).join('L') + 'Z';
                if (r === 0) {
                    const stats = ringStats(pts);
                    if (!main || stats.area > main.area) {
                        const xs = pts.map((p) => p[0]);
                        const ys = pts.map((p) => p[1]);
                        main = { ...stats, minX: Math.min(...xs), maxX: Math.max(...xs), maxY: Math.max(...ys) };
                    }
                }
            });
        }
        if (!d || !main) continue;
        shapes.push({ name: row ? row.name : name, row, d, label: placeLabel(row ? row.name : name, props.iso_a3, main) });
    }
    return shapes.length ? { width: MAP_WIDTH, height, shapes } : null;
}

function placeLabel(name, iso, main) {
    const width = (text) => text.length * CHAR_WIDTH * LABEL_SIZE;
    const cx = round(main.cx);
    const cy = round(main.cy);
    const side = OUTSIDE[iso];
    if (side === 'west') {
        const x = round(main.minX - LABEL_SIZE * 0.5);
        return { lines: [name], x, y: cy, anchor: 'end', leader: { x1: x + 3, y1: cy - LABEL_SIZE * 0.33, x2: cx, y2: cy - LABEL_SIZE * 0.33 } };
    }
    if (side === 'south') {
        const y = round(main.maxY + LABEL_SIZE * 1.3);
        return { lines: [name], x: cx, y, anchor: 'middle', leader: { x1: cx, y1: y - LABEL_SIZE * 0.9, x2: cx, y2: round(main.maxY - LABEL_SIZE * 0.6) } };
    }
    const room = (main.maxX - main.minX) * 0.92;
    const words = name.split(' ');
    if (width(name) > room && words.length > 1) {
        const half = Math.ceil(words.length / 2);
        return { lines: [words.slice(0, half).join(' '), words.slice(half).join(' ')], x: cx, y: cy - LABEL_SIZE * 0.25, anchor: 'middle', leader: null };
    }
    return { lines: [name], x: cx, y: round(cy + LABEL_SIZE * 0.35), anchor: 'middle', leader: null };
}
