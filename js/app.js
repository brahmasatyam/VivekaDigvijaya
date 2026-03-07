// ─── Vivekananda Travels — Cesium App ──────────────────────────────────────
// Loads phases.json + locations.json + pin_content.json and renders an interactive 3D globe.

'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let PHASES = [];
let LOCATIONS = [];
let PIN_CONTENT = {};   // id → { title, description: [...] }
let viewer = null;
let pinImages = {};            // phase-id → canvas pin image
let entities = {};             // loc.id → Cesium entity
let activePhases = new Set();  // which phases are visible
let routePolylines = {};       // phase-id → polyline entity
let selectedEntity = null;

// ── Bootstrap ──────────────────────────────────────────────────────────────
async function loadData() {
  // Use embedded data (window.PHASES_DATA / window.LOCATIONS_DATA / window.PIN_CONTENT_DATA)
  // when the app is opened directly as a file:// URL (no web server).
  // Fall back to fetch() when served from a proper HTTP server.
  if (window.PHASES_DATA && window.LOCATIONS_DATA) {
    PHASES = window.PHASES_DATA;
    LOCATIONS = window.LOCATIONS_DATA;
    if (window.PIN_CONTENT_DATA) {
      window.PIN_CONTENT_DATA.forEach(p => { PIN_CONTENT[p.id] = p; });
    }
    return;
  }
  // Fetch fallback (requires a web server)
  const [phData, locData, pcData] = await Promise.all([
    fetch('data/phases.json').then(r => r.json()),
    fetch('data/locations.json').then(r => r.json()),
    fetch('data/pin_content.json').then(r => r.json()).catch(() => [])
  ]);
  PHASES = phData;
  LOCATIONS = locData;
  pcData.forEach(p => { PIN_CONTENT[p.id] = p; });
}

async function init() {
  try {
    await loadData();
    buildLegend();
    await initCesium();
    buildTimeline();
    setupSearch();
    document.getElementById('loading-overlay').style.display = 'none';
  } catch (err) {
    console.error('Init error:', err);
    document.getElementById('loading-text').textContent = 'Error loading data. Please refresh.';
  }
}

// ── Legend ─────────────────────────────────────────────────────────────────
function buildLegend() {
  const legend = document.getElementById('phase-legend');
  legend.innerHTML = '';

  // "All" toggle
  const allBtn = document.createElement('div');
  allBtn.className = 'phase-item all-phases active';
  allBtn.innerHTML = `<span class="phase-dot" style="background:#f0c040"></span><span class="phase-label">All Phases</span>`;
  allBtn.dataset.phase = 'all';
  legend.appendChild(allBtn);

  PHASES.forEach(p => {
    const item = document.createElement('div');
    item.className = 'phase-item active';
    item.dataset.phase = p.id;
    item.innerHTML = `
      <span class="phase-dot" style="background:${p.color}"></span>
      <span class="phase-label">${p.name}</span>
      <span class="phase-years">${p.years}</span>`;
    legend.appendChild(item);
    activePhases.add(p.id);
  });

  legend.addEventListener('click', e => {
    const item = e.target.closest('.phase-item');
    if (!item) return;
    const phase = item.dataset.phase;
    if (phase === 'all') {
      const allActive = activePhases.size === PHASES.length;
      if (allActive) {
        activePhases.clear();
        document.querySelectorAll('.phase-item:not(.all-phases)').forEach(el => el.classList.remove('active'));
        item.classList.remove('active');
      } else {
        PHASES.forEach(p => activePhases.add(p.id));
        document.querySelectorAll('.phase-item').forEach(el => el.classList.add('active'));
      }
    } else {
      if (activePhases.has(phase)) {
        activePhases.delete(phase);
        item.classList.remove('active');
      } else {
        activePhases.add(phase);
        item.classList.add('active');
      }
      const allBtn2 = document.querySelector('.all-phases');
      allBtn2.classList.toggle('active', activePhases.size === PHASES.length);
    }
    applyVisibility();
  });
}

// ── Custom pin builder ──────────────────────────────────────────────────────
function lightenHex(hex, t) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const l = v => Math.min(255, Math.round(v + (255-v)*t));
  return `#${[r,g,b].map(v=>l(v).toString(16).padStart(2,'0')).join('')}`;
}

function darkenHex(hex, t) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const d = v => Math.max(0, Math.round(v * (1-t)));
  return `#${[r,g,b].map(v=>d(v).toString(16).padStart(2,'0')).join('')}`;
}

// Draws a teardrop map-pin onto an off-screen canvas and returns the canvas.
// displaySize = the pixel width Cesium will render the billboard at.
// The canvas is created at 2× for crispness on HiDPI screens.
function buildPinCanvas(color, displaySize) {
  const dpr = 2;
  const pw  = displaySize * dpr;           // canvas width in physical px
  const pad = 4 * dpr;                     // padding around shape
  const r   = pw / 2 - pad;               // circle radius
  const cx  = pw / 2;                      // horizontal centre
  const cy  = r + pad;                     // circle centre Y
  const dist = r * 1.55;                   // distance from circle centre to pin tip
  const pointY = cy + dist;               // Y coordinate of pin tip
  const ph  = Math.ceil(pointY + pad);    // canvas height

  const canvas = document.createElement('canvas');
  canvas.width  = pw;
  canvas.height = ph;
  const ctx = canvas.getContext('2d');

  // ── compute tangent angles so sides meet the circle cleanly ──────────────
  const halfAngle = Math.asin(r / dist);
  const startA    = Math.PI / 2 + halfAngle;   // lower-left tangent on circle
  const endA      = Math.PI / 2 - halfAngle;   // lower-right tangent on circle

  // ── drop shadow (drawn before fill so it sits under the shape) ───────────
  ctx.shadowColor   = 'rgba(0,0,0,0.52)';
  ctx.shadowBlur    = 7 * dpr;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2.5 * dpr;

  // ── pin body path ──
  ctx.beginPath();
  ctx.moveTo(cx, pointY);
  // arc clockwise from lower-left tangent, over the top, to lower-right tangent
  ctx.arc(cx, cy, r, startA, endA, false);
  ctx.closePath();   // line from right tangent back to pointY

  // ── radial gradient fill ──────────────────────────────────────────────────
  const gx = cx - r * 0.3, gy = cy - r * 0.3;   // highlight offset (upper-left)
  const grad = ctx.createRadialGradient(gx, gy, r * 0.05, cx, cy, r * 1.2);
  grad.addColorStop(0,   lightenHex(color, 0.6));
  grad.addColorStop(0.55, color);
  grad.addColorStop(1,   darkenHex(color, 0.25));
  ctx.fillStyle = grad;
  ctx.fill();

  // ── white border (disable shadow first) ──────────────────────────────────
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.lineWidth   = 2 * dpr;
  ctx.stroke();

  // ── inner white circle ────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.30, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();

  return canvas;
}

// ── Cesium ─────────────────────────────────────────────────────────────────
async function initCesium() {
  Cesium.Ion.defaultAccessToken = '';

  viewer = new Cesium.Viewer('cesiumContainer', {
    imageryProvider: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    skyAtmosphere: new Cesium.SkyAtmosphere(),
    skyBox: new Cesium.SkyBox({
      sources: {
        positiveX: 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_px.jpg',
        negativeX: 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_mx.jpg',
        positiveY: 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_py.jpg',
        negativeY: 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_ny.jpg',
        positiveZ: 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_pz.jpg',
        negativeZ: 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_mz.jpg'
      }
    })
  });

  // ── Satellite imagery (ArcGIS — no token) ──────────────────────────────
  viewer.imageryLayers.removeAll();
  const sat = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
  );
  viewer.imageryLayers.addImageryProvider(sat);

  // Labels layer on top
  const labels = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer'
  );
  const labLayer = viewer.imageryLayers.addImageryProvider(labels);
  labLayer.alpha = 0.7;

  // ── Camera ──────────────────────────────────────────────────────────────
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(78.0, 22.0, 14000000),
    duration: 0
  });

  // ── Build pin images (custom canvas — gradient + shadow) ────────────────
  PHASES.forEach(p => {
    pinImages[p.id]        = buildPinCanvas(p.color, 36).toDataURL();
    pinImages[p.id + '_ks']= buildPinCanvas(p.color, 46).toDataURL();
  });

  // ── Add location entities ───────────────────────────────────────────────
  LOCATIONS.forEach(loc => {
    const phase = PHASES.find(p => p.id === loc.phase);
    const color = phase ? phase.color : '#f0c040';
    const isKeystone = loc.significance && loc.significance.includes('—');

    const entity = viewer.entities.add({
      id: loc.id,
      position: Cesium.Cartesian3.fromDegrees(loc.lng, loc.lat),
      billboard: {
        image: isKeystone
          ? (pinImages[loc.phase + '_ks'] || pinImages[loc.phase])
          : (pinImages[loc.phase]          || pinImages[PHASES[0].id]),
        // width : display size; height preserves the pin's natural aspect ratio
        // (circle radius + 1.55×radius point distance + padding → ~1.75× width)
        width:  isKeystone ? 46 : 36,
        height: isKeystone ? 80 : 63,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        // No disableDepthTestDistance — let the globe's depth buffer occlude
        // pins that are on the far side of the Earth when rotated away.
        scaleByDistance: new Cesium.NearFarScalar(2e6, 1.0, 1e7, 0.55)
      },
      label: {
        text: loc.name,
        font: '11px "Google Sans", sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#0a0a1a'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -58),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        translucencyByDistance: new Cesium.NearFarScalar(1.5e6, 1.0, 8e6, 0.0),
        show: false  // shown only on hover
      },
      _locData: loc
    });

    entities[loc.id] = entity;
  });

  // ── Route polylines per phase ───────────────────────────────────────────
  PHASES.forEach(phase => {
    const phaseLocs = LOCATIONS.filter(l => l.phase === phase.id);
    if (phaseLocs.length < 2) return;

    const positions = phaseLocs.map(l => Cesium.Cartesian3.fromDegrees(l.lng, l.lat));
    const pl = viewer.entities.add({
      id: `route_${phase.id}`,
      polyline: {
        positions,
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString(phase.color).withAlpha(0.6),
          dashLength: 20,
          dashPattern: 255
        }),
        clampToGround: true,
        arcType: Cesium.ArcType.GEODESIC
      }
    });
    routePolylines[phase.id] = pl;
  });

  // ── Interaction ─────────────────────────────────────────────────────────
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  // Track whether the user is currently dragging (rotating the globe).
  // While dragging we suppress hover-label behaviour and hide all labels
  // so pins don't "stick" visible after the cursor swept across them.
  let isRotating = false;
  let mouseDownOnPin = false;

  function clearAllLabels() {
    Object.values(entities).forEach(e => { e.label.show = false; });
  }

  handler.setInputAction(movement => {
    // Record whether the press started on a pin (so a click still works)
    const picked = viewer.scene.pick(movement.position);
    mouseDownOnPin = Cesium.defined(picked) && picked.id && picked.id._locData;
    isRotating = false;           // reset — might become a drag
  }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

  handler.setInputAction(() => {
    if (isRotating) clearAllLabels();
    isRotating = false;
    mouseDownOnPin = false;
  }, Cesium.ScreenSpaceEventType.LEFT_UP);

  // Click → show info panel
  handler.setInputAction(movement => {
    if (isRotating) return;       // ignore synthetic click after a drag
    const picked = viewer.scene.pick(movement.position);
    if (Cesium.defined(picked) && picked.id && picked.id._locData) {
      showInfoPanel(picked.id._locData);
      if (selectedEntity) selectedEntity.billboard.scale = 1.0;
      selectedEntity = picked.id;
      selectedEntity.billboard.scale = 1.35;
    } else {
      closeInfoPanel();
      if (selectedEntity) selectedEntity.billboard.scale = 1.0;
      selectedEntity = null;
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // Hover → show label + cursor (suppressed while rotating)
  handler.setInputAction(movement => {
    // If the left button is held and the cursor moved, this is a rotation drag
    if (viewer.scene.canvas.matches(':active') ||
        (window._cesiumLeftDown)) {
      isRotating = true;
    }

    if (isRotating) {
      // Hide all labels and reset cursor during globe rotation
      clearAllLabels();
      viewer.scene.canvas.style.cursor = 'default';
      return;
    }

    const picked = viewer.scene.pick(movement.position);
    if (Cesium.defined(picked) && picked.id && picked.id._locData) {
      viewer.scene.canvas.style.cursor = 'pointer';
      picked.id.label.show = true;
    } else {
      viewer.scene.canvas.style.cursor = 'default';
      Object.values(entities).forEach(e => { if (e !== selectedEntity) e.label.show = false; });
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  // Track left-button state for the drag detection above
  viewer.scene.canvas.addEventListener('mousedown', e => { if (e.button === 0) window._cesiumLeftDown = true; });
  viewer.scene.canvas.addEventListener('mouseup',   e => { if (e.button === 0) { window._cesiumLeftDown = false; isRotating = false; } });
  viewer.scene.canvas.addEventListener('mouseleave', () => { clearAllLabels(); viewer.scene.canvas.style.cursor = 'default'; });

  setupZoomBar();
}

// ── Visibility ─────────────────────────────────────────────────────────────
function applyVisibility() {
  LOCATIONS.forEach(loc => {
    const ent = entities[loc.id];
    if (ent) ent.show = activePhases.has(loc.phase);
  });
  PHASES.forEach(p => {
    const pl = routePolylines[p.id];
    if (pl) pl.show = activePhases.has(p.id);
  });
}

// ── Info Panel ─────────────────────────────────────────────────────────────
function showInfoPanel(loc) {
  const phase = PHASES.find(p => p.id === loc.phase);
  const panel = document.getElementById('info-panel');
  const color = phase ? phase.color : '#f0c040';

  document.getElementById('info-phase-badge').textContent = phase ? `${phase.icon || ''} ${phase.name}` : '';
  document.getElementById('info-phase-badge').style.background = color + '33';
  document.getElementById('info-phase-badge').style.borderColor = color;
  document.getElementById('info-phase-badge').style.color = color;

  document.getElementById('info-title').textContent = loc.name;
  document.getElementById('info-place').textContent = [loc.place, loc.city, loc.country].filter(Boolean).join(', ');
  document.getElementById('info-date').textContent = loc.date || '';
  document.getElementById('info-sig').textContent = loc.significance || '';

  // Use rich multi-paragraph content from pin_content.json if available
  const descEl = document.getElementById('info-desc');
  const badgeEl = document.getElementById('info-rich-badge');
  const richContent = PIN_CONTENT[loc.id];
  if (richContent && richContent.description && richContent.description.length) {
    descEl.innerHTML = richContent.description
      .map(p => `<p class="info-desc-para">${p.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
      .join('');
    if (badgeEl) badgeEl.style.display = 'inline-block';
  } else {
    descEl.textContent = loc.desc || '';
    if (badgeEl) badgeEl.style.display = 'none';
  }

  panel.classList.add('open');

  // Fly to location
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(loc.lng, loc.lat, 1800000),
    duration: 1.8,
    easingFunction: Cesium.EasingFunction.CUBIC_OUT
  });

  // Highlight marker in list
  document.querySelectorAll('.loc-item').forEach(el => el.classList.remove('active'));
  const listItem = document.querySelector(`.loc-item[data-id="${loc.id}"]`);
  if (listItem) { listItem.classList.add('active'); listItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

function closeInfoPanel() {
  document.getElementById('info-panel').classList.remove('open');
  document.querySelectorAll('.loc-item').forEach(el => el.classList.remove('active'));
}

// ── Timeline / Location List ────────────────────────────────────────────────
function buildTimeline() {
  // Update header stat
  const statEl = document.getElementById('stat-locs');
  if (statEl) statEl.textContent = LOCATIONS.length;

  // Build phase description cards in the Phases tab
  const descContainer = document.getElementById('phase-desc-container');
  if (descContainer) {
    descContainer.innerHTML = '';
    PHASES.forEach(p => {
      const card = document.createElement('div');
      card.className = 'phase-desc-card';
      card.innerHTML = `
        <div class="phase-desc-header">
          <span class="phase-desc-icon">${p.icon || '📍'}</span>
          <span class="phase-desc-name" style="color:${p.color}">${p.name}</span>
          <span class="phase-desc-years">${p.years}</span>
        </div>
        <div class="phase-desc-text">${p.description}</div>`;
      descContainer.appendChild(card);
    });
  }

  const container = document.getElementById('location-list');
  container.innerHTML = '';

  PHASES.forEach(phase => {
    const phaseLocs = LOCATIONS.filter(l => l.phase === phase.id);
    if (!phaseLocs.length) return;

    const section = document.createElement('div');
    section.className = 'phase-section';
    section.dataset.phase = phase.id;

    section.innerHTML = `
      <div class="phase-header" style="border-left-color:${phase.color}">
        <span class="phase-icon">${phase.icon || '📍'}</span>
        <div>
          <div class="phase-title" style="color:${phase.color}">${phase.name}</div>
          <div class="phase-period">${phase.years} · ${phaseLocs.length} locations</div>
        </div>
      </div>`;

    phaseLocs.forEach(loc => {
      const item = document.createElement('div');
      item.className = 'loc-item';
      item.dataset.id = loc.id;
      item.dataset.phase = loc.phase;
      item.innerHTML = `
        <span class="loc-dot" style="background:${phase.color}"></span>
        <div class="loc-info">
          <div class="loc-name">${loc.name}</div>
          <div class="loc-meta">${loc.country}${loc.date ? ' · ' + loc.date.split(',')[0] : ''}</div>
        </div>`;
      item.addEventListener('click', () => showInfoPanel(loc));
      section.appendChild(item);
    });

    container.appendChild(section);
  });
}

// ── Search ─────────────────────────────────────────────────────────────────
function setupSearch() {
  const input = document.getElementById('search-input');
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    document.querySelectorAll('.loc-item').forEach(el => {
      const name = el.querySelector('.loc-name').textContent.toLowerCase();
      const meta = el.querySelector('.loc-meta').textContent.toLowerCase();
      el.style.display = (!q || name.includes(q) || meta.includes(q)) ? '' : 'none';
    });
    document.querySelectorAll('.phase-section').forEach(sec => {
      const visible = [...sec.querySelectorAll('.loc-item')].some(el => el.style.display !== 'none');
      sec.style.display = visible ? '' : 'none';
    });
  });
}

// ── Zoom Bar ───────────────────────────────────────────────────────────────
const ZOOM_MIN = 400;          // ~400 m — street level
const ZOOM_MAX = 20000000;     // 20,000 km — full globe

function altToSlider(alt) {
  const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, alt));
  const logMin = Math.log(ZOOM_MIN), logMax = Math.log(ZOOM_MAX);
  // slider 100 = zoomed in (min alt), slider 0 = zoomed out (max alt)
  return Math.round(100 * (1 - (Math.log(clamped) - logMin) / (logMax - logMin)));
}

function sliderToAlt(val) {
  const logMin = Math.log(ZOOM_MIN), logMax = Math.log(ZOOM_MAX);
  return Math.exp(logMin + (1 - val / 100) * (logMax - logMin));
}

function formatAlt(metres) {
  if (metres >= 1000000) return (metres / 1000000).toFixed(0) + ' Mm';
  if (metres >= 1000)    return (metres / 1000).toFixed(0) + ' km';
  return metres.toFixed(0) + ' m';
}

function setupZoomBar() {
  const slider  = document.getElementById('zoom-slider');
  const zoomIn  = document.getElementById('zoom-in-btn');
  const zoomOut = document.getElementById('zoom-out-btn');
  const label   = document.getElementById('zoom-label');

  function currentAlt() { return viewer.camera.positionCartographic.height; }

  function updateUI() {
    const alt = currentAlt();
    const v   = altToSlider(alt);
    slider.value = v;
    // update CSS custom property so the filled-track gradient follows the thumb
    slider.style.setProperty('--val', v);
    label.textContent = formatAlt(alt);
  }

  function flyToAlt(alt) {
    const pos = viewer.camera.positionCartographic;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(pos.longitude, pos.latitude,
                     Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, alt))),
      duration: 0.5,
      easingFunction: Cesium.EasingFunction.CUBIC_OUT
    });
  }

  // Keep slider in sync whenever camera position changes
  viewer.camera.changed.addEventListener(updateUI);

  // Slider drag → instant zoom (cancel any in-progress flyTo first)
  slider.addEventListener('input', () => {
    const alt = sliderToAlt(parseInt(slider.value, 10));
    const pos = viewer.camera.positionCartographic;
    viewer.camera.cancelFlight();
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromRadians(pos.longitude, pos.latitude, alt)
    });
    slider.style.setProperty('--val', slider.value);
    label.textContent = formatAlt(alt);
  });

  // + / − buttons (zoom by ×0.4 / ×2.5)
  zoomIn.addEventListener('click',  () => flyToAlt(currentAlt() * 0.4));
  zoomOut.addEventListener('click', () => flyToAlt(currentAlt() * 2.5));

  // Initialise
  updateUI();
}

// ── Fly home ───────────────────────────────────────────────────────────────
function flyHome() {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(78.0, 20.0, 14000000),
    duration: 2,
    easingFunction: Cesium.EasingFunction.CUBIC_OUT
  });
  closeInfoPanel();
  if (selectedEntity) selectedEntity.billboard.scale = 1.0;
  selectedEntity = null;
}

// ── Tab switching ───────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
}

// ── Start ───────────────────────────────────────────────────────────────────
window.addEventListener('load', init);
