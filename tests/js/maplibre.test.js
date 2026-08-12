'use strict';

const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const MAPLIBRE_SOURCE = readFileSync(
    join(ROOT, 'asset', 'js', 'charts', 'shared', 'maplibre.js'),
    'utf8'
);

function fakeStyle() {
    return {
        values: {},
        setProperty(name, value) {
            this.values[name] = String(value);
        },
    };
}

class FakePopup {
    constructor(options) {
        this.options = { ...options };
        this.listeners = {};
        this.content = null;
        this.element = null;
        this.map = null;
        this.maxWidthCalls = [];
        this.paddingCalls = [];
    }

    on(type, handler) {
        (this.listeners[type] ||= []).push(handler);
        return { unsubscribe: () => this.off(type, handler) };
    }

    off(type, handler) {
        this.listeners[type] = (this.listeners[type] || []).filter((fn) => fn !== handler);
        return this;
    }

    fire(type) {
        for (const handler of this.listeners[type] || []) handler({ type, target: this });
    }

    isOpen() {
        return Boolean(this.map);
    }

    getElement() {
        return this.element;
    }

    setLngLat(value) {
        this.lngLat = value;
        return this;
    }

    setDOMContent(value) {
        this.content = value;
        if (this.map && !this.element) this.element = { style: fakeStyle() };
        return this;
    }

    setHTML(value) {
        return this.setDOMContent({ html: value });
    }

    setText(value) {
        return this.setDOMContent({ text: value });
    }

    setMaxWidth(value) {
        this.options.maxWidth = value;
        this.maxWidthCalls.push(value);
        return this;
    }

    setPadding(value) {
        this.options.padding = value;
        this.paddingCalls.push(value);
    }

    addTo(map) {
        if (this.map) this.remove();
        this.map = map;
        if (this.content) this.element = { style: fakeStyle() };
        this.fire('open');
        return this;
    }

    remove() {
        this.map = null;
        this.element = null;
        this.fire('close');
        return this;
    }
}

function fakeMap(width, height) {
    const handlers = {};
    const container = { clientWidth: width, clientHeight: height };
    return {
        container,
        handlers,
        getContainer() {
            return container;
        },
        on(type, handler) {
            (handlers[type] ||= []).push(handler);
            return this;
        },
        off(type, handler) {
            handlers[type] = (handlers[type] || []).filter((fn) => fn !== handler);
            return this;
        },
        fire(type) {
            for (const handler of handlers[type] || []) handler();
        },
    };
}

function loadMaplibre() {
    const context = {
        console,
        document: {
            createElement() {
                return { getContext: () => null };
            },
            getElementById() {
                return null;
            },
        },
        maplibregl: { Popup: FakePopup },
        window: { IWACVis: { panels: {} } },
    };
    vm.createContext(context);
    vm.runInContext(MAPLIBRE_SOURCE, context, { filename: 'maplibre.js' });
    return context.window.IWACVis.panels;
}

test('shared popups derive bounds from the map container and refresh on resize', () => {
    const P = loadMaplibre();
    const map = fakeMap(375, 320);
    const popup = P.createIwacPopup({ className: 'preview' })
        .setDOMContent({})
        .addTo(map);

    assert.equal(popup.options.className, 'iwac-vis-maplibre-popup preview');
    assert.equal(popup.maxWidthCalls.at(-1), '228px');
    assert.deepEqual(
        JSON.parse(JSON.stringify(popup.paddingCalls.at(-1))),
        { top: 16, right: 16, bottom: 16, left: 16 }
    );
    assert.deepEqual(popup.element.style.values, {
        '--iwac-vis-popup-content-max-height': '134px',
        '--iwac-vis-popup-body-max-height': '104px',
        '--iwac-vis-popup-inner-max-width': '168px',
    });
    assert.equal(map.handlers.resize.length, 1);

    map.container.clientWidth = 1000;
    map.container.clientHeight = 1000;
    map.fire('resize');
    assert.equal(popup.maxWidthCalls.at(-1), '320px');
    assert.deepEqual(popup.element.style.values, {
        '--iwac-vis-popup-content-max-height': '460px',
        '--iwac-vis-popup-body-max-height': '430px',
        '--iwac-vis-popup-inner-max-width': '260px',
    });

    popup.remove();
    assert.equal(map.handlers.resize.length, 0, 'closed popups must release their resize listener');
});

test('late popup content receives the same map-relative constraint', () => {
    const P = loadMaplibre();
    const map = fakeMap(600, 400);
    const popup = P.createIwacPopup({ maxWidth: '340px' }).addTo(map);

    assert.equal(popup.getElement(), null, 'the fake mirrors MapLibre: no content, no popup root');
    popup.setDOMContent({});

    assert.equal(popup.maxWidthCalls.at(-1), '340px');
    assert.equal(
        popup.element.style.values['--iwac-vis-popup-content-max-height'],
        '174px'
    );
});

test('every module popup goes through the shared factory', () => {
    const assetRoot = join(ROOT, 'asset', 'js');
    const files = [];
    function walk(dir) {
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) walk(path);
            else if (path.endsWith('.js') && !path.endsWith('.min.js')) files.push(path);
        }
    }
    walk(assetRoot);

    const directConstructors = files
        .filter((path) => /new\s+maplibregl\.Popup\s*\(/.test(readFileSync(path, 'utf8')))
        .map((path) => relative(ROOT, path).replaceAll('\\', '/'));

    assert.deepEqual(directConstructors, ['asset/js/charts/shared/maplibre.js']);
});
