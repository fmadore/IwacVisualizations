/**
 * A stand-in for MapLibre GL, as the module's map code sees it.
 *
 * Real MapLibre needs WebGL2 and a Carto basemap over the network; neither
 * belongs in a hermetic fixture. What the module's shared map helpers
 * (charts/shared/maplibre.js, panels-map.js) actually call is a small surface:
 * the constructor, style loads and swaps, sources and layers, feature state,
 * rendered-feature queries, camera moves, controls and popups. This implements
 * that surface on a plain 2D canvas so the module code runs unmodified — the
 * basemap swap on a theme toggle, the layer re-add with the new theme's
 * colours, the click popup, the panel toolbar's table rows.
 *
 * It arrives the way production's does: MapLibre 6 is ESM-only and the
 * on-view loader imports it in PARALLEL with the classic script chain, so the
 * global is usually absent when a map panel first renders. The stub publishes
 * `IWACVisLazy.mjsP` and only sets `window.maplibregl` when that promise
 * settles, exercising the "not yet" path (`P.withMaplibre`). `?maplibre=fail`
 * rejects it instead, for the "Map library unavailable" banner.
 *
 * Every map is pushed onto `window.__fixtureMaps` for the specs to inspect.
 */
(function () {
    'use strict';

    var maps = window.__fixtureMaps = [];

    function el(tag, className, parent) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (parent) parent.appendChild(node);
        return node;
    }

    /* ---- Evented ------------------------------------------------------- */

    function Evented() { this._listeners = {}; }
    Evented.prototype.on = function (type, layerOrFn, maybeFn) {
        var fn = typeof layerOrFn === 'function' ? layerOrFn : maybeFn;
        var layer = typeof layerOrFn === 'string' ? layerOrFn : null;
        (this._listeners[type] = this._listeners[type] || []).push({ fn: fn, layer: layer });
        return this;
    };
    Evented.prototype.once = function (type, fn) {
        var self = this;
        function wrapped(e) { self.off(type, wrapped); fn.call(self, e); }
        return this.on(type, wrapped);
    };
    Evented.prototype.off = function (type, layerOrFn, maybeFn) {
        var fn = typeof layerOrFn === 'function' ? layerOrFn : maybeFn;
        this._listeners[type] = (this._listeners[type] || []).filter(function (l) { return l.fn !== fn; });
        return this;
    };
    Evented.prototype.fire = function (type, data) {
        var self = this;
        (this._listeners[type] || []).slice().forEach(function (l) {
            var event = Object.assign({ type: type, target: self }, data || {});
            if (l.layer) {
                if (!self.getLayer || !self.getLayer(l.layer) || !event.point) return;
                var hits = self.queryRenderedFeatures(event.point, { layers: [l.layer] });
                if (!hits.length) return;
                event.features = hits;
            }
            l.fn.call(self, event);
        });
        return this;
    };

    /* ---- Map ----------------------------------------------------------- */

    var TILE = 512;

    function mercY(lat) {
        var s = Math.sin(lat * Math.PI / 180);
        return Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    }
    function latOf(y) {
        return Math.atan(Math.sinh(y * 2 * Math.PI)) * 180 / Math.PI;
    }

    function StubMap(options) {
        Evented.call(this);
        var container = typeof options.container === 'string'
            ? document.getElementById(options.container)
            : options.container;
        this._container = container;
        this._locale = options.locale || {};
        this._center = { lng: (options.center || [0, 0])[0], lat: (options.center || [0, 0])[1] };
        this._zoom = options.zoom != null ? options.zoom : 0;
        this._sources = {};
        this._layers = [];
        this._featureState = {};
        this._removed = false;
        this.options = options;
        this.styleHistory = [];

        container.classList.add('maplibregl-map');
        var canvasContainer = el('div', 'maplibregl-canvas-container maplibregl-interactive', container);
        var canvas = el('canvas', 'maplibregl-canvas', canvasContainer);
        canvas.setAttribute('tabindex', '0');
        canvas.setAttribute('role', 'region');
        canvas.setAttribute('aria-label', this._locale['Map.Title'] || 'Map');
        this._canvas = canvas;
        var controls = el('div', 'maplibregl-control-container', container);
        this._corners = {};
        var self = this;
        ['top-left', 'top-right', 'bottom-left', 'bottom-right'].forEach(function (pos) {
            self._corners[pos] = el('div', 'maplibregl-ctrl-' + pos, controls);
        });
        if (options.attributionControl !== false) {
            var attrib = el('details', 'maplibregl-ctrl maplibregl-ctrl-attrib maplibregl-compact', this._corners['bottom-right']);
            var summary = el('summary', 'maplibregl-ctrl-attrib-button', attrib);
            summary.title = this._locale['AttributionControl.ToggleAttribution'] || 'Toggle attribution';
            summary.setAttribute('aria-label', summary.title);
            el('div', 'maplibregl-ctrl-attrib-inner', attrib).textContent = '© CARTO © OpenStreetMap contributors';
        }

        canvas.addEventListener('click', function (ev) {
            var rect = canvas.getBoundingClientRect();
            var point = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
            self.fire('click', { point: point, lngLat: self.unproject(point), originalEvent: ev });
        });
        canvas.addEventListener('mousemove', function (ev) {
            var rect = canvas.getBoundingClientRect();
            var point = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
            self.fire('mousemove', { point: point, lngLat: self.unproject(point), originalEvent: ev });
        });

        this.scrollZoom = this.dragPan = this.boxZoom = this.doubleClickZoom = this.touchZoomRotate = {
            enable: function () {}, disable: function () {}, isEnabled: function () { return true; }
        };

        maps.push(this);
        this._resizeCanvas();
        this._applyStyle(options.style, null, true);
    }
    StubMap.prototype = Object.create(Evented.prototype);
    StubMap.prototype.constructor = StubMap;

    StubMap.prototype._resizeCanvas = function () {
        var w = this._container.clientWidth || 300;
        var h = this._container.clientHeight || 150;
        this._canvas.width = w;
        this._canvas.height = h;
        this._canvas.style.width = w + 'px';
        this._canvas.style.height = h + 'px';
    };

    StubMap.prototype._applyStyle = function (style, opts, initial) {
        var previous = this.getStyle();
        var next = typeof style === 'string'
            ? { version: 8, sources: { carto: { type: 'vector', url: style } }, layers: [{ id: 'background', type: 'background' }] }
            : JSON.parse(JSON.stringify(style || { version: 8, sources: {}, layers: [] }));
        if (opts && typeof opts.transformStyle === 'function') next = opts.transformStyle(previous, next);
        this.styleHistory.push(typeof style === 'string' ? style : '(object)');
        this._sources = {};
        var self = this;
        Object.keys(next.sources || {}).forEach(function (id) { self._sources[id] = next.sources[id]; });
        this._layers = (next.layers || []).slice();
        this._styleLoaded = false;
        setTimeout(function () {
            if (self._removed) return;
            self._styleLoaded = true;
            self.fire('styledata');
            self.fire('style.load');
            if (initial) { self._loaded = true; self.fire('load'); }
            self._paint();
        }, 0);
    };

    StubMap.prototype.setStyle = function (style, opts) { this._applyStyle(style, opts, false); return this; };
    StubMap.prototype.getStyle = function () {
        return { version: 8, sources: Object.assign({}, this._sources), layers: this._layers.slice() };
    };
    StubMap.prototype.isStyleLoaded = function () { return !!this._styleLoaded; };
    StubMap.prototype.loaded = function () { return !!this._loaded; };

    StubMap.prototype.addSource = function (id, spec) {
        if (this._sources[id]) throw new Error('There is already a source with ID "' + id + '".');
        this._sources[id] = spec;
        this._paint();
        return this;
    };
    StubMap.prototype.getSource = function (id) {
        var spec = this._sources[id];
        if (!spec) return undefined;
        var self = this;
        return {
            type: spec.type,
            setData: function (data) { spec.data = data; self._paint(); return this; },
            _data: spec.data
        };
    };
    StubMap.prototype.removeSource = function (id) { delete this._sources[id]; return this; };
    StubMap.prototype.addLayer = function (layer, beforeId) {
        if (this.getLayer(layer.id)) throw new Error('Layer "' + layer.id + '" already exists.');
        var copy = JSON.parse(JSON.stringify(layer));
        var at = beforeId ? this._layers.findIndex(function (l) { return l.id === beforeId; }) : -1;
        if (at >= 0) this._layers.splice(at, 0, copy); else this._layers.push(copy);
        this._paint();
        return this;
    };
    StubMap.prototype.getLayer = function (id) {
        return this._layers.find(function (l) { return l.id === id; });
    };
    StubMap.prototype.removeLayer = function (id) {
        this._layers = this._layers.filter(function (l) { return l.id !== id; });
        return this;
    };
    StubMap.prototype.setPaintProperty = function (id, prop, value) {
        var layer = this.getLayer(id);
        if (layer) { layer.paint = layer.paint || {}; layer.paint[prop] = value; this._paint(); }
        return this;
    };
    StubMap.prototype.getPaintProperty = function (id, prop) {
        var layer = this.getLayer(id);
        return layer && layer.paint ? layer.paint[prop] : undefined;
    };
    StubMap.prototype.setLayoutProperty = function (id, prop, value) {
        var layer = this.getLayer(id);
        if (layer) { layer.layout = layer.layout || {}; layer.layout[prop] = value; }
        return this;
    };
    StubMap.prototype.setFilter = function (id, filter) {
        var layer = this.getLayer(id);
        if (layer) layer.filter = filter;
        return this;
    };

    StubMap.prototype.setFeatureState = function (target, state) {
        var key = target.source + ':' + target.id;
        this._featureState[key] = Object.assign(this._featureState[key] || {}, state);
        return this;
    };
    StubMap.prototype.getFeatureState = function (target) {
        return this._featureState[target.source + ':' + target.id] || {};
    };
    StubMap.prototype.removeFeatureState = function (target) {
        delete this._featureState[target.source + ':' + target.id];
        return this;
    };

    /* Camera: a Web Mercator projection, enough for hit tests and fits. */
    StubMap.prototype._scale = function () { return TILE * Math.pow(2, this._zoom); };
    StubMap.prototype.project = function (lngLat) {
        var lng = Array.isArray(lngLat) ? lngLat[0] : lngLat.lng;
        var lat = Array.isArray(lngLat) ? lngLat[1] : lngLat.lat;
        var s = this._scale();
        return {
            x: this._canvas.width / 2 + (lng - this._center.lng) / 360 * s,
            y: this._canvas.height / 2 - (mercY(lat) - mercY(this._center.lat)) * s
        };
    };
    StubMap.prototype.unproject = function (point) {
        var s = this._scale();
        var p = Array.isArray(point) ? { x: point[0], y: point[1] } : point;
        return {
            lng: this._center.lng + (p.x - this._canvas.width / 2) / s * 360,
            lat: latOf(mercY(this._center.lat) - (p.y - this._canvas.height / 2) / s)
        };
    };
    StubMap.prototype.getCenter = function () { return { lng: this._center.lng, lat: this._center.lat }; };
    StubMap.prototype.getZoom = function () { return this._zoom; };
    StubMap.prototype.setCenter = function (c) {
        this._center = Array.isArray(c) ? { lng: c[0], lat: c[1] } : { lng: c.lng, lat: c.lat };
        this._paint();
        return this;
    };
    StubMap.prototype.setZoom = function (z) { this._zoom = z; this._paint(); return this; };
    StubMap.prototype.jumpTo = function (o) {
        if (o.center) this.setCenter(o.center);
        if (o.zoom != null) this.setZoom(o.zoom);
        return this;
    };
    StubMap.prototype.easeTo = StubMap.prototype.jumpTo;
    StubMap.prototype.flyTo = StubMap.prototype.jumpTo;
    StubMap.prototype.fitBounds = function (bounds, opts) {
        opts = opts || {};
        var pad = typeof opts.padding === 'number' ? opts.padding : 0;
        var w = bounds[0][0], s = bounds[0][1], e = bounds[1][0], n = bounds[1][1];
        var dx = Math.max(1e-6, (e - w) / 360);
        var dy = Math.max(1e-6, mercY(n) - mercY(s));
        var zx = Math.log2(Math.max(1, this._canvas.width - 2 * pad) / (dx * TILE));
        var zy = Math.log2(Math.max(1, this._canvas.height - 2 * pad) / (dy * TILE));
        var z = Math.min(zx, zy);
        if (opts.maxZoom != null) z = Math.min(z, opts.maxZoom);
        this._center = { lng: (w + e) / 2, lat: latOf((mercY(n) + mercY(s)) / 2) };
        this._zoom = z;
        this._paint();
        return this;
    };
    StubMap.prototype.getBounds = function () {
        var nw = this.unproject({ x: 0, y: 0 });
        var se = this.unproject({ x: this._canvas.width, y: this._canvas.height });
        return { getWest: function () { return nw.lng; }, getEast: function () { return se.lng; },
            getNorth: function () { return nw.lat; }, getSouth: function () { return se.lat; } };
    };

    function circleRadius(layer) {
        var r = layer.paint && layer.paint['circle-radius'];
        return typeof r === 'number' ? r : 8;
    }

    StubMap.prototype.queryRenderedFeatures = function (point, opts) {
        if (point && !Array.isArray(point) && point.x == null) { opts = point; point = null; }
        opts = opts || {};
        var self = this;
        var out = [];
        var layers = this._layers.filter(function (l) {
            return l.type === 'circle' && (!opts.layers || opts.layers.indexOf(l.id) >= 0);
        });
        layers.forEach(function (layer) {
            var spec = self._sources[layer.source];
            var features = (spec && spec.data && spec.data.features) || [];
            features.forEach(function (f, i) {
                if (!f.geometry || f.geometry.type !== 'Point') return;
                if (point) {
                    var p = self.project(f.geometry.coordinates);
                    var q = Array.isArray(point) ? { x: point[0], y: point[1] } : point;
                    if (Math.hypot(p.x - q.x, p.y - q.y) > circleRadius(layer) + 3) return;
                }
                out.push({
                    type: 'Feature',
                    id: spec.generateId ? i : f.id,
                    geometry: f.geometry,
                    properties: f.properties || {},
                    layer: { id: layer.id },
                    source: layer.source
                });
            });
        });
        return out;
    };

    /** Paint the circle layers, so the canvas is not a blank box. */
    StubMap.prototype._paint = function () {
        if (this._removed) return;
        var c = this._canvas.getContext('2d');
        var dark = /dark-matter/.test(this.styleHistory[this.styleHistory.length - 1] || '');
        c.fillStyle = dark ? '#262626' : '#f2efe9';
        c.fillRect(0, 0, this._canvas.width, this._canvas.height);
        var self = this;
        this._layers.forEach(function (layer) {
            if (layer.type !== 'circle') return;
            var spec = self._sources[layer.source];
            var color = layer.paint && layer.paint['circle-color'];
            ((spec && spec.data && spec.data.features) || []).forEach(function (f) {
                var p = self.project(f.geometry.coordinates);
                c.beginPath();
                c.arc(p.x, p.y, circleRadius(layer), 0, Math.PI * 2);
                c.fillStyle = typeof color === 'string' ? color : '#888';
                c.fill();
            });
        });
    };

    StubMap.prototype.getContainer = function () { return this._container; };
    StubMap.prototype.getCanvas = function () { return this._canvas; };
    StubMap.prototype.getCanvasContainer = function () { return this._canvas.parentNode; };
    StubMap.prototype.resize = function () { this._resizeCanvas(); this._paint(); this.fire('resize'); return this; };
    StubMap.prototype.triggerRepaint = function () { this._paint(); };
    StubMap.prototype.redraw = function () { this._paint(); return this; };
    StubMap.prototype.addControl = function (control, position) {
        var node = control.onAdd(this);
        this._corners[position || 'top-right'].appendChild(node);
        return this;
    };
    StubMap.prototype.removeControl = function (control) {
        if (control._container && control._container.parentNode) control._container.parentNode.removeChild(control._container);
        return this;
    };
    StubMap.prototype.hasControl = function () { return false; };
    StubMap.prototype.remove = function () {
        this._removed = true;
        while (this._container.firstChild) this._container.removeChild(this._container.firstChild);
        this.fire('remove');
    };

    /* ---- Controls ------------------------------------------------------ */

    function button(className, label, parent) {
        var b = el('button', className, parent);
        b.type = 'button';
        b.title = label;
        b.setAttribute('aria-label', label);
        el('span', 'maplibregl-ctrl-icon', b).setAttribute('aria-hidden', 'true');
        return b;
    }

    function NavigationControl() {}
    NavigationControl.prototype.onAdd = function (map) {
        var group = this._container = el('div', 'maplibregl-ctrl maplibregl-ctrl-group');
        button('maplibregl-ctrl-zoom-in', map._locale['NavigationControl.ZoomIn'] || 'Zoom in', group)
            .addEventListener('click', function () { map.setZoom(map.getZoom() + 1); });
        button('maplibregl-ctrl-zoom-out', map._locale['NavigationControl.ZoomOut'] || 'Zoom out', group)
            .addEventListener('click', function () { map.setZoom(map.getZoom() - 1); });
        return group;
    };

    function FullscreenControl() {}
    FullscreenControl.prototype.onAdd = function (map) {
        var group = this._container = el('div', 'maplibregl-ctrl maplibregl-ctrl-group');
        button('maplibregl-ctrl-fullscreen', map._locale['FullscreenControl.Enter'] || 'Enter fullscreen', group);
        return group;
    };

    /* ---- Popup (anchoring as in map-popup.html's stand-in) ------------- */

    var TRANSLATE = {
        top: 'translate(-50%,0)',
        'top-left': 'translate(0,0)',
        'top-right': 'translate(-100%,0)',
        bottom: 'translate(-50%,-100%)',
        'bottom-left': 'translate(0,-100%)',
        'bottom-right': 'translate(-100%,-100%)'
    };

    function Popup(options) {
        Evented.call(this);
        this.options = Object.assign({ closeButton: true, closeOnClick: true, maxWidth: '240px' }, options || {});
        var self = this;
        this._onMapClick = function () { self.remove(); };
    }
    Popup.prototype = Object.create(Evented.prototype);
    Popup.prototype.constructor = Popup;
    Popup.prototype.isOpen = function () { return !!this._map; };
    Popup.prototype.getElement = function () { return this._box; };
    Popup.prototype.setLngLat = function (lngLat) { this._lngLat = lngLat; this._update(); return this; };
    Popup.prototype.setMaxWidth = function (w) { this.options.maxWidth = w; this._update(); return this; };
    Popup.prototype.setHTML = function (html) {
        var frag = document.createElement('div');
        frag.innerHTML = html;
        return this.setDOMContent(frag);
    };
    Popup.prototype.setDOMContent = function (node) {
        var self = this;
        this._content = this._content || el('div', 'maplibregl-popup-content');
        while (this._content.firstChild) this._content.removeChild(this._content.firstChild);
        this._content.appendChild(node);
        if (this.options.closeButton) {
            var close = el('button', 'maplibregl-popup-close-button', this._content);
            close.type = 'button';
            var label = (this._map && this._map._locale['Popup.Close']) || 'Close popup';
            close.setAttribute('aria-label', label);
            close.title = label;
            el('span', null, close).textContent = '×';
            close.firstChild.setAttribute('aria-hidden', 'true');
            close.addEventListener('click', function () { self.remove(); });
        }
        this._update();
        return this;
    };
    Popup.prototype.addTo = function (map) {
        if (this._map) this.remove();
        this._map = map;
        if (this.options.closeOnClick) map.on('click', this._onMapClick);
        this._update();
        this.fire('open');
        return this;
    };
    Popup.prototype.remove = function () {
        if (this._box && this._box.parentNode) this._box.parentNode.removeChild(this._box);
        if (this._map) this._map.off('click', this._onMapClick);
        this._box = null;
        this._map = null;
        this.fire('close');
        return this;
    };
    Popup.prototype._update = function () {
        if (!this._map || !this._lngLat || !this._content) return;
        if (!this._box) {
            this._box = el('div', 'maplibregl-popup');
            el('div', 'maplibregl-popup-tip', this._box);
            this._box.appendChild(this._content);
            String(this.options.className || '').split(' ').forEach(function (c) { if (c) this._box.classList.add(c); }, this);
            this._map.getContainer().appendChild(this._box);
        }
        this._box.style.maxWidth = this.options.maxWidth;
        var point = this._map.project(this._lngLat);
        var map = this._map.getContainer();
        var width = this._box.offsetWidth, height = this._box.offsetHeight;
        var parts = point.y < height ? ['top'] : (point.y > map.clientHeight - height ? ['bottom'] : []);
        if (point.x < width / 2) parts.push('left');
        else if (point.x > map.clientWidth - width / 2) parts.push('right');
        var anchor = parts.length ? parts.join('-') : 'bottom';
        Array.prototype.slice.call(this._box.classList).forEach(function (c) {
            if (c.indexOf('maplibregl-popup-anchor-') === 0) this._box.classList.remove(c);
        }, this);
        this._box.classList.add('maplibregl-popup-anchor-' + anchor);
        this._box.style.transform = TRANSLATE[anchor] + ' translate(' + point.x + 'px,' + point.y + 'px)';
    };

    /* ---- The parallel "import" ----------------------------------------- */

    var api = {
        Map: StubMap,
        Popup: Popup,
        NavigationControl: NavigationControl,
        FullscreenControl: FullscreenControl,
        version: 'fixture'
    };
    var fail = new URLSearchParams(location.search).get('maplibre') === 'fail';
    var lazy = window.IWACVisLazy = window.IWACVisLazy || {};
    lazy.mjsP = new Promise(function (resolve, reject) {
        setTimeout(function () {
            if (fail) { reject(new Error('fixture: MapLibre import refused')); return; }
            window.maplibregl = api;
            resolve(api);
        }, 40);
    });
    // An unobserved rejection is noise in the console the specs read.
    lazy.mjsP.catch(function () {});
})();
