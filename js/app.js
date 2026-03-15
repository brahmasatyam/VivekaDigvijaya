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
let activePhases    = new Set();  // which phases are visible
let activeCountries = new Set();  // which countries are visible
let routePolylines = {};       // phase-id → polyline entity
let selectedEntity = null;
let currentLocIndex = -1;      // index in LOCATIONS of the selected location
let isPlaying = false;
let playTimer = null;
let timelineYearStart = 1863;  // range slider — start year
let timelineYearEnd   = 1902;  // range slider — end year
let sidebarCollapsed = false;

// ── Phase-specific quotes ──────────────────────────────────────────────────
const PHASE_QUOTES = {
  p1: [
    "Take up one idea. Make that one idea your life — think of it, dream of it, live on that idea.",
    "You cannot believe in God until you believe in yourself.",
    "The greatest sin is to think yourself weak.",
    "In a day when you don't come across any problems, you can be sure that you are travelling in a wrong path.",
    "The fire that warms us can also consume us; it is not the fault of the fire.",
  ],
  p2: [
    "Sisters and Brothers of America — It fills my heart with joy unspeakable to rise in response to the warm and cordial welcome which you have given us.",
    "Each soul is potentially divine. The goal is to manifest this Divinity within.",
    "All the powers in the universe are already ours. It is we who have put our hands before our eyes and cry that it is dark.",
    "The moment I have realized God sitting in the temple of every human body — that moment I am free from bondage.",
    "It is our own mental attitude which makes the world what it is for us.",
  ],
  p3: [
    "Arise, awake and stop not till the goal is reached.",
    "Strength is life, weakness is death.",
    "The world is the great gymnasium where we come to make ourselves strong.",
    "See God in every person, place, and thing, and all will be well in your world.",
    "We are what our thoughts have made us; so take care about what you think.",
  ],
  p4: [
    "Do not wait for anybody or anything. Do whatever you can, build your hope on none.",
    "They alone live who live for others. The rest are more dead than alive.",
    "Whatever you think that you will be. If you think yourself weak, weak you will be; if you think yourself strong, strong you will be.",
    "That man has reached immortality who is disturbed by nothing material.",
    "Truth can be stated in a thousand different ways, yet each one can be true.",
  ],
  p5: [
    "My India, arise! Where is your vital force? In your Immortal Soul.",
    "Education is the manifestation of the perfection already in man.",
    "Purity, patience, and perseverance are the three essentials to success and, above all, love.",
    "Talk to yourself at least once in a day. Otherwise you may miss a meeting with an excellent person in this world.",
    "The secret of life is not enjoyment but education through experience.",
  ]
};

// ── Country flag emoji map ─────────────────────────────────────────────────
const COUNTRY_FLAGS = {
  'Canada':         '🇨🇦',
  'China':          '🇨🇳',
  'Egypt':          '🇪🇬',
  'England':        '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'France':         '🇫🇷',
  'Germany':        '🇩🇪',
  'India':          '🇮🇳',
  'Italy':          '🇮🇹',
  'Japan':          '🇯🇵',
  'Malaysia':       '🇲🇾',
  'Nepal':                 '🇳🇵',
  'Pre-Independence India':'🇮🇳',
  'Singapore':             '🇸🇬',
  'Sri Lanka':      '🇱🇰',
  'USA':            '🇺🇸',
  'United Kingdom': '🇬🇧'
};

// ── Helpers ────────────────────────────────────────────────────────────────
function extractYear(dateStr) {
  if (!dateStr) return null;
  const m = dateStr.match(/\b(1[89]\d\d)\b/);
  return m ? parseInt(m[1], 10) : null;
}

function getPhaseQuote(phaseId) {
  const pool = PHASE_QUOTES[phaseId] || PHASE_QUOTES.p1;
  return pool[Math.floor(Math.random() * pool.length)];
}

function wikiSearchUrl(loc) {
  const q = loc.name || loc.city;
  return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`;
}

// Returns LOCATIONS filtered by activePhases, activeCountries and year range (in original order)
function getFilteredLocations() {
  return LOCATIONS.filter(loc => {
    if (!activePhases.has(loc.phase)) return false;
    if (!activeCountries.has(loc.country)) return false;
    const yr = extractYear(loc.date);
    if (yr !== null && (yr < timelineYearStart || yr > timelineYearEnd)) return false;
    return true;
  });
}

// ── Data loading ────────────────────────────────────────────────────────────
async function loadData() {
  if (window.PHASES_DATA && window.LOCATIONS_DATA) {
    PHASES = window.PHASES_DATA;
    LOCATIONS = window.LOCATIONS_DATA;
    if (window.PIN_CONTENT_DATA) {
      window.PIN_CONTENT_DATA.forEach(p => { PIN_CONTENT[p.id] = p; });
    }
    return;
  }
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
    buildCountryList();
    await initCesium();
    buildTimeline();
    setupSearch();
    setupTimeline();
    setupKeyboard();
    document.getElementById('loading-overlay').style.display = 'none';
  } catch (err) {
    console.error('Init error:', err);
    document.getElementById('loading-text').textContent = 'Error loading data. Please refresh.';
  }
}

// ── Legend ──────────────────────────────────────────────────────────────────
function buildLegend() {
  const legend = document.getElementById('phase-legend');
  legend.innerHTML = '';

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

// ── Fly to a single location, centred in the visible area ───────────────────
// The sidebar (left) and info panel (right) are CSS overlays on top of the
// full-width canvas.  The pin would land at the canvas centre, which is offset
// from the visual centre between the two panels.  We shift the fly-to
// destination by the equivalent longitude offset so the pin sits at the
// centre of what the user can actually see.
function flyToLocationCentered(loc) {
  const altitude = 1400000;   // ~1 400 km — city-region zoom, pin clearly visible
  if (!viewer) return;

  const canvas  = viewer.scene.canvas;
  const canvasW = canvas.clientWidth;
  const canvasH = canvas.clientHeight;

  // Measure overlay widths from the live DOM
  const sidebarEl = document.getElementById('sidebar');
  const sidebarW  = (sidebarEl && !sidebarCollapsed) ? sidebarEl.offsetWidth : 0;
  const INFO_PANEL_W = 360;   // matches CSS --info-w

  // Pixel distance between visible-area centre and canvas centre
  // positive = visible centre is to the RIGHT of canvas centre
  const visibleCX = sidebarW + (canvasW - sidebarW - INFO_PANEL_W) / 2;
  const dxPx      = visibleCX - canvasW / 2;

  // Convert pixel offset → longitude degrees at the target altitude & latitude
  // viewer.camera.frustum.fov is the vertical FOV in radians
  const vFov   = (viewer.camera.frustum && viewer.camera.frustum.fov)
                   ? viewer.camera.frustum.fov
                   : Cesium.Math.toRadians(60);
  const aspect = canvasW / canvasH;
  const hFov   = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const spanM  = 2 * altitude * Math.tan(hFov / 2);   // total world width in metres
  // Negate: camera must move in the OPPOSITE direction to the visible-centre offset
  // e.g. visible centre left of canvas centre → camera flies right of the pin
  const dxM    = -(dxPx / canvasW) * spanM;
  const dLng   = dxM / (111320 * Math.cos(Cesium.Math.toRadians(loc.lat)));

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(loc.lng + dLng, loc.lat, altitude),
    duration: 1.8,
    easingFunction: Cesium.EasingFunction.CUBIC_OUT
  });
}

// ── Fly to a set of locations ────────────────────────────────────────────────
function flyToBounds(locs, duration) {
  if (!locs || !locs.length) return;
  duration = (duration !== undefined) ? duration : 1.5;

  let minLat =  Infinity, maxLat = -Infinity;
  let minLng =  Infinity, maxLng = -Infinity;
  locs.forEach(loc => {
    minLat = Math.min(minLat, loc.lat);
    maxLat = Math.max(maxLat, loc.lat);
    minLng = Math.min(minLng, loc.lng);
    maxLng = Math.max(maxLng, loc.lng);
  });

  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  const span      = Math.max(maxLat - minLat, maxLng - minLng, 1.5);

  // ~111 km per degree; multiply by padding factor; clamp to sane range
  const altitude  = Math.max(600000, Math.min(14000000, span * 111000 * 2.8));

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(centerLng, centerLat, altitude),
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_OUT
  });
}

// ── Country list ─────────────────────────────────────────────────────────────
function buildCountryList() {
  // Count locations per country and collect unique countries
  const countMap = {};
  LOCATIONS.forEach(loc => {
    const c = loc.country || 'Unknown';
    countMap[c] = (countMap[c] || 0) + 1;
  });
  const countries = Object.keys(countMap).sort();

  // Initialise all countries as active
  countries.forEach(c => activeCountries.add(c));

  // Update header stat
  const statEl = document.getElementById('stat-countries');
  if (statEl) statEl.textContent = countries.length;

  const list = document.getElementById('country-list');
  list.innerHTML = '';

  // "All Countries" toggle
  const allBtn = document.createElement('div');
  allBtn.className = 'country-item all-countries active';
  allBtn.dataset.country = 'all';
  allBtn.innerHTML = `
    <span class="country-flag">🌐</span>
    <span class="country-name">All Countries</span>
    <span class="country-count">${LOCATIONS.length}</span>`;
  list.appendChild(allBtn);

  // Individual country rows
  countries.forEach(c => {
    const item = document.createElement('div');
    item.className = 'country-item active';
    item.dataset.country = c;
    const flag = COUNTRY_FLAGS[c] || '📍';
    item.innerHTML = `
      <span class="country-flag">${flag}</span>
      <span class="country-name">${c}</span>
      <span class="country-count">${countMap[c]}</span>`;
    list.appendChild(item);
  });

  // Click handler
  list.addEventListener('click', e => {
    const item = e.target.closest('.country-item');
    if (!item) return;
    const country = item.dataset.country;

    if (country === 'all') {
      const allActive = activeCountries.size === countries.length;
      if (allActive) {
        activeCountries.clear();
        document.querySelectorAll('.country-item:not(.all-countries)').forEach(el => el.classList.remove('active'));
        item.classList.remove('active');
      } else {
        countries.forEach(c => activeCountries.add(c));
        document.querySelectorAll('.country-item').forEach(el => el.classList.add('active'));
      }
      applyVisibility();
      // Fly to all currently visible pins if any remain
      const visible = getFilteredLocations();
      if (visible.length) flyToBounds(visible, 1.8);

    } else {
      const wasActive = activeCountries.has(country);
      if (wasActive) {
        activeCountries.delete(country);
        item.classList.remove('active');
      } else {
        activeCountries.add(country);
        item.classList.add('active');
      }
      const allBtn2 = list.querySelector('.all-countries');
      if (allBtn2) allBtn2.classList.toggle('active', activeCountries.size === countries.length);

      applyVisibility();

      if (!wasActive) {
        // Country just selected — fly to all its locations on the globe
        const countryLocs = LOCATIONS.filter(l => l.country === country);
        if (countryLocs.length) flyToBounds(countryLocs, 1.5);
      } else {
        // Country deselected — fly to remaining visible pins, or stay if none
        const visible = getFilteredLocations();
        if (visible.length) flyToBounds(visible, 1.5);
      }
    }
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

// ── Phase image loading ──────────────────────────────────────────────────────
// Tries to load data/images/phase_<id>.jpg then .png; resolves null on failure
function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function loadPhaseImages() {
  const phaseImgEls = {};

  // Prefer pre-built base64 data from phase_images.js (generated by
  // build_phase_images.py). Data URLs are same-origin so they never taint
  // the canvas — this works correctly in file:// mode.
  if (window.PHASE_IMAGES_DATA && Object.keys(window.PHASE_IMAGES_DATA).length) {
    await Promise.all(PHASES.map(async p => {
      const src = window.PHASE_IMAGES_DATA[p.id];
      if (src) {
        const img = await loadImage(src);
        if (img) phaseImgEls[p.id] = img;
      }
    }));
    return phaseImgEls;
  }

  // Fallback: load directly when served via http/https (no canvas taint risk).
  // Skip on file:// protocol — new Image() with local paths taints the canvas
  // in Safari/Firefox, breaking toDataURL().
  if (window.location.protocol === 'file:') return {};
  await Promise.all(PHASES.map(async p => {
    const base = 'data/images/phase_' + p.id;
    let img = await loadImage(base + '.jpg');
    if (!img) img = await loadImage(base + '.png');
    if (!img) img = await loadImage(base + '.jpeg');
    if (img) phaseImgEls[p.id] = img;
  }));
  return phaseImgEls;
}

function buildPinCanvas(color, displaySize, headImg, selected) {
  const dpr  = 2;
  const pw   = displaySize * dpr;           // canvas width = rectangle width
  const rh   = Math.round(pw * 0.82);       // rectangle height
  const cr   = Math.round(pw * 0.16);       // top corner radius
  const tw   = Math.round(pw * 0.30);       // tail base width
  const th   = Math.round(pw * 0.28);       // tail height
  const vpad = Math.round(3 * dpr);         // top & bottom padding (shadow room)
  const ch   = vpad + rh + th + vpad;       // total canvas height

  const canvas = document.createElement('canvas');
  canvas.width  = pw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');

  // Key coordinates
  const lx  = 0,        rx  = pw;          // left / right of rectangle
  const ty  = vpad,     by  = vpad + rh;   // top / bottom of rectangle
  const mx  = pw / 2;                       // horizontal centre
  const tip = vpad + rh + th;              // y of pointer tip

  // ── Drop shadow ────────────────────────────────────────────────────────────
  ctx.shadowColor   = 'rgba(0,0,0,0.52)';
  ctx.shadowBlur    = 5 * dpr;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2 * dpr;

  // ── Flag / shield shape ───────────────────────────────────────────────────
  //   ┌──────────┐
  //   │          │   ← rounded top corners
  //   └───┬──────┘   ← flat bottom with centre pointer
  //       ▼
  ctx.beginPath();
  ctx.moveTo(lx + cr, ty);                  // top-left arc start
  ctx.lineTo(rx - cr, ty);                  // top edge
  ctx.arcTo(rx, ty,  rx, ty + cr, cr);      // top-right corner
  ctx.lineTo(rx, by);                       // right edge
  ctx.lineTo(mx + tw / 2, by);             // bottom-right → notch start
  ctx.lineTo(mx, tip);                      // right diagonal → pointer tip
  ctx.lineTo(mx - tw / 2, by);             // left diagonal back up
  ctx.lineTo(lx, by);                       // bottom-left from notch
  ctx.lineTo(lx, ty + cr);                  // left edge
  ctx.arcTo(lx, ty, lx + cr, ty, cr);      // top-left corner
  ctx.closePath();

  // Phase-colour gradient fill
  const grad = ctx.createLinearGradient(0, ty, 0, by);
  grad.addColorStop(0, lightenHex(color, 0.42));
  grad.addColorStop(1, darkenHex(color, 0.22));
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.shadowColor = 'transparent';

  // Outer stroke — only drawn when selected (gold highlight), removed otherwise
  if (selected) {
    ctx.strokeStyle = '#f0c040';
    ctx.lineWidth   = 3 * dpr;
    ctx.stroke();
  }

  if (headImg) {
    // ── Photo clipped to the rectangle (inset by border width) ──────────────
    const brd  = Math.round(2.5 * dpr);    // frame border width
    const ilx  = lx + brd,  irx = rx - brd;
    const ity  = ty + brd,  iby = by;      // no bottom inset — image to tail edge
    const icr  = Math.max(cr - brd, 2);
    const imgW = irx - ilx,  imgH = iby - ity;

    // Clip to inner rounded-top rectangle
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ilx + icr, ity);
    ctx.lineTo(irx - icr, ity);
    ctx.arcTo(irx, ity, irx, ity + icr, icr);
    ctx.lineTo(irx, iby);
    ctx.lineTo(ilx, iby);
    ctx.lineTo(ilx, ity + icr);
    ctx.arcTo(ilx, ity, ilx + icr, ity, icr);
    ctx.closePath();
    ctx.clip();

    // Cover-fit image — biased toward top (vFocus=0.1) so portrait faces show
    const iw    = headImg.naturalWidth  || headImg.width;
    const ih    = headImg.naturalHeight || headImg.height;
    const scale = Math.max(imgW / iw, imgH / ih);
    const dw    = iw * scale,  dh = ih * scale;
    const vFocus = 0.1;   // 0 = top-aligned, 0.5 = centred, 1 = bottom-aligned
    ctx.drawImage(headImg, ilx + (imgW - dw) / 2, ity + (imgH - dh) * vFocus, dw, dh);

    // Subtle dark gradient overlay at bottom of photo
    const ovG = ctx.createLinearGradient(0, iby - imgH * 0.38, 0, iby);
    ovG.addColorStop(0, 'rgba(0,0,0,0)');
    ovG.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = ovG;
    ctx.fillRect(ilx, iby - imgH * 0.38, imgW, imgH * 0.38);

    ctx.restore();

    // Inner border frame — gold when selected, phase colour otherwise
    ctx.beginPath();
    ctx.moveTo(ilx + icr, ity);
    ctx.lineTo(irx - icr, ity);
    ctx.arcTo(irx, ity, irx, ity + icr, icr);
    ctx.lineTo(irx, iby);
    ctx.lineTo(ilx, iby);
    ctx.lineTo(ilx, ity + icr);
    ctx.arcTo(ilx, ity, ilx + icr, ity, icr);
    ctx.closePath();
    ctx.strokeStyle = selected ? '#f0c040' : color;
    ctx.lineWidth   = selected ? brd * 1.4 : brd;
    ctx.stroke();
  }

  return canvas;
}

// ── Cesium ──────────────────────────────────────────────────────────────────
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

  // ── Satellite imagery ────────────────────────────────────────────────────
  viewer.imageryLayers.removeAll();
  const sat = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
  );
  viewer.imageryLayers.addImageryProvider(sat);

  const labels = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer'
  );
  const labLayer = viewer.imageryLayers.addImageryProvider(labels);
  labLayer.alpha = 0.7;

  // ── Lighting ─────────────────────────────────────────────────────────────
  viewer.scene.globe.enableLighting = false;

  // ── Camera ────────────────────────────────────────────────────────────────
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(78.0, 22.0, 14000000),
    duration: 0
  });

  // ── Build pin images ──────────────────────────────────────────────────────
  // Load optional per-phase photos from data/images/phase_<id>.jpg|png
  const phaseImgEls = await loadPhaseImages();

  PHASES.forEach(p => {
    const img = phaseImgEls[p.id] || null;
    // Normal & keystone variants
    pinImages[p.id]              = buildPinCanvas(p.color, 42, img, false).toDataURL();
    pinImages[p.id + '_ks']      = buildPinCanvas(p.color, 54, img, false).toDataURL();
    // Selected variants: same image but gold border
    pinImages[p.id + '_sel']     = buildPinCanvas(p.color, 42, img, true).toDataURL();
    pinImages[p.id + '_ks_sel']  = buildPinCanvas(p.color, 54, img, true).toDataURL();
  });

  // ── Add location entities ─────────────────────────────────────────────────
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
        width:  isKeystone ? 54 : 42,
        height: isKeystone ? 66 : 53,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
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
        show: false
      },
      _locData: loc
    });

    entities[loc.id] = entity;
  });

  // ── Interaction ───────────────────────────────────────────────────────────
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  let isRotating = false;
  let mouseDownOnPin = false;

  function clearAllLabels() {
    Object.values(entities).forEach(e => { e.label.show = false; });
  }

  handler.setInputAction(movement => {
    const picked = viewer.scene.pick(movement.position);
    mouseDownOnPin = Cesium.defined(picked) && picked.id && picked.id._locData;
    isRotating = false;
  }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

  handler.setInputAction(() => {
    if (isRotating) clearAllLabels();
    isRotating = false;
    mouseDownOnPin = false;
  }, Cesium.ScreenSpaceEventType.LEFT_UP);

  handler.setInputAction(movement => {
    if (isRotating) return;
    const picked = viewer.scene.pick(movement.position);
    if (Cesium.defined(picked) && picked.id && picked.id._locData) {
      showInfoPanel(picked.id._locData);
      deselectPin(selectedEntity);
      selectedEntity = picked.id;
      selectPin(selectedEntity);
    } else {
      deselectPin(selectedEntity);
      selectedEntity = null;
      closeInfoPanel();
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction(movement => {
    if (viewer.scene.canvas.matches(':active') || window._cesiumLeftDown) {
      isRotating = true;
    }
    if (isRotating) {
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

  viewer.scene.canvas.addEventListener('mousedown', e => { if (e.button === 0) window._cesiumLeftDown = true; });
  viewer.scene.canvas.addEventListener('mouseup',   e => { if (e.button === 0) { window._cesiumLeftDown = false; isRotating = false; } });
  viewer.scene.canvas.addEventListener('mouseleave', () => { clearAllLabels(); viewer.scene.canvas.style.cursor = 'default'; });

  setupZoomBar();
}

// ── Pin selection helpers ───────────────────────────────────────────────────
function selectPin(entity) {
  if (!entity) return;
  const loc = entity._locData;
  const big = loc && loc.significance && loc.significance.includes('—');
  // Swap to gold-border variant of the same pin — keeps the photo, adds highlight
  entity.billboard.image = big
    ? (pinImages[loc.phase + '_ks_sel'] || pinImages[loc.phase + '_sel'] || pinImages[loc.phase + '_ks'])
    : (pinImages[loc.phase + '_sel']    || pinImages[loc.phase]);
  entity.billboard.scale = 1.25;
}

function deselectPin(entity) {
  if (!entity) return;
  const loc = entity._locData;
  if (!loc) return;
  const big = loc.significance && loc.significance.includes('—');
  entity.billboard.image = big
    ? (pinImages[loc.phase + '_ks'] || pinImages[loc.phase])
    : (pinImages[loc.phase]          || pinImages[PHASES[0].id]);
  entity.billboard.scale = 1.0;
}

// ── Visibility ──────────────────────────────────────────────────────────────
function applyVisibility() {
  LOCATIONS.forEach(loc => {
    const ent = entities[loc.id];
    if (!ent) return;
    const isSelected = selectedEntity && ent === selectedEntity;
    const phaseOn    = activePhases.has(loc.phase);
    const countryOn  = activeCountries.has(loc.country);
    const yr         = extractYear(loc.date);
    const yearOn     = (yr === null) || (yr >= timelineYearStart && yr <= timelineYearEnd);
    // Always show the currently selected pin even if its filters are off
    ent.show = isSelected || (phaseOn && countryOn && yearOn);
  });
  PHASES.forEach(p => {
    const pl = routePolylines[p.id];
    if (pl) pl.show = activePhases.has(p.id);
  });
}

// ── Info Panel ──────────────────────────────────────────────────────────────
function showInfoPanel(loc) {
  const phase = PHASES.find(p => p.id === loc.phase);
  const panel = document.getElementById('info-panel');
  const color = phase ? phase.color : '#f0c040';

  // Header
  document.getElementById('info-phase-badge').textContent = phase ? `${phase.icon || ''} ${phase.name}` : '';
  document.getElementById('info-phase-badge').style.background = color + '33';
  document.getElementById('info-phase-badge').style.borderColor = color;
  document.getElementById('info-phase-badge').style.color = color;
  document.getElementById('info-title').textContent = loc.name;
  document.getElementById('info-place').textContent = [loc.place, loc.city, loc.country].filter(Boolean).join(', ');
  document.getElementById('info-date').textContent = loc.date || '';

  // Significance
  document.getElementById('info-sig').textContent = loc.significance || '';

  // Quote — random quote from this phase
  const quoteEl = document.getElementById('info-quote-text');
  if (quoteEl) quoteEl.textContent = getPhaseQuote(loc.phase);

  // Rich description
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

  // Wikipedia link
  const wikiLink = document.getElementById('info-wiki-link');
  if (wikiLink) {
    wikiLink.href = wikiSearchUrl(loc);
  }

  // Location image
  const imgWrap = document.getElementById('info-image-wrap');
  const imgEl   = document.getElementById('info-image');
  const imgCap  = document.getElementById('info-image-caption');
  const rawImg  = loc.image || (PIN_CONTENT[loc.id] && PIN_CONTENT[loc.id].image) || null;
  // Plain filenames resolve to data/images/; full URLs are used as-is
  const imgSrc  = rawImg
    ? (rawImg.startsWith('http://') || rawImg.startsWith('https://') || rawImg.startsWith('data:')
        ? rawImg
        : 'data/images/' + rawImg)
    : null;
  if (imgWrap && imgEl) {
    if (imgSrc) {
      imgEl.src = imgSrc;
      imgEl.alt = loc.name;
      imgEl.onerror = () => { imgWrap.style.display = 'none'; };
      if (imgCap) imgCap.textContent = loc.city ? loc.name + ' · ' + loc.city : loc.name;
      imgWrap.style.display = 'block';
    } else {
      imgWrap.style.display = 'none';
    }
  }

  // Navigation counter
  currentLocIndex = LOCATIONS.indexOf(loc);
  updateNavCounter();

  panel.classList.add('open');

  // Fly so the pin sits at the centre of the visible area (between sidebar & info panel)
  flyToLocationCentered(loc);

  // Highlight in sidebar
  document.querySelectorAll('.loc-item').forEach(el => el.classList.remove('active'));
  const listItem = document.querySelector(`.loc-item[data-id="${loc.id}"]`);
  if (listItem) { listItem.classList.add('active'); listItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

function closeInfoPanel() {
  document.getElementById('info-panel').classList.remove('open');
  document.querySelectorAll('.loc-item').forEach(el => el.classList.remove('active'));
  // Re-apply filters now that no pin is forced visible
  applyVisibility();
}

function updateNavCounter() {
  const filtered = getFilteredLocations();
  const pos = filtered.findIndex(l => l === LOCATIONS[currentLocIndex]);
  const counter = document.getElementById('info-counter');
  if (counter) {
    counter.textContent = pos >= 0
      ? `${pos + 1} / ${filtered.length}`
      : `— / ${filtered.length}`;
  }
}

// ── Prev / Next navigation ──────────────────────────────────────────────────
function goPrev() {
  const filtered = getFilteredLocations();
  if (!filtered.length) return;
  const pos = filtered.findIndex(l => l === LOCATIONS[currentLocIndex]);
  const newIdx = pos <= 0 ? filtered.length - 1 : pos - 1;
  const loc = filtered[newIdx];
  deselectPin(selectedEntity);
  selectedEntity = entities[loc.id] || null;
  selectPin(selectedEntity);
  showInfoPanel(loc);
}

function goNext() {
  const filtered = getFilteredLocations();
  if (!filtered.length) return;
  const pos = filtered.findIndex(l => l === LOCATIONS[currentLocIndex]);
  const newIdx = (pos < 0 || pos >= filtered.length - 1) ? 0 : pos + 1;
  const loc = filtered[newIdx];
  deselectPin(selectedEntity);
  selectedEntity = entities[loc.id] || null;
  selectPin(selectedEntity);
  showInfoPanel(loc);
}

// ── Play Journey ────────────────────────────────────────────────────────────
function startPlay() {
  if (isPlaying) { stopPlay(); return; }
  const filtered = getFilteredLocations();
  if (!filtered.length) return;

  isPlaying = true;
  updatePlayButton();

  // Start from current location or beginning
  const pos = filtered.findIndex(l => l === LOCATIONS[currentLocIndex]);
  const startIdx = pos >= 0 ? pos : 0;
  playStep(startIdx, filtered);
}

function stopPlay() {
  isPlaying = false;
  if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  updatePlayButton();
}

function playStep(idx, filtered) {
  if (!isPlaying) return;
  if (!filtered || idx >= filtered.length) {
    stopPlay();
    return;
  }

  const loc = filtered[idx];
  deselectPin(selectedEntity);
  selectedEntity = entities[loc.id] || null;
  selectPin(selectedEntity);
  showInfoPanel(loc);

  // Fly takes 1.8s, then dwell 3s at the location
  playTimer = setTimeout(() => {
    if (!isPlaying) return;
    playStep(idx + 1, filtered);
  }, 5000);
}

function updatePlayButton() {
  const btn = document.getElementById('play-btn');
  if (!btn) return;
  btn.textContent = isPlaying ? '⏹ Stop Journey' : '▶ Play Journey';
  btn.classList.toggle('playing', isPlaying);
}

// ── Timeline year range scrubber ────────────────────────────────────────────
function setupTimeline() {
  const sliderStart   = document.getElementById('year-slider-start');
  const sliderEnd     = document.getElementById('year-slider-end');
  const display       = document.getElementById('year-display');
  const resetBtn      = document.getElementById('tl-reset-btn');
  const rangeFill     = document.getElementById('tl-range-fill');
  if (!sliderStart || !sliderEnd) return;

  // Build phase tick marks on the timeline
  const tickContainer = document.getElementById('tl-ticks');
  if (tickContainer) {
    PHASES.forEach(p => {
      const m = p.years.match(/(\d{4})/);
      if (!m) return;
      const yr = parseInt(m[1], 10);
      const pct = ((yr - 1863) / (1902 - 1863)) * 100;
      const tick = document.createElement('div');
      tick.className = 'tl-tick';
      tick.style.left = `${pct}%`;
      tick.style.background = p.color;
      tick.title = `${p.name} (${p.years})`;
      tickContainer.appendChild(tick);
    });
  }

  function updateFill(s, e) {
    if (!rangeFill) return;
    const pctL = ((s - 1863) / (1902 - 1863)) * 100;
    const pctR = ((e - 1863) / (1902 - 1863)) * 100;
    rangeFill.style.left  = pctL + '%';
    rangeFill.style.width = (pctR - pctL) + '%';
  }

  function applyRange(s, e) {
    timelineYearStart = s;
    timelineYearEnd   = e;
    const allYears = (s === 1863 && e === 1902);
    if (display) display.textContent = allYears ? 'All Years' : `${s} – ${e}`;
    updateFill(s, e);
    applyVisibility();
  }

  sliderStart.addEventListener('input', () => {
    let s = parseInt(sliderStart.value, 10);
    const e = parseInt(sliderEnd.value, 10);
    if (s > e) { s = e; sliderStart.value = s; }
    applyRange(s, e);
  });

  sliderEnd.addEventListener('input', () => {
    const s = parseInt(sliderStart.value, 10);
    let e = parseInt(sliderEnd.value, 10);
    if (e < s) { e = s; sliderEnd.value = e; }
    applyRange(s, e);
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      sliderStart.value = 1863;
      sliderEnd.value   = 1902;
      applyRange(1863, 1902);
    });
  }

  // Init
  applyRange(1863, 1902);
}

// ── Sidebar collapse ────────────────────────────────────────────────────────
function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle');
  sidebar.classList.toggle('collapsed', sidebarCollapsed);
  if (toggleBtn) toggleBtn.textContent = sidebarCollapsed ? '▶' : '◀';
}

// ── Keyboard navigation ────────────────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    // Don't fire when typing in search box
    if (e.target.tagName === 'INPUT') return;

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        goNext();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        goPrev();
        break;
      case 'Escape':
        if (isPlaying) { stopPlay(); }
        else { deselectPin(selectedEntity); selectedEntity = null; closeInfoPanel(); }
        break;
      case ' ':
        e.preventDefault();
        startPlay();
        break;
    }
  });
}

// ── Location list & phase descriptions ─────────────────────────────────────
function buildTimeline() {
  const statEl = document.getElementById('stat-locs');
  if (statEl) statEl.textContent = LOCATIONS.length;

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
      item.addEventListener('click', () => {
        deselectPin(selectedEntity);
        selectedEntity = entities[loc.id] || null;
        selectPin(selectedEntity);
        showInfoPanel(loc);
      });
      section.appendChild(item);
    });

    container.appendChild(section);
  });
}

// ── Search ──────────────────────────────────────────────────────────────────
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

// ── Zoom Bar ────────────────────────────────────────────────────────────────
const ZOOM_MIN = 400;
const ZOOM_MAX = 20000000;

function altToSlider(alt) {
  const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, alt));
  const logMin = Math.log(ZOOM_MIN), logMax = Math.log(ZOOM_MAX);
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

  viewer.camera.changed.addEventListener(updateUI);

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

  zoomIn.addEventListener('click',  () => flyToAlt(currentAlt() * 0.4));
  zoomOut.addEventListener('click', () => flyToAlt(currentAlt() * 2.5));

  updateUI();
}

// ── Fly home ────────────────────────────────────────────────────────────────
function flyHome() {
  stopPlay();
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(78.0, 20.0, 14000000),
    duration: 2,
    easingFunction: Cesium.EasingFunction.CUBIC_OUT
  });
  deselectPin(selectedEntity);
  selectedEntity = null;
  closeInfoPanel();
}

// ── Tab switching ────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
}

// ── Start ────────────────────────────────────────────────────────────────────
window.addEventListener('load', init);
