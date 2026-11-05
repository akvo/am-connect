/* AMConnect GIS view: a self-contained WebGIS component driven by the AMConnect API.
 *
 *   new AmconnectGIS(element, {
 *     api:        '/api/amconnect/datasets/<id>',   // primary dataset (or use `datasets`)
 *     datasets:   ['<id>', '<id>'],                 // several datasets on one map (optional)
 *     apiBase:    '/api/amconnect',                 // derived from `api` when omitted
 *     tab:        'map' | 'overview' | 'resources' | 'analysis',
 *     bbox:       'w,s,e,n'  (optional: run area statistics on load),
 *     layers:     'resourceId,resourceId' (optional: only show these),
 *     resourceId: '<id>' (single-resource mode, used by the CKAN resource view),
 *     compact:    true  (no tabs/header), embed: true (bare page),
 *     datasetUrl, embedUrl (header links)
 *   })
 *
 * No CKAN dependency: OpenLayers (window.ol) and geotiff.js (window.GeoTIFF) only.
 *
 * What it does with the API JSON: draws the WMS layers, shows hosted/federated and
 * capability badges, legend, downloads; identify = WMS GetFeatureInfo (feature highlighted
 * from the returned geometry); analysis = WCS clip / WFS query straight from the browser
 * (rectangle or polygon, histogram and category charts, attribute query builder);
 * "Add layer" = /api/amconnect/spatial-search on the current view; share = permalink
 * (state in the URL hash), PNG export, embed snippet.
 */
(function (global) {
  'use strict';

  var CRS4326 = 'http://www.opengis.net/def/crs/EPSG/0/4326';
  var MAX_PIXELS = 2000000;
  var DEFAULT_CENTER = [101.0, 13.0];
  var DEFAULT_ZOOM = 5;
  var BASEMAPS = {
    osm: { title: 'OpenStreetMap', make: function () { return new ol.source.OSM(); } },
    light: { title: 'Light gray (Esri)', make: function () { return new ol.source.XYZ({ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', crossOrigin: 'anonymous', attributions: 'Tiles &copy; Esri', maxZoom: 16 }); } },
    dark: { title: 'Dark gray (Esri)', make: function () { return new ol.source.XYZ({ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', crossOrigin: 'anonymous', attributions: 'Tiles &copy; Esri', maxZoom: 16 }); } },
    topo: { title: 'Topographic (Esri)', make: function () { return new ol.source.XYZ({ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', crossOrigin: 'anonymous', attributions: 'Tiles &copy; Esri' }); } },
    satellite: { title: 'Satellite (Esri)', make: function () { return new ol.source.XYZ({ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', crossOrigin: 'anonymous', attributions: 'Tiles &copy; Esri' }); } },
    none: { title: 'No basemap', make: function () { return null; } }
  };
  var OPERATORS = [['=', '='], ['<>', '≠'], ['>', '>'], ['>=', '≥'], ['<', '<'], ['<=', '≤'], ['LIKE', 'contains'], ['IS NULL', 'is empty']];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) {
    if (n == null || isNaN(n) || !isFinite(n)) { return '-'; }
    return Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : (+n.toFixed(3)).toLocaleString();
  }
  function fmtBox(b) { return b ? b.map(function (v) { return (+v).toFixed(3); }).join(', ') : '-'; }
  function q(root, sel) { return root.querySelector(sel); }
  function qa(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }
  function join(url, params) { return url + (url.indexOf('?') === -1 ? '?' : '&') + params; }
  function capsUrl(endpoint, service) { return join(endpoint, 'SERVICE=' + service + '&REQUEST=GetCapabilities'); }
  function badge(text, kind, title) {
    return '<span class="agis-badge agis-badge--' + kind + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(text) + '</span>';
  }
  function originBadge(origin) {
    return origin === 'hosted' ? badge('Hosted', 'hosted', 'Served by the AMConnect GeoServer')
      : badge('Federated', 'federated', 'Served by an external / partner service');
  }
  function kindBadge(layer) {
    if (layer.data_kind === 'vector') { return badge('Vector', 'kind', 'WFS available: features can be queried and downloaded'); }
    if (layer.data_kind === 'raster') { return badge('Raster', 'kind', 'WCS available: pixels can be clipped and downloaded'); }
    return badge('WMS only', 'kind', 'Only map images are available: view only');
  }
  function statusBadge(status, detail) {
    if (status === 'ok') { return ''; }
    if (status === 'unreachable') { return badge('Unreachable', 'error', detail || 'GetCapabilities failed'); }
    if (status === 'layer_not_found') { return badge('Layer not found', 'error', detail || ''); }
    return badge('Not verified', 'muted', 'Service was not probed');
  }
  function kvTable(rows) {
    return '<table class="agis-table agis-table--kv">' + rows.map(function (r) {
      return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</table>';
  }
  // tiny inline SVG bar chart: items = [{label, value}]
  function isNarrow() { return !!(global.matchMedia && global.matchMedia('(max-width: 800px)').matches); }

  function barChart(items, opts) {
    opts = opts || {};
    var w = opts.width || 270, barH = opts.barH || 14, gap = 3, labelW = opts.labelW || 118;
    var short = function (t) { t = String(t); return t.length > 17 ? t.slice(0, 16) + '\u2026' : t; };   // ~6px per mono char
    var max = Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1]));
    var h = items.length * (barH + gap);
    var rows = items.map(function (it, i) {
      var y = i * (barH + gap), bw = Math.max(1, (w - labelW - 44) * it.value / max);
      return '<text x="' + (labelW - 4) + '" y="' + (y + barH - 3) + '" text-anchor="end" class="agis-chart__label"><title>' + esc(it.label) + '</title>' + esc(short(it.label)) + '</text>' +
        '<rect x="' + labelW + '" y="' + y + '" width="' + bw + '" height="' + barH + '" rx="2" fill="' + (it.color || '#1b6ca8') + '"><title>' + esc(it.label + ': ' + fmt(it.value)) + '</title></rect>' +
        '<text x="' + (labelW + bw + 4) + '" y="' + (y + barH - 3) + '" class="agis-chart__value">' + esc(fmt(it.value)) + '</text>';
    }).join('');
    return '<svg class="agis-chart" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">' + rows + '</svg>';
  }
  // histogram as vertical bars
  function histogram(bins, min, max) {
    var w = 260, h = 90, n = bins.length, bw = w / n;
    var top = Math.max.apply(null, bins.concat([1]));
    var bars = bins.map(function (c, i) {
      var bh = Math.round((h - 16) * c / top);
      var lo = min + (max - min) * i / n, hi = min + (max - min) * (i + 1) / n;
      return '<rect x="' + (i * bw + 1) + '" y="' + (h - 14 - bh) + '" width="' + (bw - 2) + '" height="' + bh + '" fill="#1b6ca8"><title>' + fmt(lo) + ' – ' + fmt(hi) + ': ' + fmt(c) + ' px</title></rect>';
    }).join('');
    return '<svg class="agis-chart" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">' + bars +
      '<text x="0" y="' + (h - 2) + '" class="agis-chart__label">' + fmt(min) + '</text>' +
      '<text x="' + w + '" y="' + (h - 2) + '" text-anchor="end" class="agis-chart__label">' + fmt(max) + '</text></svg>';
  }
  var VECTOR_MAX = 5000;   // features per WFS request in vector mode (per view extent)

  // GeoServer JSON-legend rule filter -> predicate(props). Handles [a = 'v'], <>, >, <, >=, <=,
  // (I)LIKE with * wildcards, BETWEEN, AND/OR chains (no parentheses); anything else -> false.
  function ruleFilter(str) {
    if (!str || str === 'true') { return function () { return true; }; }
    str = String(str).replace(/^\[|\]$/g, '').trim();
    var orParts = str.split(/\s+OR\s+/i).map(function (part) {
      var ands = part.split(/\s+AND\s+/i).map(function (cond) {
        var m = cond.match(/^\s*(\w+)\s+(BETWEEN)\s+(.+?)\s+AND\s+(.+?)\s*$/i);
        if (m) { var lo = parseFloat(m[3]), hi = parseFloat(m[4]); return function (p) { var v = parseFloat(p[m[1]]); return v >= lo && v <= hi; }; }
        m = cond.match(/^\s*(\w+)\s*(<>|>=|<=|=|>|<|ILIKE|LIKE)\s*'?(.*?)'?\s*$/i);
        if (!m) { return function () { return false; }; }
        var attr = m[1], op = m[2].toUpperCase(), val = m[3];
        if (op === 'LIKE' || op === 'ILIKE') {
          var re = new RegExp('^' + val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*').replace(/_/g, '.') + '$', op === 'ILIKE' ? 'i' : '');
          return function (p) { return re.test(String(p[attr] == null ? '' : p[attr])); };
        }
        var num = parseFloat(val), isNum = val !== '' && !isNaN(num);
        return function (p) {
          var x = p[attr];
          if (op === '=') { return String(x) === val || (isNum && parseFloat(x) === num); }
          if (op === '<>') { return String(x) !== val; }
          var xv = parseFloat(x); if (isNaN(xv)) { return false; }
          return op === '>' ? xv > num : op === '<' ? xv < num : op === '>=' ? xv >= num : xv <= num;
        };
      });
      return function (p) { return ands.every(function (f) { return f(p); }); };
    });
    return function (p) { return orParts.some(function (f) { return f(p); }); };
  }
  function symbolizerStyle(sym) {
    var rgba = function (hex, op) {
      var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
      if (!m) { return hex || 'rgba(0,0,0,0)'; }
      return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + (op == null ? 1 : Number(op)) + ')';
    };
    if (sym.Point) {
      var g = (sym.Point.graphics || [])[0] || {}, size = Number(sym.Point.size) || 8, r = size / 2;
      var fill = new ol.style.Fill({ color: rgba(g.fill || '#333', g['fill-opacity']) });
      var stroke = new ol.style.Stroke({ color: rgba(g.stroke || '#fff', g['stroke-opacity']), width: Number(g['stroke-width']) || 1 });
      var image = g.mark === 'square' ? new ol.style.RegularShape({ points: 4, radius: r * 1.2, angle: Math.PI / 4, fill: fill, stroke: stroke })
        : g.mark === 'triangle' ? new ol.style.RegularShape({ points: 3, radius: r * 1.3, fill: fill, stroke: stroke })
        : new ol.style.Circle({ radius: r, fill: fill, stroke: stroke });
      return new ol.style.Style({ image: image });
    }
    if (sym.Polygon) {
      var p = sym.Polygon;
      return new ol.style.Style({ fill: new ol.style.Fill({ color: rgba(p.fill || '#888', p['fill-opacity']) }),
        stroke: new ol.style.Stroke({ color: rgba(p.stroke || '#333', p['stroke-opacity']), width: Number(p['stroke-width']) || 1 }) });
    }
    if (sym.Line) {
      var l = sym.Line;
      return new ol.style.Style({ stroke: new ol.style.Stroke({ color: rgba(l.stroke || '#333', l['stroke-opacity']), width: Number(l['stroke-width']) || 1 }) });
    }
    return null;
  }
  // legend JSON -> OL style function reproducing the server style client-side
  function styleFromLegend(json) {
    var rules = (((json.Legend || [])[0] || {}).rules || []).map(function (rule) {
      var styles = (rule.symbolizers || []).map(symbolizerStyle).filter(Boolean);
      return { test: rule.ElseFilter ? null : ruleFilter(rule.filter), styles: styles };
    });
    var elseRule = rules.filter(function (r) { return !r.test; })[0];
    var fallback = [new ol.style.Style({ image: new ol.style.Circle({ radius: 4, fill: new ol.style.Fill({ color: '#2457a6' }), stroke: new ol.style.Stroke({ color: '#fff', width: 1 }) }),
      fill: new ol.style.Fill({ color: 'rgba(36,87,166,.35)' }), stroke: new ol.style.Stroke({ color: '#2457a6', width: 1 }) })];
    return function (feature) {
      var props = feature.getProperties();
      for (var i = 0; i < rules.length; i++) { if (rules[i].test && rules[i].test(props)) { return rules[i].styles; } }
      return elseRule ? elseRule.styles : fallback;
    };
  }

  function polygonWkt3857(geom) {
    var ring = geom.getCoordinates()[0];
    return 'SRID=3857;POLYGON((' + ring.map(function (c) { return c[0].toFixed(1) + ' ' + c[1].toFixed(1); }).join(', ') + '))';
  }

  // ======================================================================== component
  function AmconnectGIS(root, opts) {
    if (!root) { throw new Error('AmconnectGIS: missing element'); }
    this.root = root;
    root._agis = this;
    this.opts = opts || {};
    this.opts.apiBase = this.opts.apiBase || (this.opts.api || '').replace(/\/datasets\/.*$/, '') || '/api/amconnect';
    this.tab = this.opts.tab || 'map';
    this.olLayers = [];          // [{def, layer, pending, errors, dataset}] map order, bottom first
    this.datasets = [];          // loaded dataset JSONs (first = primary)
    this.selecting = null;       // 'box' | 'polygon' | null
    this.identify = true;
    this.compare = false;
    this.basemapKey = 'osm';
    this.hashState = this.parseHash();
    this.root.classList.add('agis');
    if (this.opts.embed) { this.root.classList.add('agis--embed'); }
    if (this.opts.compact) { this.root.classList.add('agis--compact'); }
    this.root.innerHTML = '<div class="agis__loading">Loading dataset from AMConnect API&hellip;</div>';
    this.load();
  }

  AmconnectGIS.prototype.fetchDataset = function (idOrUrl) {
    var url = /^https?:|^\//.test(idOrUrl) ? idOrUrl : this.opts.apiBase + '/datasets/' + encodeURIComponent(idOrUrl);
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) { throw new Error('API ' + r.status + ' for ' + url); } return r.json(); })
      .then(function (json) { if (!json.success) { throw new Error(json.error || 'API error'); } return json.result; });
  };

  AmconnectGIS.prototype.load = function () {
    var self = this;
    if (typeof ol === 'undefined') { return this.fatal('OpenLayers failed to load (CDN blocked?).'); }
    var ids = this.opts.datasets && this.opts.datasets.length ? this.opts.datasets : [this.opts.api];
    var extra = (this.hashState.datasets || '').split(',').filter(Boolean);
    ids = ids.concat(extra.filter(function (x) { return ids.indexOf(x) === -1; }));
    Promise.all(ids.map(function (id) { return self.fetchDataset(id); }))
      .then(function (results) { self.datasets = results; self.data = results[0]; self.build(); })
      .catch(function (err) { self.fatal('Could not load dataset: ' + (err.message || err)); });
  };

  AmconnectGIS.prototype.fatal = function (msg) {
    this.root.innerHTML = '<div class="agis__error">' + esc(msg) + '</div>';
  };

  // ---------------------------------------------------------------- state in URL hash
  AmconnectGIS.prototype.parseHash = function () {
    var state = {}, raw = {};
    (global.location.hash || '').replace(/^#/, '').split('&').forEach(function (kv) {
      if (!kv) { return; }
      var i = kv.indexOf('='); if (i === -1) { return; }
      raw[kv.slice(0, i)] = kv.slice(i + 1);
      state[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    this.hashRaw = raw;   // "layers" is parsed field by field: layer names contain ':'
    return state;
  };

  AmconnectGIS.prototype.permalink = function () {
    var view = this.map.getView();
    var c = ol.proj.toLonLat(view.getCenter());
    var parts = ['view=' + c[0].toFixed(5) + ',' + c[1].toFixed(5) + ',' + view.getZoom().toFixed(2), 'base=' + this.basemapKey];
    parts.push('layers=' + this.olLayers.map(function (e) {
      return encodeURIComponent(e.def.layer_name) + ':' + (e.layer.getVisible() ? 1 : 0) + ':' + Math.round(e.layer.getOpacity() * 100) +
        (e.style || e.mode === 'wfs' ? ':' + (e.style ? encodeURIComponent(e.style) : '') : '') + (e.mode === 'wfs' ? ':v' : '');
    }).join(','));
    var extra = this.datasets.slice(1).map(function (d) { return d.name; });
    if (extra.length) { parts.push('datasets=' + extra.join(',')); }
    if (this.lastSelection) { parts.push('sel=' + this.lastSelection); }
    if (this.lastPolygon) { parts.push('poly=' + this.lastPolygon); }
    if (this.lastQuery) { parts.push('q=' + encodeURIComponent(this.lastQuery)); }
    if (this.tab !== 'map') { parts.push('tab=' + this.tab); }
    return global.location.origin + global.location.pathname + global.location.search + '#' + parts.join('&');
  };

  AmconnectGIS.prototype.applyHash = function () {
    var s = this.hashState, self = this;
    if (s.base && BASEMAPS[s.base]) { this.setBasemap(s.base); }
    if (s.layers) {
      (this.hashRaw.layers || '').split(',').forEach(function (item) {
        var p = item.split(':'), name = decodeURIComponent(p[0]);
        var e = self.olLayers.filter(function (x) { return x.def.layer_name === name; })[0];
        if (e) { e.layer.setVisible(p[1] !== '0'); if (p[2]) { e.layer.setOpacity(+p[2] / 100); } if (p[3]) { self.setStyle(e, decodeURIComponent(p[3])); } if (p[4] === 'v') { self.setMode(e, 'wfs'); } }
      });
      this.renderLayerList();
    }
    if (s.view) {
      var v = s.view.split(',').map(Number);
      if (v.length === 3 && !v.some(isNaN)) { this.map.getView().setCenter(ol.proj.fromLonLat([v[0], v[1]])); this.map.getView().setZoom(v[2]); return true; }
    }
    return false;
  };

  // ------------------------------------------------------------------------ build
  AmconnectGIS.prototype.selectedLayers = function () {
    var self = this, out = [];
    this.datasets.forEach(function (d, idx) {
      var layers = d.layers.slice();
      if (idx === 0 && self.opts.resourceId) {
        layers = layers.filter(function (l) { return l.resource_ids.indexOf(self.opts.resourceId) !== -1; });
      } else if (idx === 0 && self.opts.layers) {
        var ids = self.opts.layers.split(',');
        layers = layers.filter(function (l) { return l.resource_ids.some(function (id) { return ids.indexOf(id) !== -1; }); });
      }
      layers.filter(function (l) { return l.services.wms; }).forEach(function (l) { out.push({ def: l, dataset: d }); });
    });
    return out;
  };

  AmconnectGIS.prototype.build = function () {
    var d = this.data, self = this;
    var layers = this.selectedLayers();
    var compact = this.opts.compact;
    var html = '';
    if (!compact) {
      html += '<header class="agis__header">' +
        '<div class="agis__title"><h2>' + esc(d.title) + '</h2>' +
          originBadge(d.origin) + (d.access_level ? badge(d.access_level, 'muted', 'Access level (CKAN metadata)') : '') +
          '<span data-role="dataset-count">' + (this.datasets.length > 1 ? badge(this.datasets.length + ' datasets', 'muted') : '') + '</span></div>' +
        '<div class="agis__meta">' +
          (d.organization ? '<span><b>Source:</b> ' + esc(d.organization.title) + '</span>' : '') +
          (d.harvest ? '<span><b>Harvested from:</b> ' + esc(d.harvest.source_title || d.harvest.source_url) + '</span>' : '') +
          (d.country ? '<span><b>Country:</b> ' + esc(d.country) + '</span>' : '') +
          (d.commodity ? '<span><b>Commodity:</b> ' + esc(d.commodity) + '</span>' : '') +
          '<span><b>Layers:</b> <span data-role="layer-count">' + layers.length + '</span></span>' +
          (d.license && d.license.title ? '<span><b>Licence:</b> ' + esc(d.license.title) + '</span>' : '') +
        '</div>' +
        '<div class="agis__links">' +
          (this.opts.datasetUrl ? '<a href="' + esc(this.opts.datasetUrl) + '">Dataset in CKAN</a>' : '') +
          '<a href="' + esc(this.opts.api || (this.opts.apiBase + '/datasets/' + d.name)) + '" target="_blank" rel="noopener">API JSON</a>' +
          (this.opts.embedUrl ? '<a href="' + esc(this.opts.embedUrl) + '" target="_blank" rel="noopener">Standalone / embed</a>' : '') +
        '</div>' +
        '</header>' +
        '<nav class="agis__tabs">' +
          ['overview', 'map', 'resources', 'analysis'].map(function (t) {
            return '<button type="button" data-tab="' + t + '"' + (t === self.tab ? ' class="is-active"' : '') + '>' +
              t.charAt(0).toUpperCase() + t.slice(1) + '</button>';
          }).join('') +
        '</nav>';
    }
    html += '<section class="agis__pane agis__pane--overview" data-pane="overview">' + this.overviewHtml() + '</section>';
    html += '<section class="agis__pane agis__pane--map" data-pane="map">' +
      '<aside class="agis__side">' +
        '<button type="button" class="agis__sheet-handle" data-act="sheet-toggle" aria-expanded="false"><span data-role="sheet-label">Layers</span><span class="agis__sheet-chev" aria-hidden="true"></span></button>' +
        '<div class="agis__side-section" data-side="layers">' +
          '<div class="agis__side-head"><h3>Layers</h3><button type="button" class="agis-btn agis-btn--small" data-act="add-layer" title="Find catalogue datasets that intersect the current map view">+ Add layer</button></div>' +
          '<div class="agis-catalogue" hidden></div>' +
          '<ul class="agis-layers"></ul>' +
        '</div>' +
        '<div class="agis__side-section" data-side="analysis" hidden>' + this.analysisPanelHtml() + '</div>' +
      '</aside>' +
      '<div class="agis__mapwrap">' +
        '<div class="agis__toolbar">' +
          '<select data-act="basemap" title="Basemap">' + Object.keys(BASEMAPS).map(function (k) {
            return '<option value="' + k + '">' + BASEMAPS[k].title + '</option>'; }).join('') + '</select>' +
          '<button type="button" data-act="zoom-dataset" title="Zoom to the dataset extent">&#8982; Extent</button>' +
          '<button type="button" data-act="identify" class="is-active" title="Click the map to inspect features (GetFeatureInfo)">&#9673; Identify</button>' +
          '<button type="button" data-act="select-box" title="Drag a rectangle for area statistics">&#9634; Box</button>' +
          '<button type="button" data-act="select-polygon" title="Draw a polygon for area statistics (double-click to finish)">&#11040; Polygon</button>' +
          '<button type="button" data-act="compare" title="Swipe the top layer against the layers below">&#8596; Compare</button>' +
          '<button type="button" data-act="share" title="Permalink, PNG export, embed code">&#8599; Share</button>' +
          '<button type="button" data-act="fullscreen" title="Fullscreen">&#9974;</button>' +
          '<button type="button" data-act="clear" hidden>&#10005; Clear</button>' +
          '<span class="agis__busy" hidden>Loading tiles&hellip;</span>' +
        '</div>' +
        '<div class="agis__map"></div>' +
        '<input type="range" class="agis__swipe" min="0" max="100" value="50" hidden>' +
        '<div class="agis__legend" hidden><div class="agis__legend-head"><b>Legend</b><button type="button" data-act="legend-toggle">&#8722;</button></div><div class="agis__legend-body"></div></div>' +
        '<div class="agis__coords"></div>' +
        '<div class="agis__popup" hidden><div class="agis__popup-head"><strong></strong><button type="button" data-act="popup-close">&#10005;</button></div><div class="agis__popup-body"></div></div>' +
        '<div class="agis__share" hidden></div>' +
        '<div class="agis__info" hidden></div>' +
      '</div>' +
      '</section>';
    html += '<section class="agis__pane agis__pane--resources" data-pane="resources">' + this.resourcesHtml() + '</section>';
    this.root.innerHTML = html;

    this.mapEl = q(this.root, '.agis__map');
    this.legendCollapsed = isNarrow();
    this.infoEl = q(this.root, '.agis__info');
    this.busyEl = q(this.root, '.agis__busy');
    this.popupEl = q(this.root, '.agis__popup');
    this.initMap(layers);
    this.renderLayerList();
    this.renderLegend();
    this.bind();
    this.showTab(compact ? 'map' : (this.hashState.tab || this.tab));

    var self2 = this;
    requestAnimationFrame(function () { self2.map.updateSize(); self2.initialView(compact); });
  };

  // hash / query-string driven start state; called once the map has its real size
  AmconnectGIS.prototype.initialView = function (compact) {
    var restored = this.applyHash();
    if (this.hashState.poly) {                     // poly=lon,lat;lon,lat;... (WGS84)
      var ring = this.hashState.poly.split(';').map(function (p) { return ol.proj.fromLonLat(p.split(',').map(Number)); });
      if (ring.length >= 3 && !ring.some(function (c) { return c.some(isNaN); })) {
        ring.push(ring[0]);
        var poly = new ol.geom.Polygon([ring]);
        if (!compact) { this.showTab('analysis'); }
        if (!restored) { this.map.getView().fit(poly.getExtent(), { padding: [60, 60, 60, 60], maxZoom: 12 }); }
        this.runStats(poly);
        if (this.hashState.q) { this.queryFromHash(); }
        return;
      }
    }
    if (this.hashState.q) { if (!compact) { this.showTab('analysis'); } this.queryFromHash(); }
    var sel = this.opts.bbox || this.hashState.bbox || this.hashState.sel;
    if (sel) {
      var b = sel.split(',').map(Number);
      if (b.length === 4 && !b.some(isNaN)) {
        if (!compact) { this.showTab('analysis'); }
        var ext = ol.proj.transformExtent(b, 'EPSG:4326', 'EPSG:3857');
        if (!restored) { this.map.getView().fit(ext, { padding: [60, 60, 60, 60], maxZoom: 12 }); }
        this.runStats(ol.geom.Polygon.fromExtent(ext));
        return;
      }
    }
    if (!restored) { this.zoomToDataset(); }
  };

  AmconnectGIS.prototype.overviewHtml = function () {
    var d = this.data, caps = d.capabilities || {};
    var rows = [
      ['Organisation', esc(d.organization ? d.organization.title : '-')],
      ['Origin', d.origin === 'hosted' ? 'Hosted (AMConnect GeoServer)' : 'Federated (external service)' +
        (d.harvest ? ', harvested from ' + esc(d.harvest.source_title || d.harvest.source_url) +
          (d.harvest.source_type ? ' [' + esc(d.harvest.source_type) + ']' : '') : '')],
      ['Country', esc(d.country || '-')], ['Commodity', esc(d.commodity || '-')],
      ['Data type', esc(d.data_type || '-')], ['Access level', esc(d.access_level || '-')],
      ['Licence', esc(d.license && d.license.title ? d.license.title : '-')],
      ['Extent (W, S, E, N)', fmtBox(d.bbox)],
      ['Last modified', esc(d.metadata_modified ? d.metadata_modified.replace('T', ' ').slice(0, 16) : '-')],
      ['Tags', esc(d.tags.length ? d.tags.join(', ') : '-')]
    ];
    var chips = Object.keys(caps).filter(function (k) { return caps[k]; }).map(function (k) { return badge(k.replace(/_/g, ' '), 'cap'); }).join(' ');
    return '<div class="agis-overview">' +
      '<div class="agis-overview__desc">' + (d.description ? esc(d.description).replace(/\n\n/g, '<br><br>') : '<i>No description.</i>') + '</div>' +
      '<table class="agis-table">' + rows.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</table>' +
      '<p class="agis-overview__caps"><b>Available actions (from CKAN metadata + live service checks):</b><br>' + (chips || '<i>none</i>') + '</p></div>';
  };

  AmconnectGIS.prototype.analysisPanelHtml = function () {
    return '<h3>Analysis</h3>' +
      '<p class="agis-help">Runs in the browser against GeoServer: rasters are clipped with <b>WCS</b> and reduced with geotiff.js, ' +
      'vectors are queried with <b>WFS</b> (CQL). CKAN only supplied the service URLs and capability flags.</p>' +
      '<label class="agis-field">Target layer<select data-role="analysis-layer"></select></label>' +
      '<label class="agis-field agis-analysis__style" hidden>Show as<select data-role="analysis-style"></select></label>' +
      '<div class="agis-btnrow">' +
        '<button type="button" class="agis-btn agis-btn--primary" data-act="select-box">&#9634; Box</button>' +
        '<button type="button" class="agis-btn agis-btn--primary" data-act="select-polygon">&#11040; Polygon</button>' +
      '</div>' +
      '<div class="agis-analysis__result"><i>Draw a box or polygon on the map to get statistics, a histogram or a category breakdown here.</i></div>' +
      '<div class="agis-query" hidden>' +
        '<h3>Query features</h3>' +
        '<div class="agis-query__row">' +
          '<select data-role="q-attr"></select>' +
          '<select data-role="q-op">' + OPERATORS.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select>' +
          '<input type="text" data-role="q-value" placeholder="value">' +
        '</div>' +
        '<label class="agis-check"><input type="checkbox" data-role="q-in-view" checked> only in current map view</label>' +
        '<div class="agis-btnrow"><button type="button" class="agis-btn agis-btn--primary" data-act="run-query">Run query</button>' +
        '<button type="button" class="agis-btn" data-act="clear-query">Clear</button></div>' +
        '<div class="agis-query__result"></div>' +
      '</div>';
  };

  AmconnectGIS.prototype.resourcesHtml = function () {
    var self = this;
    var blocks = this.datasets.map(function (d) {
      var rows = d.resources.map(function (r) {
        var c = r.capabilities, btns = [];
        var isSvc = ['wms', 'wfs', 'wcs', 'wmts'].indexOf(r.service_type) !== -1;
        var layer = isSvc ? self.layerForResource(r.id) : null;
        if (r.service_type === 'wms' && c.view) { btns.push('<button type="button" class="agis-btn" data-act="view-resource" data-res="' + esc(r.id) + '">View on map</button>'); }
        if (r.service_type === 'wfs' && c.query) { btns.push('<button type="button" class="agis-btn" data-act="analyse-resource" data-res="' + esc(r.id) + '">Query features</button>'); }
        if (r.service_type === 'wcs' && c.area_statistics) { btns.push('<button type="button" class="agis-btn" data-act="analyse-resource" data-res="' + esc(r.id) + '">Area statistics</button>'); }
        var downloads = r.downloads.length ? r.downloads : (layer ? layer.downloads : []);
        downloads.forEach(function (dl) {
          btns.push('<a class="agis-btn agis-btn--dl" href="' + esc(dl.url) + '" target="_blank" rel="noopener" title="' + esc(dl.media_type || '') + (r.downloads.length ? '' : ' (via the layer\'s ' + dl.service.toUpperCase() + ' service)') + '">&#8615; ' +
            esc(dl.service === 'file' ? dl.label : 'Download ' + dl.label) + '</a>');
        });
        if (r.export_map_image) { btns.push('<a class="agis-btn agis-btn--muted" href="' + esc(r.export_map_image) + '" target="_blank" rel="noopener" title="WMS GetMap of the full extent: a picture, not the data">Export map image</a>'); }
        if (isSvc) { btns.push('<a class="agis-btn agis-btn--muted" href="' + esc(capsUrl(r.endpoint, r.service_type.toUpperCase())) + '" target="_blank" rel="noopener">View source</a>'); }
        else if (r.service_type === 'link' || r.service_type === 'api') { btns.push('<a class="agis-btn" href="' + esc(r.url) + '" target="_blank" rel="noopener">Open</a>'); }
        var viewOnly = r.service_type === 'wms' && r.status !== 'unreachable' && !downloads.length;
        return '<tr class="' + (r.status === 'unreachable' || r.status === 'layer_not_found' ? 'is-broken' : '') + '">' +
          '<td><b>' + esc(r.name) + '</b><br><small>' + esc(r.description) + '</small>' + (r.layer_name ? '<br><code>' + esc(r.layer_name) + '</code>' : '') + '</td>' +
          '<td>' + esc((r.format || r.service_type).toUpperCase()) + '<br>' + originBadge(r.origin) + ' ' + statusBadge(r.status, r.status_detail) +
            (viewOnly ? ' ' + badge('View only', 'viewonly', 'No WFS/WCS or download endpoint: the data itself cannot be downloaded') : '') + '</td>' +
          '<td class="agis-actions">' + btns.join(' ') + '</td></tr>';
      });
      return (self.datasets.length > 1 ? '<h3>' + esc(d.title) + '</h3>' : '') +
        '<table class="agis-table agis-table--resources"><thead><tr><th>Resource</th><th>Type</th><th>Actions (capability-aware)</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
    });
    return blocks.join('') + '<p class="agis-help">Buttons are derived from <code>capabilities</code> in the API: CKAN metadata says which services exist, ' +
      'a GetCapabilities probe says what each service really supports. Nothing is offered that the service did not advertise.</p>';
  };

  AmconnectGIS.prototype.layerForResource = function (resId) {
    for (var i = 0; i < this.datasets.length; i++) {
      var l = this.datasets[i].layers.filter(function (l) { return l.resource_ids.indexOf(resId) !== -1; })[0];
      if (l) { return l; }
    }
    return null;
  };

  // -------------------------------------------------------------------------- map
  AmconnectGIS.prototype.initMap = function (layers) {
    var self = this;
    this.baseLayer = new ol.layer.Tile({ source: BASEMAPS.osm.make(), zIndex: -1 });
    this.selectionSource = new ol.source.Vector();
    this.selectionLayer = new ol.layer.Vector({
      source: this.selectionSource, zIndex: 1000,
      style: new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#d62728', width: 2, lineDash: [6, 4] }), fill: new ol.style.Fill({ color: 'rgba(214,39,40,0.08)' }) })
    });
    this.highlightSource = new ol.source.Vector();
    this.highlightLayer = new ol.layer.Vector({
      source: this.highlightSource, zIndex: 999,
      style: new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#ffb000', width: 3 }), fill: new ol.style.Fill({ color: 'rgba(255,176,0,0.18)' }),
        image: new ol.style.Circle({ radius: 7, stroke: new ol.style.Stroke({ color: '#ffb000', width: 3 }), fill: new ol.style.Fill({ color: 'rgba(255,176,0,0.3)' }) }) })
    });
    this.queryLayer = new ol.layer.Vector({
      source: new ol.source.Vector(), zIndex: 998,
      style: new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#00b4d8', width: 2.5 }), fill: new ol.style.Fill({ color: 'rgba(0,180,216,0.22)' }),
        image: new ol.style.Circle({ radius: 6, stroke: new ol.style.Stroke({ color: '#00b4d8', width: 2 }), fill: new ol.style.Fill({ color: 'rgba(0,180,216,0.4)' }) }) })
    });
    this.popupOverlay = new ol.Overlay({ element: this.popupEl, positioning: 'bottom-center', offset: [0, -12], stopEvent: true, autoPan: { animation: { duration: 200 } } });
    this.map = new ol.Map({
      target: this.mapEl,
      layers: [this.baseLayer],
      overlays: [this.popupOverlay],
      controls: ol.control.defaults.defaults({ attributionOptions: { collapsible: false } })
        .extend([new ol.control.ScaleLine(),
                 new ol.control.MousePosition({ coordinateFormat: function (c) { return c ? c[0].toFixed(4) + ', ' + c[1].toFixed(4) : ''; },
                                                projection: 'EPSG:4326', target: q(this.root, '.agis__coords'), className: 'agis-mouse' })]),
      view: new ol.View({ center: ol.proj.fromLonLat(DEFAULT_CENTER), zoom: DEFAULT_ZOOM })
    });
    layers.forEach(function (l) { self.addLayer(l.def, l.dataset); });
    this.map.addLayer(this.queryLayer);
    this.map.addLayer(this.highlightLayer);
    this.map.addLayer(this.selectionLayer);
    var onResize = function () {
      self.map.updateSize();
      if (self.pendingExtent) { var b = self.pendingExtent; self.pendingExtent = null; self.zoomToExtent(b); }
    };
    if (typeof ResizeObserver !== 'undefined') { new ResizeObserver(onResize).observe(this.mapEl); }
    global.addEventListener('resize', onResize);

    this.map.on('singleclick', function (evt) { if (!self.selecting && self.identify) { self.featureInfo(evt); } });
    this.tooltipEl = document.createElement('div'); this.tooltipEl.className = 'agis__tooltip'; this.tooltipEl.hidden = true;
    this.tooltipOverlay = new ol.Overlay({ element: this.tooltipEl, positioning: 'bottom-left', offset: [12, -8], stopEvent: false });
    this.map.addOverlay(this.tooltipOverlay);
    this.map.on('pointermove', function (evt) {
      if (evt.dragging || self.selecting) { return; }
      var vectors = self.olLayers.filter(function (e) { return e.mode === 'wfs' && e.vector && e.layer.getVisible(); }).map(function (e) { return e.vector; });
      var hit = vectors.length ? self.map.forEachFeatureAtPixel(evt.pixel, function (f) { return f; }, { layerFilter: function (l) { return vectors.indexOf(l) !== -1; }, hitTolerance: 3 }) : null;
      self.mapEl.style.cursor = hit ? 'pointer' : '';
      if (hit) {
        var p = hit.getProperties();
        var label = p.title || p.name || p.deposit_name || p.site_name || p.unit_name || Object.keys(p).map(function (k) { return typeof p[k] === 'string' ? p[k] : null; }).filter(Boolean)[0] || '';
        self.tooltipEl.textContent = label; self.tooltipEl.hidden = !label; self.tooltipOverlay.setPosition(evt.coordinate);
      } else { self.tooltipEl.hidden = true; }
    });
    this.map.on('moveend', function () {
      if (!self.catalogueOpen) { return; }
      clearTimeout(self.catalogueTimer);
      self.catalogueTimer = setTimeout(function () { self.searchCatalogue(); }, 400);
    });
    this.dragBox = new ol.interaction.DragBox({ condition: ol.events.condition.always });
    this.dragBox.on('boxend', function () { var g = self.dragBox.getGeometry(); self.setSelecting(null); self.runStats(g); });
    this.drawPolygon = new ol.interaction.Draw({ type: 'Polygon', source: new ol.source.Vector() });
    this.drawPolygon.on('drawend', function (e) { var g = e.feature.getGeometry(); self.setSelecting(null); setTimeout(function () { self.runStats(g); }, 0); });
  };

  AmconnectGIS.prototype.addLayer = function (def, dataset) {
    var self = this;
    var wms = def.services.wms;
    var source = new ol.source.TileWMS({
      url: wms.endpoint,
      params: { LAYERS: def.layer_name, TILED: true, TRANSPARENT: true, FORMAT: 'image/png' },
      crossOrigin: (def.origin === 'hosted' || wms.cors) ? 'anonymous' : null,
      serverType: def.origin === 'hosted' ? 'geoserver' : undefined
    });
    this.entrySeq = (this.entrySeq || 0) + 1;
    var tile = new ol.layer.Tile({ source: source, visible: true });
    var entry = { id: 'L' + this.entrySeq, def: def, dataset: dataset, pending: 0, errors: 0, style: null, mode: 'wms',
                  tile: tile, vector: null, layer: new ol.layer.Group({ layers: [tile] }) };
    source.on('tileloadstart', function () { entry.pending++; self.updateStatus(entry); });
    source.on('tileloadend', function () { entry.pending = Math.max(0, entry.pending - 1); self.updateStatus(entry); });
    source.on('tileloaderror', function () { entry.pending = Math.max(0, entry.pending - 1); entry.errors++; self.updateStatus(entry); });
    entry.layer.on('change:visible', function () { self.renderLegend(); });
    this.olLayers.push(entry);
    // keep overlays on top: insert before queryLayer once it is in the map
    var coll = this.map.getLayers(), idx = coll.getArray().indexOf(this.queryLayer);
    if (idx === -1) { this.map.addLayer(entry.layer); } else { coll.insertAt(idx, entry.layer); }
    return entry;
  };

  // "Vectors" mode: features come from WFS (GeoJSON, per view extent), styled like the server
  AmconnectGIS.prototype.setMode = function (entry, mode) {
    var self = this;
    if (mode === 'wfs' && !entry.def.services.wfs) { return; }
    entry.mode = mode;
    if (mode === 'wfs' && !entry.vector) {
      var wfs = entry.def.services.wfs.endpoint, typeName = entry.def.layer_name;
      var vsrc = new ol.source.Vector({
        format: new ol.format.GeoJSON(),
        strategy: ol.loadingstrategy.bbox,
        loader: function (extent, resolution, projection, success, failure) {
          entry.pending++; self.updateStatus(entry);
          var url = join(wfs, 'service=WFS&version=2.0.0&request=GetFeature&typeNames=' + encodeURIComponent(typeName) +
            '&outputFormat=application/json&srsName=EPSG:3857&count=' + VECTOR_MAX + '&bbox=' + extent.join(',') + ',EPSG:3857');
          fetch(url).then(function (r) { if (!r.ok) { throw new Error('WFS ' + r.status); } return r.json(); }).then(function (json) {
            var feats = vsrc.getFormat().readFeatures(json);
            vsrc.addFeatures(feats);
            entry.truncated = json.numberMatched != null && json.numberReturned != null && json.numberReturned < json.numberMatched ? json.numberMatched : 0;
            entry.pending = Math.max(0, entry.pending - 1); self.updateStatus(entry); success(feats);
          }).catch(function () { entry.pending = Math.max(0, entry.pending - 1); entry.errors++; self.updateStatus(entry); failure(); });
        }
      });
      entry.vector = new ol.layer.Vector({ source: vsrc, visible: false });
      entry.layer.getLayers().push(entry.vector);
      this.applyVectorStyle(entry);
    }
    entry.tile.setVisible(mode === 'wms');
    if (entry.vector) { entry.vector.setVisible(mode === 'wfs'); }
    if (this.compare) { this.setCompare(true); }
    this.renderLayerList();
  };

  AmconnectGIS.prototype.legendJson = function (entry) {
    var url = this.currentLegendUrl(entry).replace(/([?&])format=[^&]*/i, '$1format=application/json');
    if (!/format=application(%2F|\/)json/i.test(url)) { url = join(url, 'format=application/json'); }
    return fetch(url).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('no json legend')); });
  };

  AmconnectGIS.prototype.applyVectorStyle = function (entry) {
    if (!entry.vector) { return; }
    this.legendJson(entry).then(function (json) { entry.vector.setStyle(styleFromLegend(json)); })
      .catch(function () { entry.vector.setStyle(styleFromLegend({})); });
  };

  AmconnectGIS.prototype.activeLayer = function (entry) { return entry.mode === 'wfs' && entry.vector ? entry.vector : entry.tile; };

  AmconnectGIS.prototype.updateStatus = function (entry) {
    var busy = this.olLayers.some(function (e) { return e.pending > 0; });
    if (this.busyEl) { this.busyEl.hidden = !busy; }
    var li = qa(this.root, '.agis-layer').filter(function (el) { return el.getAttribute('data-entry') === entry.id; })[0];
    if (!li) { return; }
    var st = q(li, '.agis-layer__status');
    if (entry.pending > 0) { st.innerHTML = '<span class="agis-spinner" title="Loading tiles"></span>'; }
    else if (entry.errors > 0) { st.innerHTML = badge(entry.mode === 'wfs' ? 'Load errors' : 'Tile errors', 'error', entry.errors + ' request(s) failed: server unreachable, layer missing or blocked by the browser'); }
    else if (entry.mode === 'wfs' && entry.truncated) { st.innerHTML = badge('first ' + fmt(VECTOR_MAX), 'muted', entry.truncated.toLocaleString() + ' features in view; zoom in to see all'); }
    else { st.innerHTML = ''; }
  };

  AmconnectGIS.prototype.renderLayerList = function () {
    var ul = q(this.root, '.agis-layers'), self = this;
    var many = this.datasets.length > 1;
    ul.innerHTML = this.olLayers.slice().reverse().map(function (e, i) {
      var def = e.def, c = def.capabilities;
      var foreign = many || e.dataset !== self.data;
      var dl = def.downloads.length
        ? '<details class="agis-dl"><summary>&#8615; Download</summary><ul>' + def.downloads.map(function (d) {
            return '<li><a href="' + esc(d.url) + '" target="_blank" rel="noopener">' + esc(d.label) + '</a></li>'; }).join('') + '</ul></details>'
        : badge('View only', 'viewonly', 'No WFS/WCS behind this WMS: the data cannot be downloaded');
      return '<li class="agis-layer" data-entry="' + e.id + '" data-layer="' + esc(def.layer_name) + '">' +
        '<div class="agis-layer__row">' +
          '<input type="checkbox" data-act="visible" ' + (e.layer.getVisible() ? 'checked' : '') + ' title="Show / hide">' +
          '<span class="agis-layer__title" title="' + esc(def.layer_name) + '">' + esc(def.title) + '</span>' +
          '<span class="agis-layer__status"></span>' +
          (e.dataset !== self.data ? '<button type="button" class="agis-layer__remove" data-act="remove" title="Remove from map">&#10005;</button>' : '') +
        '</div>' +
        (foreign ? '<div class="agis-layer__dataset">' + esc(e.dataset.title) + '</div>' : '') +
        '<div class="agis-layer__badges">' + originBadge(def.origin) + ' ' + kindBadge(def) + ' ' + statusBadge(def.status, def.services.wms.status_detail) +
          (c.identify ? badge('Identify', 'cap', 'Queryable: click the map to inspect') : '') + '</div>' +
        '<div class="agis-layer__tools">' +
          '<button type="button" data-act="zoom" title="Zoom to layer extent"' + (def.extent ? '' : ' disabled') + '>&#8982;</button>' +
          '<button type="button" data-act="up" title="Move up (draw on top)"' + (i === 0 ? ' disabled' : '') + '>&#9650;</button>' +
          '<button type="button" data-act="down" title="Move down"' + (i === self.olLayers.length - 1 ? ' disabled' : '') + '>&#9660;</button>' +
          '<label class="agis-opacity" title="Opacity"><input type="range" min="0" max="100" value="' + Math.round(e.layer.getOpacity() * 100) + '" data-act="opacity"></label>' +
          (def.services.wfs && c.query ? '<span class="agis-mode"><button type="button" data-act="mode-wms"' + (e.mode === 'wms' ? ' class="is-active"' : '') + ' title="Draw WMS tiles rendered by the server">Tiles</button>' +
            '<button type="button" data-act="mode-wfs"' + (e.mode === 'wfs' ? ' class="is-active"' : '') + ' title="Load the features from WFS and draw them in the browser: instant identify, hover, sharper symbols">Vectors</button></span>' : '') +
        '</div>' +
        ((def.styles || []).length > 1 ? '<label class="agis-style" title="Symbology (WMS style advertised by the server)">Show as ' +
          '<select data-act="style">' + def.styles.map(function (st) {
            return '<option value="' + esc(st.name) + '"' + ((e.style || def.styles[0].name) === st.name ? ' selected' : '') + '>' + esc(st.title) + '</option>';
          }).join('') + '</select></label>' : '') +
        '<div class="agis-layer__dl">' + dl + '</div>' +
        '</li>';
    }).join('') || '<li class="agis-help">This dataset has no WMS layer to draw. Use "+ Add layer" to pick one from the catalogue.</li>';
    var count = q(this.root, '[data-role="layer-count"]'); if (count) { count.textContent = this.olLayers.length; }
    var dcount = q(this.root, '[data-role="dataset-count"]'); if (dcount) { dcount.innerHTML = this.datasets.length > 1 ? badge(this.datasets.length + ' datasets', 'muted') : ''; }
    this.renderAnalysisTargets();
  };

  AmconnectGIS.prototype.setStyle = function (entry, styleName) {
    var def = entry.def, styles = def.styles || [];
    // accept "workspace:style" as well as the advertised name
    var match = styles.filter(function (x) { return x.name === styleName || x.name === String(styleName).split(':').pop(); })[0];
    styleName = match ? match.name : styleName;
    var isDefault = !styleName || (styles[0] && styles[0].name === styleName);
    entry.style = isDefault ? null : styleName;
    entry.tile.getSource().updateParams({ STYLES: isDefault ? '' : styleName });
    entry.legendHtml = null;
    this.applyVectorStyle(entry);
    this.renderLegend();
  };

  AmconnectGIS.prototype.currentLegendUrl = function (entry) {
    var st = entry.style && (entry.def.styles || []).filter(function (x) { return x.name === entry.style; })[0];
    return st ? st.legend_url : entry.def.legend_url;
  };

  AmconnectGIS.prototype.renderLegend = function () {
    var box = q(this.root, '.agis__legend'), body = q(this.root, '.agis__legend-body'), self = this;
    if (!box) { return; }
    var visible = this.olLayers.filter(function (e) { return e.layer.getVisible() && e.def.legend_url; }).reverse();
    box.hidden = !visible.length;
    if (!visible.length) { return; }
    var sel = q(box, '[data-act="legend-layer"]');
    var choice = sel ? sel.value : '';
    var names = visible.map(function (e) { return e.id; });
    if (choice && choice !== 'all' && names.indexOf(choice) === -1) { choice = ''; }
    if (!choice) { choice = visible.length > 1 ? 'all' : names[0]; }
    q(box, '.agis__legend-head').innerHTML = '<b>Legend</b>' +
      (visible.length > 1 ? '<select data-act="legend-layer" title="Which layer\'s legend to show"><option value="all"' + (choice === 'all' ? ' selected' : '') + '>All layers</option>' +
        visible.map(function (e) { return '<option value="' + e.id + '"' + (choice === e.id ? ' selected' : '') + '>' + esc(e.def.title) + '</option>'; }).join('') + '</select>' : '') +
      '<button type="button" data-act="legend-toggle">' + (this.legendCollapsed ? '&#43;' : '&#8722;') + '</button>';
    body.hidden = !!this.legendCollapsed;
    var items = choice === 'all' ? visible : visible.filter(function (e) { return e.id === choice; });
    body.innerHTML = items.map(function (e) {
      var st = e.style && (e.def.styles || []).filter(function (x) { return x.name === e.style; })[0];
      return '<div class="agis__legend-item" data-legend="' + e.id + '"><div class="agis__legend-title">' + esc(e.def.title) +
        (st ? ' <small class="agis-muted">(' + esc(st.title) + ')</small>' : '') + '</div>' +
        '<div class="agis__legend-graphic"><span class="agis-spinner"></span></div></div>';
    }).join('');
    items.forEach(function (e) {
      self.legendHtml(e).then(function (html) {
        var el = qa(body, '.agis__legend-item').filter(function (n) { return n.getAttribute('data-legend') === e.id; })[0];
        if (el) { q(el, '.agis__legend-graphic').innerHTML = html; }
      });
    });
  };

  // GeoServer answers GetLegendGraphic with FORMAT=application/json (rules + symbolizers, raster colormap);
  // that lets us draw a compact legend and skip transparent "nodata" entries. Other servers get the PNG.
  AmconnectGIS.prototype.legendHtml = function (entry) {
    var def = entry.def, legendUrl = this.currentLegendUrl(entry);
    var png = '<img alt="Legend" src="' + esc(legendUrl) + '" onerror="this.outerHTML=\'<small class=agis-muted>not available</small>\'">';
    if (entry.legendHtml) { return Promise.resolve(entry.legendHtml); }
    if (def.origin !== 'hosted' && !def.services.wms.cors) { return Promise.resolve(png); }
    var url = legendUrl.replace(/([?&])format=[^&]*/i, '$1format=application/json');
    if (!/format=application%2Fjson|format=application\/json/i.test(url)) { url = join(url, 'format=application/json'); }
    return fetch(url).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('no json legend')); })
      .then(function (json) {
        var rules = ((json.Legend || [])[0] || {}).rules || [];
        var out = [];
        rules.forEach(function (rule) {
          (rule.symbolizers || []).forEach(function (sym) {
            if (sym.Raster && sym.Raster.colormap) {
              var entries = (sym.Raster.colormap.entries || []).filter(function (en) { return Number(en.opacity == null ? 1 : en.opacity) > 0; });
              if (!entries.length) { return; }
              // classified colormaps (few entries or descriptive labels) read better as rows than as a ramp
              var discrete = entries.length <= 8 && entries.some(function (en) { return String(en.label || '').length > 7; });
              if (discrete) {
                entries.forEach(function (en) {
                  out.push('<div class="agis-legend-row"><span class="agis-swatch" style="background:' + esc(en.color) + '"></span><span>' + esc(en.label || en.quantity) + '</span></div>');
                });
                return;
              }
              var stops = entries.map(function (en, i) { return en.color + ' ' + Math.round(100 * i / Math.max(1, entries.length - 1)) + '%'; }).join(', ');
              var labels = entries.length <= 6 ? entries : [entries[0], entries[Math.floor(entries.length / 3)], entries[Math.floor(2 * entries.length / 3)], entries[entries.length - 1]];
              out.push('<div class="agis-ramp"><div class="agis-ramp__bar" style="background: linear-gradient(to right, ' + stops + ')"></div>' +
                '<div class="agis-ramp__labels">' + labels.map(function (en) { return '<span>' + esc(en.label || en.quantity) + '</span>'; }).join('') + '</div></div>');
            } else if (sym.Polygon) {
              var p = sym.Polygon;
              out.push(legendRow('<span class="agis-swatch" style="background:' + esc(p.fill || 'transparent') + ';opacity:' + esc(p['fill-opacity'] || 1) + ';border:' + esc(p['stroke-width'] || 1) + 'px solid ' + esc(p.stroke || 'transparent') + '"></span>', rule));
            } else if (sym.Line) {
              var l = sym.Line;
              out.push(legendRow('<span class="agis-swatch agis-swatch--line" style="border-top:' + esc(Math.max(1, +l['stroke-width'] || 1)) + 'px solid ' + esc(l.stroke || '#333') + '"></span>', rule));
            } else if (sym.Point) {
              var g = (sym.Point.graphics || [])[0] || {};
              var size = Math.min(14, Math.max(6, +sym.Point.size || 8));
              var shape = g.mark === 'square' ? 'border-radius:2px;' : (g.mark === 'triangle' ? 'clip-path:polygon(50% 0,100% 100%,0 100%);' : 'border-radius:50%;');
              out.push(legendRow('<span class="agis-swatch" style="' + shape + 'width:' + size + 'px;height:' + size + 'px;background:' + esc(g.fill || '#333') + ';border:' + esc(g['stroke-width'] || 1) + 'px solid ' + esc(g.stroke || 'transparent') + '"></span>', rule));
            } else if (sym.Text) {
              return;
            } else {
              out.push(legendRow('<span class="agis-swatch"></span>', rule));
            }
          });
        });
        entry.legendHtml = out.length ? out.join('') : png;
        return entry.legendHtml;
      })
      .catch(function () { entry.legendHtml = png; return png; });
  };

  function legendRow(swatch, rule) {
    var label = rule.title || rule.name || '';
    // a trailing "(381)" in the rule title is a feature count: pull it into its own right-aligned column
    var m = /^(.*\S)\s*\((\d[\d,.]*)\)$/.exec(label);
    return '<div class="agis-legend-row">' + swatch + '<span>' + esc(m ? m[1] : label) + '</span>' +
      (m ? '<span class="agis-legend-count">' + esc(m[2]) + '</span>' : '') + '</div>';
  }

  AmconnectGIS.prototype.renderAnalysisTargets = function () {
    var sel = q(this.root, '[data-role="analysis-layer"]');
    if (!sel) { return; }
    var current = sel.value;
    var options = this.olLayers.filter(function (e) { return e.def.capabilities.area_statistics || e.def.capabilities.query; });
    sel.innerHTML = options.length ? options.map(function (e) {
      return '<option value="' + e.id + '">' + esc(e.def.title) + ' (' + e.def.data_kind + ')</option>';
    }).join('') : '<option value="">No layer supports analysis</option>';
    if (current && options.some(function (e) { return e.id === current; })) { sel.value = current; }
    this.renderAnalysisStyle();
    this.setupQueryBuilder();
  };

  // "Show as" for the analysis target layer (same style switch as the layer card)
  AmconnectGIS.prototype.renderAnalysisStyle = function () {
    var wrap = q(this.root, '.agis-analysis__style'), sel = q(this.root, '[data-role="analysis-style"]');
    if (!wrap) { return; }
    var entry = this.analysisTarget();
    var styles = entry ? (entry.def.styles || []) : [];
    wrap.hidden = styles.length < 2;
    if (wrap.hidden) { return; }
    sel.innerHTML = styles.map(function (st) {
      return '<option value="' + esc(st.name) + '"' + ((entry.style || styles[0].name) === st.name ? ' selected' : '') + '>' + esc(st.title) + '</option>';
    }).join('');
  };

  AmconnectGIS.prototype.entryFor = function (li) {
    var id = li.getAttribute('data-entry');
    return this.olLayers.filter(function (e) { return e.id === id; })[0];
  };

  AmconnectGIS.prototype.bind = function () {
    var self = this;
    this.root.addEventListener('click', function (evt) {
      var t = evt.target.closest('[data-tab],[data-act]');
      if (!t || !self.root.contains(t)) { return; }
      if (t.hasAttribute('data-tab')) { return self.showTab(t.getAttribute('data-tab')); }
      var act = t.getAttribute('data-act');
      var li = t.closest('.agis-layer');
      var entry = li ? self.entryFor(li) : null;
      switch (act) {
        case 'zoom-dataset': return self.zoomToDataset();
        case 'identify': self.identify = !self.identify; t.classList.toggle('is-active', self.identify); return;
        case 'select-box': return self.setSelecting(self.selecting === 'box' ? null : 'box');
        case 'select-polygon': return self.setSelecting(self.selecting === 'polygon' ? null : 'polygon');
        case 'compare': return self.setCompare(!self.compare);
        case 'share': return self.toggleShare();
        case 'share-copy': return self.copyText(t.getAttribute('data-text'), t);
        case 'share-png': return self.exportPng();
        case 'fullscreen': return self.toggleFullscreen();
        case 'clear': return self.clearSelection();
        case 'popup-close': self.popupEl.hidden = true; self.highlightSource.clear(); return;
        case 'legend-toggle': { var b = q(self.root, '.agis__legend-body'); b.hidden = !b.hidden; self.legendCollapsed = b.hidden; t.innerHTML = b.hidden ? '&#43;' : '&#8722;'; return; }
        case 'sheet-toggle': return self.setSheet(!self.root.classList.contains('agis--sheet-open'));
        case 'legend-layer': return;
        case 'mode-wms': return self.setMode(entry, 'wms');
        case 'mode-wfs': return self.setMode(entry, 'wfs');
        case 'zoom': return self.zoomToExtent(entry.def.extent);
        case 'up': return self.reorder(entry, +1);
        case 'down': return self.reorder(entry, -1);
        case 'remove': return self.removeLayer(entry);
        case 'add-layer': return self.toggleCatalogue();
        case 'catalogue-add': return self.addFromCatalogue(t.getAttribute('data-name'), t);
        case 'view-resource': return self.viewResource(t.getAttribute('data-res'));
        case 'analyse-resource': return self.analyseResource(t.getAttribute('data-res'));
        case 'run-query': return self.runQuery();
        case 'clear-query': self.queryLayer.getSource().clear(); q(self.root, '.agis-query__result').innerHTML = ''; return;
        case 'highlight-last': return self.highlightLast();
        default: return;
      }
    });
    this.root.addEventListener('change', function (evt) {
      var t = evt.target, li = t.closest('.agis-layer'), entry = li ? self.entryFor(li) : null;
      if (t.getAttribute('data-act') === 'visible' && entry) { entry.layer.setVisible(t.checked); }
      if (t.getAttribute('data-act') === 'style' && entry) { self.setStyle(entry, t.value); self.renderAnalysisStyle(); }
      if (t.getAttribute('data-act') === 'legend-layer') { self.renderLegend(); }
      if (t.getAttribute('data-act') === 'basemap') { self.setBasemap(t.value); }
      if (t.getAttribute('data-role') === 'analysis-layer') { self.renderAnalysisStyle(); self.setupQueryBuilder(); }
      if (t.getAttribute('data-role') === 'analysis-style') { var target = self.analysisTarget(); if (target) { self.setStyle(target, t.value); self.renderLayerList(); } }
    });
    this.root.addEventListener('input', function (evt) {
      var t = evt.target, li = t.closest('.agis-layer'), entry = li ? self.entryFor(li) : null;
      if (t.getAttribute('data-act') === 'opacity' && entry) { entry.layer.setOpacity(t.value / 100); }
      if (t.classList.contains('agis__swipe')) { self.map.render(); }
    });
    this.root.addEventListener('keydown', function (evt) {
      if (evt.key === 'Enter' && evt.target.getAttribute('data-role') === 'q-value') { self.runQuery(); }
    });
  };

  AmconnectGIS.prototype.showTab = function (tab) {
    this.tab = tab;
    qa(this.root, '[data-tab]').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-tab') === tab); });
    var mapPane = q(this.root, '[data-pane="map"]');
    qa(this.root, '.agis__pane').forEach(function (p) { p.hidden = true; });
    if (tab === 'map' || tab === 'analysis') {
      mapPane.hidden = false;
      q(this.root, '[data-side="layers"]').hidden = tab !== 'map';
      q(this.root, '[data-side="analysis"]').hidden = tab !== 'analysis';
      this.root.classList.toggle('agis--analysis', tab === 'analysis');
      q(this.root, '[data-role="sheet-label"]').textContent = tab === 'analysis' ? 'Analysis' : 'Layers';
      this.setSheet(tab === 'analysis');
      var self = this; setTimeout(function () { self.map.updateSize(); }, 0);
    } else {
      var pane = q(this.root, '[data-pane="' + tab + '"]'); if (pane) { pane.hidden = false; }
    }
  };

  // narrow screens: the side panel is a bottom sheet over the map (CSS), collapsed to its handle
  AmconnectGIS.prototype.setSheet = function (open) {
    this.root.classList.toggle('agis--sheet-open', !!open);
    var h = q(this.root, '.agis__sheet-handle'); if (h) { h.setAttribute('aria-expanded', open ? 'true' : 'false'); }
  };

  AmconnectGIS.prototype.setBasemap = function (key) {
    if (!BASEMAPS[key]) { return; }
    this.basemapKey = key;
    var src = BASEMAPS[key].make();
    this.baseLayer.setSource(src);
    this.baseLayer.setVisible(!!src);
    var sel = q(this.root, '[data-act="basemap"]'); if (sel) { sel.value = key; }
    this.mapEl.classList.toggle('agis__map--dark', key === 'dark' || key === 'satellite');
  };

  AmconnectGIS.prototype.reorder = function (entry, dir) {
    var layers = this.map.getLayers();
    var idx = layers.getArray().indexOf(entry.layer), target = idx + dir;
    var min = 1, max = layers.getArray().indexOf(this.queryLayer) - 1;
    if (target < min || target > max) { return; }
    layers.removeAt(idx); layers.insertAt(target, entry.layer);
    this.olLayers.sort(function (a, b) { return layers.getArray().indexOf(a.layer) - layers.getArray().indexOf(b.layer); });
    this.renderLayerList(); this.renderLegend();
  };

  AmconnectGIS.prototype.removeLayer = function (entry) {
    this.map.removeLayer(entry.layer);
    this.olLayers = this.olLayers.filter(function (e) { return e !== entry; });
    if (entry.dataset !== this.data && !this.olLayers.some(function (e) { return e.dataset === entry.dataset; })) {
      this.datasets = this.datasets.filter(function (d) { return d !== entry.dataset; });
      q(this.root, '[data-pane="resources"]').innerHTML = this.resourcesHtml();
    }
    this.renderLayerList(); this.renderLegend();
  };

  AmconnectGIS.prototype.zoomToExtent = function (bbox) {
    if (!bbox) { return; }
    var size = this.map.getSize();
    if (!size || !size[0] || !size[1]) { this.pendingExtent = bbox; return; }
    this.map.getView().fit(ol.proj.transformExtent(bbox, 'EPSG:4326', 'EPSG:3857'), { padding: [24, 24, 24, 24], maxZoom: 12, duration: 300 });
  };

  AmconnectGIS.prototype.zoomToDataset = function () {
    var boxes = this.datasets.map(function (d) { return d.bbox; }).filter(Boolean);
    if (!boxes.length && this.olLayers.length) { boxes = [this.olLayers[0].def.extent]; }
    if (!boxes.length || !boxes[0]) { return; }
    this.zoomToExtent([Math.min.apply(null, boxes.map(function (b) { return b[0]; })), Math.min.apply(null, boxes.map(function (b) { return b[1]; })),
                       Math.max.apply(null, boxes.map(function (b) { return b[2]; })), Math.max.apply(null, boxes.map(function (b) { return b[3]; }))]);
  };

  AmconnectGIS.prototype.viewResource = function (resId) {
    var entry = this.olLayers.filter(function (e) { return e.def.resource_ids.indexOf(resId) !== -1; })[0];
    this.showTab('map');
    if (entry) { entry.layer.setVisible(true); this.renderLayerList(); this.zoomToExtent(entry.def.extent); }
  };

  AmconnectGIS.prototype.analyseResource = function (resId) {
    var layer = this.layerForResource(resId);
    this.showTab('analysis');
    var sel = q(this.root, '[data-role="analysis-layer"]');
    var target = layer && this.olLayers.filter(function (e) { return e.def === layer; })[0];
    if (target && sel) { sel.value = target.id; this.renderAnalysisStyle(); this.setupQueryBuilder(); }
    if (layer) { this.zoomToExtent(layer.extent); }
  };

  AmconnectGIS.prototype.toggleFullscreen = function () {
    var el = this.root;
    if (document.fullscreenElement) { document.exitFullscreen(); }
    else if (el.requestFullscreen) { el.requestFullscreen(); }
  };

  // ------------------------------------------------------------------ compare (swipe)
  AmconnectGIS.prototype.setCompare = function (on) {
    var slider = q(this.root, '.agis__swipe'), btn = q(this.root, '[data-act="compare"]');
    var top = this.olLayers.filter(function (e) { return e.layer.getVisible(); }).slice(-1)[0];
    if (this.compareEntry) {
      this.compareEntry.layer.un('prerender', this.compareEntry.pre); this.compareEntry.layer.un('postrender', this.compareEntry.post);
      this.compareEntry = null;
    }
    var topLayer = top && this.activeLayer(top);
    this.compare = on && !!top;
    slider.hidden = !this.compare; btn.classList.toggle('is-active', this.compare);
    if (!this.compare) { this.map.render(); return; }
    var pre = function (evt) {
      var ctx = evt.context, w = ctx.canvas.width * (slider.value / 100);
      ctx.save(); ctx.beginPath(); ctx.rect(w, 0, ctx.canvas.width - w, ctx.canvas.height); ctx.clip();
    };
    var post = function (evt) { evt.context.restore(); };
    topLayer.on('prerender', pre); topLayer.on('postrender', post);
    this.compareEntry = { layer: topLayer, pre: pre, post: post };
    this.showInfo('Compare', '<p class="agis-muted">Drag the slider: <b>' + esc(top.def.title) + '</b> is drawn right of the line only, the layers below it on both sides.</p>');
    this.map.render();
  };

  // ----------------------------------------------------------------------- share
  AmconnectGIS.prototype.toggleShare = function () {
    var box = q(this.root, '.agis__share');
    if (!box.hidden) { box.hidden = true; return; }
    var link = this.permalink();
    var hash = link.split('#')[1];
    var embedUrl = (this.opts.embedUrl || link.split('#')[0]) + '#' + hash;
    var iframe = '<iframe src="' + embedUrl + '" style="width:100%;height:640px;border:0"></iframe>';
    box.innerHTML = '<div class="agis__share-head"><b>Share this view</b><button type="button" data-act="share">&#10005;</button></div>' +
      '<label>Permalink (layers, basemap, view, selection)<div class="agis__share-row"><input type="text" readonly value="' + esc(link) + '"><button type="button" class="agis-btn" data-act="share-copy" data-text="' + esc(link) + '">Copy</button></div></label>' +
      '<label>Embed code<div class="agis__share-row"><input type="text" readonly value="' + esc(iframe) + '"><button type="button" class="agis-btn" data-act="share-copy" data-text="' + esc(iframe) + '">Copy</button></div></label>' +
      '<div class="agis-btnrow"><button type="button" class="agis-btn agis-btn--primary" data-act="share-png">&#8615; Download map as PNG</button></div>' +
      '<p class="agis-help">PNG export needs CORS-enabled tiles; a federated layer without CORS taints the canvas and the browser refuses.</p>';
    box.hidden = false;
  };

  AmconnectGIS.prototype.copyText = function (text, btn) {
    var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); };
    if (navigator.clipboard) { navigator.clipboard.writeText(text).then(done, function () { global.prompt('Copy:', text); }); }
    else { global.prompt('Copy:', text); }
  };

  AmconnectGIS.prototype.exportPng = function () {
    var self = this, map = this.map;
    map.once('rendercomplete', function () {
      var size = map.getSize();
      var canvas = document.createElement('canvas'); canvas.width = size[0]; canvas.height = size[1];
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      try {
        qa(self.mapEl, '.ol-layer canvas, canvas.ol-layer').forEach(function (c) {
          if (c.width === 0) { return; }
          var opacity = c.parentNode.style.opacity || c.style.opacity;
          ctx.globalAlpha = opacity === '' ? 1 : Number(opacity);
          var m = c.style.transform.match(/^matrix\(([^)]*)\)$/);
          if (m) { ctx.setTransform.apply(ctx, m[1].split(',').map(Number)); } else { ctx.setTransform(1, 0, 0, 1, 0, 0); }
          ctx.drawImage(c, 0, 0);
        });
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
        ctx.font = '12px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(0, canvas.height - 18, canvas.width, 18);
        ctx.fillStyle = '#333'; ctx.fillText(self.data.title + ' · AMConnect · basemap: ' + BASEMAPS[self.basemapKey].title + ' · © OpenStreetMap contributors', 6, canvas.height - 5);
        var a = document.createElement('a'); a.download = (self.data.name || 'map') + '.png'; a.href = canvas.toDataURL('image/png'); a.click();
      } catch (e) {
        self.showInfo('PNG export', '<p class="agis-error">The browser refused to export: a layer without CORS headers taints the canvas (' + esc(e.message) + '). Hide federated layers or change the basemap and retry.</p>');
      }
    });
    map.renderSync();
  };

  // --------------------------------------------------------------- catalogue search
  AmconnectGIS.prototype.toggleCatalogue = function () {
    var box = q(this.root, '.agis-catalogue');
    this.catalogueOpen = box.hidden;
    box.hidden = !this.catalogueOpen;
    q(this.root, '[data-act="add-layer"]').classList.toggle('is-active', this.catalogueOpen);
    if (this.catalogueOpen) { this.catalogueKey = null; this.searchCatalogue(); }
  };

  AmconnectGIS.prototype.searchCatalogue = function () {
    var self = this, box = q(this.root, '.agis-catalogue');
    var size = this.map.getSize();
    if (!size || !size[0]) { return; }
    var ext = ol.proj.transformExtent(this.map.getView().calculateExtent(size), 'EPSG:3857', 'EPSG:4326');
    var bbox = ext.map(function (v) { return +Math.max(-180, Math.min(180, v)).toFixed(3); });
    bbox[1] = Math.max(-85, bbox[1]); bbox[3] = Math.min(85, bbox[3]);
    var key = bbox.join(',');
    if (key === this.catalogueKey && q(box, '.agis-catalogue__list, .agis-catalogue__empty')) { return; }   // same view: nothing to do
    this.catalogueKey = key;
    var reqId = (this.catalogueReq = (this.catalogueReq || 0) + 1);
    var loaded = this.datasets.map(function (d) { return d.name; });
    var head = q(box, '.agis-catalogue__head');
    if (head) { head.innerHTML = '<b>Datasets in the current view</b><span class="agis-spinner"></span>'; }
    else { box.innerHTML = '<div class="agis-catalogue__head"><b>Datasets in the current view</b><span class="agis-spinner"></span></div>'; }
    var url = this.opts.apiBase + '/spatial-search?bbox=' + key + '&limit=15';
    fetch(url).then(function (r) { return r.json(); }).then(function (json) {
      if (reqId !== self.catalogueReq) { return; }   // a newer search superseded this one
      var items = (json.result || []).filter(function (d) { return loaded.indexOf(d.name) === -1 && d.layer_count > 0; });
      box.innerHTML = '<div class="agis-catalogue__head"><b>Datasets in the current view</b><small class="agis-muted">' + json.count + ' found</small></div>' +
        '<div class="agis-help"><code>spatial-search?bbox=' + key + '</code> (updates as you pan)</div>' +
        (items.length ? '<ul class="agis-catalogue__list">' + items.map(function (d) {
          return '<li><div><b>' + esc(d.title) + '</b><br><small>' + esc(d.organization ? d.organization.title : '') + ' · ' + esc(d.service_types.join('/').toUpperCase()) + '</small></div>' +
            '<div>' + originBadge(d.origin) + ' <button type="button" class="agis-btn agis-btn--small" data-act="catalogue-add" data-name="' + esc(d.name) + '">Add</button></div></li>';
        }).join('') + '</ul>' : '<p class="agis-muted agis-catalogue__empty">No other datasets intersect this view. Zoom out or pan.</p>');
    }).catch(function (e) { if (reqId === self.catalogueReq) { box.innerHTML = '<p class="agis-error">Catalogue search failed: ' + esc(e.message) + '</p>'; } });
  };

  AmconnectGIS.prototype.addFromCatalogue = function (name, btn) {
    var self = this;
    btn.disabled = true; btn.textContent = 'Adding…';
    this.fetchDataset(name).then(function (ds) {
      self.datasets.push(ds);
      ds.layers.filter(function (l) { return l.services.wms; }).forEach(function (l) {
        var entry = self.addLayer(l, ds);
        if (l.origin === 'federated' && l.data_kind === 'unknown') {   // WMS-only external layer, often an opaque basemap
          var coll = self.map.getLayers(); coll.remove(entry.layer); coll.insertAt(1, entry.layer);
          self.olLayers.sort(function (a, b) { return coll.getArray().indexOf(a.layer) - coll.getArray().indexOf(b.layer); });
        }
      });
      self.renderLayerList(); self.renderLegend();
      q(self.root, '[data-pane="resources"]').innerHTML = self.resourcesHtml();
      self.catalogueKey = null; self.searchCatalogue();
      btn.textContent = 'Added';
    }).catch(function (e) { btn.disabled = false; btn.textContent = 'Add'; self.showInfo('Add layer', '<p class="agis-error">' + esc(e.message) + '</p>'); });
  };

  // -------------------------------------------------------------------- identify
  AmconnectGIS.prototype.topVisible = function (filter) {
    var visible = this.olLayers.filter(function (e) { return e.layer.getVisible() && (!filter || filter(e)); });
    return visible.length ? visible[visible.length - 1] : null;
  };

  AmconnectGIS.prototype.showInfo = function (title, html) {
    this.infoEl.innerHTML = '<div class="agis__info-head"><strong>' + esc(title) + '</strong><button type="button" data-act="clear" title="Close">&#10005;</button></div>' + html;
    this.infoEl.hidden = false;
    q(this.root, '.agis__toolbar [data-act="clear"]').hidden = false;
  };

  AmconnectGIS.prototype.showPopup = function (coordinate, title, html) {
    q(this.popupEl, '.agis__popup-head strong').textContent = title;
    q(this.popupEl, '.agis__popup-body').innerHTML = html;
    this.popupEl.hidden = false;
    this.popupOverlay.setPosition(coordinate);
  };

  AmconnectGIS.prototype.clearSelection = function () {
    this.selectionSource.clear(); this.highlightSource.clear(); this.queryLayer.getSource().clear();
    this.popupEl.hidden = true;
    this.infoEl.hidden = true; this.infoEl.innerHTML = '';
    if (this.compare) { this.setCompare(false); }
    q(this.root, '.agis__toolbar [data-act="clear"]').hidden = true;
    this.lastSelection = null; this.lastPolygon = null; this.lastQuery = null; this.lastFeatures = null;
    var res = q(this.root, '.agis-analysis__result');
    if (res) { res.innerHTML = '<i>Draw a box or polygon on the map to get statistics, a histogram or a category breakdown here.</i>'; }
  };

  AmconnectGIS.prototype.featureInfo = function (evt) {
    var self = this;
    var entry = this.topVisible(function (e) { return e.def.capabilities.identify || (e.mode === 'wfs' && e.vector); });
    if (!entry) { return; }
    if (entry.mode === 'wfs' && entry.vector) {
      var hit = null;
      this.map.forEachFeatureAtPixel(evt.pixel, function (f) { hit = f; return true; }, { layerFilter: function (l) { return l === entry.vector; }, hitTolerance: 4 });
      this.highlightSource.clear();
      if (!hit) { return this.showPopup(evt.coordinate, entry.def.title, '<p class="agis-muted">No feature at this location.</p>'); }
      this.highlightSource.addFeature(new ol.Feature(hit.getGeometry().clone()));
      var props = hit.getProperties(); delete props.geometry;
      return this.showPopup(evt.coordinate, entry.def.title, kvTable(Object.keys(props).filter(function (k) { return props[k] !== '' && props[k] != null; })
        .map(function (k) { return [esc(k), esc(props[k])]; })));
    }
    var view = this.map.getView(), src = entry.tile.getSource();
    var url = src.getFeatureInfoUrl(evt.coordinate, view.getResolution(), view.getProjection(), { INFO_FORMAT: 'application/json', FEATURE_COUNT: 5 });
    if (!url) { return; }
    this.highlightSource.clear();
    this.showPopup(evt.coordinate, entry.def.title, '<p class="agis-muted">Querying&hellip;</p>');
    fetch(url).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('GetFeatureInfo ' + r.status)); })
      .then(function (json) {
        var feats = json.features || [];
        if (!feats.length) { return self.showPopup(evt.coordinate, entry.def.title, '<p class="agis-muted">No feature at this location.</p>'); }
        var fmtr = new ol.format.GeoJSON();
        feats.forEach(function (f) {
          if (f.geometry) {
            try { self.highlightSource.addFeature(fmtr.readFeature(f, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' })); } catch (e) { /* ignore */ }
          }
        });
        var props = feats[0].properties || {};
        var keys = Object.keys(props);
        var html;
        if (entry.def.data_kind === 'raster' || (keys.length === 1 && /GRAY_INDEX|value|band/i.test(keys[0]))) {
          var v = props[keys[0]];
          var lonlat = ol.proj.toLonLat(evt.coordinate);
          html = '<div class="agis-pixel"><div class="agis-pixel__value">' + fmt(v) + '</div><div class="agis-muted">pixel value at ' + lonlat[1].toFixed(4) + ', ' + lonlat[0].toFixed(4) + '</div></div>';
        } else {
          html = kvTable(keys.map(function (k) { return [esc(k), esc(props[k])]; })) +
            (feats.length > 1 ? '<p class="agis-muted">' + feats.length + ' features here, showing the first</p>' : '');
        }
        self.showPopup(evt.coordinate, entry.def.title, html);
      })
      .catch(function () {
        var plain = src.getFeatureInfoUrl(evt.coordinate, view.getResolution(), view.getProjection(), { INFO_FORMAT: 'text/html', FEATURE_COUNT: 5 });
        self.showPopup(evt.coordinate, entry.def.title, '<p class="agis-muted">Feature info could not be read in the browser (no CORS or no JSON format on this server). ' +
          '<a href="' + esc(plain) + '" target="_blank" rel="noopener">Open GetFeatureInfo response</a></p>');
      });
  };

  // -------------------------------------------------------------------- analysis
  AmconnectGIS.prototype.setSelecting = function (mode) {
    this.selecting = mode;
    this.map.removeInteraction(this.dragBox); this.map.removeInteraction(this.drawPolygon);
    this.root.classList.toggle('is-selecting', !!mode);
    if (mode) { this.setSheet(false); }
    qa(this.root, '[data-act="select-box"]').forEach(function (b) { b.classList.toggle('is-active', mode === 'box'); });
    qa(this.root, '[data-act="select-polygon"]').forEach(function (b) { b.classList.toggle('is-active', mode === 'polygon'); });
    if (mode === 'box') { this.map.addInteraction(this.dragBox); }
    if (mode === 'polygon') { this.map.addInteraction(this.drawPolygon); }
  };

  AmconnectGIS.prototype.analysisTarget = function () {
    var sel = q(this.root, '[data-role="analysis-layer"]'), id = sel && sel.value;
    var entry = id ? this.olLayers.filter(function (e) { return e.id === id; })[0] : null;
    return entry || this.topVisible(function (e) { return e.def.capabilities.area_statistics; });
  };

  AmconnectGIS.prototype.runStats = function (geom3857) {
    var self = this;
    this.selectionSource.clear();
    this.selectionSource.addFeature(new ol.Feature(geom3857));
    var extent = geom3857.getExtent();
    var bbox = ol.proj.transformExtent(extent, 'EPSG:3857', 'EPSG:4326');
    var b = bbox.map(function (v) { return +v.toFixed(5); });
    var extArea = ol.extent.getArea(extent);
    var isBox = geom3857.getCoordinates()[0].length === 5 && Math.abs(extArea - geom3857.getArea()) < 1e-6 * extArea;
    this.lastSelection = isBox ? b.join(',') : null;
    this.lastPolygon = isBox ? null : geom3857.getCoordinates()[0].slice(0, -1).map(function (c) {
      var ll = ol.proj.toLonLat(c); return ll[0].toFixed(4) + ',' + ll[1].toFixed(4); }).join(';');
    var entry = this.analysisTarget();
    var resultEl = q(this.root, '.agis-analysis__result');
    var show = function (title, html) {
      if (resultEl && !self.opts.compact) { resultEl.innerHTML = '<strong>' + esc(title) + '</strong>' + html; self.showTab('analysis'); }
      else { self.showInfo(title, html); }
      q(self.root, '.agis__toolbar [data-act="clear"]').hidden = false;
    };
    if (!entry) { return show('Statistics', '<p class="agis-muted">No visible layer supports area statistics (needs WCS or WFS with CORS).</p>'); }
    var def = entry.def;
    var shape = isBox ? 'box' : 'polygon (' + (geom3857.getCoordinates()[0].length - 1) + ' vertices)';
    show(def.title, '<p class="agis-muted">Computing statistics for the ' + shape + ' &hellip;</p>');
    var done = function (html) {
      var area = ol.sphere.getArea(geom3857, { projection: 'EPSG:3857' }) / 1e6;
      show(def.title, html + '<p class="agis-muted small">' + shape + ', ' + fmt(area) + ' km² · bbox ' + b.join(', ') +
        ' · <a href="' + esc(self.permalink()) + '">link to this selection</a></p>');
    };
    var fail = function (err) { show(def.title, '<p class="agis-error">Statistics failed: ' + esc(err && err.message || err) + '</p>'); };
    if (def.services.wcs) {
      this.rasterStats(def.services.wcs.endpoint, def.layer_name.replace(':', '__'), bbox, isBox ? null : geom3857).then(done).catch(fail);
    } else if (def.services.wfs) {
      this.vectorStats(def.services.wfs.endpoint, def.layer_name, geom3857, isBox).then(done).catch(fail);
    } else {
      show(def.title, '<p class="agis-muted">This layer is view-only (no WCS/WFS): statistics are not possible.</p>');
    }
  };

  // Raster: WCS DescribeCoverage (size) -> GetCoverage clipped to the bbox -> GeoTIFF -> reduce in browser
  // (optionally masked by a polygon: pixels whose centre falls outside are ignored)
  AmconnectGIS.prototype.rasterStats = function (wcs, coverageId, bbox, maskGeom3857) {
    if (typeof GeoTIFF === 'undefined') { return Promise.reject(new Error('geotiff.js not loaded')); }
    var mask = maskGeom3857 ? maskGeom3857.clone().transform('EPSG:3857', 'EPSG:4326') : null;
    return fetch(join(wcs, 'service=WCS&version=2.0.1&request=DescribeCoverage&coverageId=' + encodeURIComponent(coverageId)))
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (describeXml) {
        var scale = 1;
        var doc = new DOMParser().parseFromString(describeXml, 'text/xml');
        var text = function (tag) { var n = doc.getElementsByTagNameNS('*', tag)[0]; return n ? n.textContent.trim().split(/\s+/).map(Number) : null; };
        var lower = text('lowerCorner'), upper = text('upperCorner'), high = text('high');
        if (lower && upper && high) {
          var envArea = Math.abs((upper[0] - lower[0]) * (upper[1] - lower[1]));
          var boxArea = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
          var est = (high[0] + 1) * (high[1] + 1) * boxArea / envArea;
          if (est > MAX_PIXELS) { scale = Math.sqrt(MAX_PIXELS / est); }
        }
        var url = join(wcs, 'service=WCS&version=2.0.1&request=GetCoverage&coverageId=' + encodeURIComponent(coverageId) +
          '&subset=Long(' + bbox[0] + ',' + bbox[2] + ')&subset=Lat(' + bbox[1] + ',' + bbox[3] + ')' +
          '&subsettingCrs=' + CRS4326 + '&outputCrs=' + CRS4326 + '&format=image/tiff' + (scale < 1 ? '&scaleFactor=' + scale.toFixed(4) : ''));
        return fetch(url).then(function (r) {
          if (!r.ok) { return r.text().then(function (t) { throw new Error('WCS ' + r.status + ': ' + t.replace(/<[^>]+>/g, ' ').trim().slice(0, 200)); }); }
          return r.arrayBuffer();
        }).then(function (buf) { return GeoTIFF.fromArrayBuffer(buf).then(function (t) { return t.getImage(); }); })
          .then(function (image) {
            return image.readRasters({ interleave: false }).then(function (rasters) {
              var band = rasters[0], w = image.getWidth(), h = image.getHeight();
              var fd = image.getFileDirectory();
              var nodata = fd.GDAL_NODATA != null ? parseFloat(fd.GDAL_NODATA) : null;
              var origin = image.getOrigin(), res = image.getResolution();
              var pxW = Math.abs(res[0]), pxH = Math.abs(res[1]);
              var n = 0, sum = 0, sumsq = 0, min = Infinity, max = -Infinity, weighted = 0, area = 0, masked = 0;
              var values = [];
              for (var row = 0; row < h; row++) {
                var lat = origin[1] - (row + 0.5) * pxH;
                var pxArea = (pxW * 111.32 * Math.cos(lat * Math.PI / 180)) * (pxH * 110.57);
                for (var col = 0; col < w; col++) {
                  var v = band[row * w + col];
                  if (v == null || isNaN(v) || (nodata != null && v === nodata)) { continue; }
                  if (mask && !mask.intersectsCoordinate([origin[0] + (col + 0.5) * pxW, lat])) { masked++; continue; }
                  n++; sum += v; sumsq += v * v; values.push(v);
                  if (v < min) { min = v; } if (v > max) { max = v; }
                  weighted += v * pxArea; area += pxArea;
                }
              }
              var mean = n ? sum / n : NaN, std = n ? Math.sqrt(Math.max(sumsq / n - mean * mean, 0)) : NaN;
              values.sort(function (a, b) { return a - b; });
              var median = n ? values[Math.floor(n / 2)] : NaN;
              var bins = []; for (var i = 0; i < 16; i++) { bins.push(0); }
              if (n && max > min) { values.forEach(function (v) { bins[Math.min(15, Math.floor((v - min) / (max - min) * 16))]++; }); }
              var rows = [
                ['Pixels', fmt(w * h) + (scale < 1 ? ' (downsampled x' + scale.toFixed(2) + ')' : '') + (mask ? ', ' + fmt(masked) + ' outside polygon' : '')],
                ['Valid pixels', fmt(n)], ['Min / max', fmt(min) + ' / ' + fmt(max)],
                ['Mean / median', fmt(mean) + ' / ' + fmt(median)], ['Std dev', fmt(std)], ['Sum', fmt(sum)],
                ['Valid area (km²)', fmt(area)],
                ['Σ value × pixel area', '<b>' + fmt(weighted) + '</b> <span class="agis-muted">(estimated total when values are per-km² densities)</span>']
              ];
              var dl = join(wcs, 'service=WCS&version=2.0.1&request=GetCoverage&coverageId=' + encodeURIComponent(coverageId) +
                '&subset=Long(' + bbox[0] + ',' + bbox[2] + ')&subset=Lat(' + bbox[1] + ',' + bbox[3] + ')&format=image/tiff');
              return kvTable(rows) + (n ? '<div class="agis-chart__title">Value distribution (16 bins)</div>' + histogram(bins, min, max) : '') +
                '<p><a class="agis-btn agis-btn--dl" href="' + esc(dl) + '" target="_blank" rel="noopener">&#8615; Download this selection (GeoTIFF, bbox)</a></p>';
            });
          });
      });
  };

  // Vector: WFS GetFeature with BBOX or CQL INTERSECTS -> count, area, category chart
  AmconnectGIS.prototype.vectorStats = function (wfs, typeName, geom3857, isBox) {
    var self = this;
    return this.describeFeatureType(wfs, typeName).then(function (schema) {
      var extent = geom3857.getExtent();
      var params = 'service=WFS&version=2.0.0&request=GetFeature&typeNames=' + encodeURIComponent(typeName) + '&outputFormat=application/json';
      if (isBox || !schema.geometry) { params += '&bbox=' + extent.join(',') + ',EPSG:3857'; }
      else { params += '&CQL_FILTER=' + encodeURIComponent('INTERSECTS(' + schema.geometry + ', ' + polygonWkt3857(geom3857) + ')'); }
      var url = join(wfs, params + '&srsName=EPSG:3857');
      return fetch(url).then(function (r) { if (!r.ok) { throw new Error('WFS ' + r.status); } return r.json(); }).then(function (json) {
        var feats = new ol.format.GeoJSON().readFeatures(json);
        self.lastFeatures = feats;
        var area = 0, counts = {}, numeric = {};
        feats.forEach(function (f) {
          var g = f.getGeometry();
          if (g && /Polygon/.test(g.getType())) { area += ol.sphere.getArea(g, { projection: 'EPSG:3857' }); }
          var props = f.getProperties();
          Object.keys(props).forEach(function (k) {
            if (k === 'geometry') { return; }
            if (typeof props[k] === 'string') { counts[k] = counts[k] || {}; counts[k][props[k]] = (counts[k][props[k]] || 0) + 1; }
            else if (typeof props[k] === 'number') {
              var st = numeric[k] = numeric[k] || { sum: 0, n: 0, min: Infinity, max: -Infinity, int: true };
              st.sum += props[k]; st.n++; st.min = Math.min(st.min, props[k]); st.max = Math.max(st.max, props[k]); st.int = st.int && props[k] === Math.round(props[k]);
            }
          });
        });
        // breakdown field: a known thematic attribute first, else the most compact categorical
        // text field that is not an id / name / free text
        var PREFERRED = ['commodity_type', 'commodity', 'main_ore', 'country', 'status', 'deposit_type', 'rock_class', 'category', 'type', 'class', 'lithology'];
        var NOISY = /^(uuid|id|fid|gid|.*_id|title|name|.*name|description|notes|comments|url|.*url|source|copyright|registrant|.*date.*)$/i;
        var usable = function (k) { var n = Object.keys(counts[k]).length; return n > 1 && n < feats.length; };
        var catField = PREFERRED.filter(function (k) { return counts[k] && usable(k); })[0] ||
          Object.keys(counts).filter(function (k) { return usable(k) && !NOISY.test(k); })
            .sort(function (a, b) { return Object.keys(counts[a]).length - Object.keys(counts[b]).length; })[0];
        var rows = [['Features ' + (isBox ? 'intersecting box' : 'intersecting polygon'), fmt(feats.length)]];
        if (area > 0) { rows.push(['Area of those features (km²)', fmt(area / 1e6)]); }
        Object.keys(numeric).filter(function (k) {
          var st = numeric[k];
          return !/^(gid|id|fid|objectid|.*_id|year|.*date.*|discovered)$/i.test(k) && !(st.min >= 1800 && st.max <= 2100 && st.int);
        }).slice(0, 3).forEach(function (k) { rows.push([esc(k) + ' (Σ / mean)', fmt(numeric[k].sum) + ' / ' + fmt(numeric[k].sum / numeric[k].n)]); });
        var chart = '';
        if (catField) {
          var cats = counts[catField];
          var items = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; }).slice(0, 10).map(function (k) { return { label: k, value: cats[k] }; });
          chart = '<div class="agis-chart__title">Features by ' + esc(catField) + '</div>' + barChart(items);
        }
        self.queryLayer.getSource().clear();
        return kvTable(rows) + chart +
          '<p><a class="agis-btn agis-btn--dl" href="' + esc(join(wfs, params)) + '" target="_blank" rel="noopener">&#8615; Download these features (GeoJSON)</a>' +
          (feats.length ? ' <button type="button" class="agis-btn" data-act="highlight-last">Highlight on map</button>' : '') + '</p>';
      });
    });
  };

  AmconnectGIS.prototype.highlightLast = function () {
    if (!this.lastFeatures) { return; }
    var src = this.queryLayer.getSource(); src.clear(); src.addFeatures(this.lastFeatures);
  };

  // DescribeFeatureType (JSON) -> {geometry, attributes: [{name, type}]}, cached per type
  AmconnectGIS.prototype.describeFeatureType = function (wfs, typeName) {
    this.schemaCache = this.schemaCache || {};
    var key = wfs + '|' + typeName;
    if (this.schemaCache[key]) { return this.schemaCache[key]; }
    var p = fetch(join(wfs, 'service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=' + encodeURIComponent(typeName) + '&outputFormat=application/json'))
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('DescribeFeatureType ' + r.status)); })
      .then(function (json) {
        var ft = (json.featureTypes || [])[0] || { properties: [] };
        var geometry = null, attributes = [];
        ft.properties.forEach(function (p) {
          if (/^gml:/.test(p.type)) { geometry = geometry || p.name; }
          else { attributes.push({ name: p.name, type: /int|number|double|float|decimal|long|short/i.test(p.type) ? 'number' : (/date/i.test(p.type) ? 'date' : 'string') }); }
        });
        return { geometry: geometry, attributes: attributes };
      })
      .catch(function () { return { geometry: null, attributes: [] }; });
    this.schemaCache[key] = p;
    return p;
  };

  AmconnectGIS.prototype.setupQueryBuilder = function () {
    var box = q(this.root, '.agis-query');
    if (!box) { return; }
    var entry = this.analysisTarget();
    var wfs = entry && entry.def.services.wfs;
    box.hidden = !(wfs && entry.def.capabilities.query);
    if (box.hidden) { return Promise.resolve(null); }
    return this.describeFeatureType(wfs.endpoint, entry.def.layer_name).then(function (schema) {
      var sel = q(box, '[data-role="q-attr"]');
      var attrs = schema.attributes.slice().sort(function (a, b) { return (a.type === 'string' ? 0 : 1) - (b.type === 'string' ? 0 : 1); });
      sel.innerHTML = attrs.map(function (a) { return '<option value="' + esc(a.name) + '" data-type="' + a.type + '">' + esc(a.name) + ' (' + a.type + ')</option>'; }).join('');
      return schema;
    });
  };

  // q=attr:op:value in the URL hash runs a query on load (op as in OPERATORS, e.g. rock_class:=:Sedimentary)
  AmconnectGIS.prototype.queryFromHash = function () {
    var self = this, parts = (this.hashState.q || '').split(':');
    if (parts.length < 2) { return; }
    this.setupQueryBuilder().then(function (schema) {
      if (!schema) { return; }
      var box = q(self.root, '.agis-query');
      q(box, '[data-role="q-attr"]').value = parts[0];
      q(box, '[data-role="q-op"]').value = parts[1];
      q(box, '[data-role="q-value"]').value = parts.slice(2).join(':');
      q(box, '[data-role="q-in-view"]').checked = false;
      self.runQuery();
    });
  };

  AmconnectGIS.prototype.runQuery = function () {
    var self = this, entry = this.analysisTarget();
    if (!entry || !entry.def.services.wfs) { return; }
    var box = q(this.root, '.agis-query'), out = q(box, '.agis-query__result');
    var attrSel = q(box, '[data-role="q-attr"]'), attr = attrSel.value;
    var type = attrSel.selectedOptions[0] && attrSel.selectedOptions[0].getAttribute('data-type');
    var op = q(box, '[data-role="q-op"]').value, value = q(box, '[data-role="q-value"]').value.trim();
    if (!attr) { return; }
    var cql;
    if (op === 'IS NULL') { cql = attr + ' IS NULL'; }
    else if (op === 'LIKE') { cql = attr + " ILIKE '%" + value.replace(/'/g, "''") + "%'"; }
    else { cql = attr + ' ' + op + ' ' + (type === 'number' ? (Number(value) || 0) : "'" + value.replace(/'/g, "''") + "'"); }
    var wfs = entry.def.services.wfs.endpoint;
    this.lastQuery = attr + ':' + op + ':' + value;
    out.innerHTML = '<span class="agis-spinner"></span> Running <code>' + esc(cql) + '</code>';
    this.describeFeatureType(wfs, entry.def.layer_name).then(function (schema) {
      if (q(box, '[data-role="q-in-view"]').checked && schema.geometry) {
        var ext = self.map.getView().calculateExtent(self.map.getSize());
        cql += ' AND BBOX(' + schema.geometry + ', ' + ext.map(function (v) { return v.toFixed(1); }).join(', ') + ", 'EPSG:3857')";
      }
      var base = 'service=WFS&version=2.0.0&request=GetFeature&typeNames=' + encodeURIComponent(entry.def.layer_name) + '&CQL_FILTER=' + encodeURIComponent(cql);
      return fetch(join(wfs, base + '&outputFormat=application/json&srsName=EPSG:3857&count=500')).then(function (r) {
        if (!r.ok) { return r.text().then(function (t) { throw new Error('WFS ' + r.status + ': ' + t.replace(/<[^>]+>/g, ' ').trim().slice(0, 160)); }); }
        return r.json();
      }).then(function (json) {
        var feats = new ol.format.GeoJSON().readFeatures(json);
        var src = self.queryLayer.getSource(); src.clear(); src.addFeatures(feats);
        var total = json.totalFeatures != null ? json.totalFeatures : (json.numberMatched != null ? json.numberMatched : feats.length);
        var area = 0; feats.forEach(function (f) { var g = f.getGeometry(); if (g && /Polygon/.test(g.getType())) { area += ol.sphere.getArea(g, { projection: 'EPSG:3857' }); } });
        out.innerHTML = kvTable([['Matching features', fmt(total) + (feats.length < total ? ' (' + feats.length + ' drawn)' : '')], ['Area (km²)', fmt(area / 1e6)], ['Filter', '<code>' + esc(cql) + '</code>']]) +
          '<div class="agis-btnrow"><a class="agis-btn agis-btn--dl" href="' + esc(join(wfs, base + '&outputFormat=application/json')) + '" target="_blank" rel="noopener">&#8615; GeoJSON</a>' +
          '<a class="agis-btn agis-btn--dl" href="' + esc(join(wfs, base + '&outputFormat=SHAPE-ZIP')) + '" target="_blank" rel="noopener">&#8615; Shapefile</a>' +
          '<a class="agis-btn agis-btn--dl" href="' + esc(join(wfs, base + '&outputFormat=csv')) + '" target="_blank" rel="noopener">&#8615; CSV</a></div>';
        if (feats.length) { self.map.getView().fit(src.getExtent(), { padding: [40, 40, 40, 40], maxZoom: 12, duration: 300 }); }
        q(self.root, '.agis__toolbar [data-act="clear"]').hidden = false;
      });
    }).catch(function (e) { out.innerHTML = '<p class="agis-error">' + esc(e.message) + '</p>'; });
  };

  global.AmconnectGIS = AmconnectGIS;
})(window);
