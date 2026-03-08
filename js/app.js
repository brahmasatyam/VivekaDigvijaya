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
let currentLocIndex = -1;      // index in LOCATIONS of the selected location
let isPlaying = false;
let playTimer = null;
let timelineYear = 1902;       // show locations up to this year (1902 = all)
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

// Returns LOCATIONS filtered by activePhases and timelineYear (in original order)
function getFilteredLocations() {
  return LOCATIONS.filter(loc => {
    if (!activePhases.has(loc.phase)) return false;
    const yr = extractYear(loc.date);
    if (yr !== null && yr > timelineYear) return false;
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

function buildPinCanvas(color, displaySize) {
  const dpr = 2;
  const pw  = displaySize * dpr;
  const pad = 4 * dpr;
  const r   = pw / 2 - pad;
  const cx  = pw / 2;
  const cy  = r + pad;
  const dist = r * 1.55;
  const pointY = cy + dist;
  const ph  = Math.ceil(pointY + pad);

  const canvas = document.createElement('canvas');
  canvas.width  = pw;
  canvas.height = ph;
  const ctx = canvas.getContext('2d');

  const halfAngle = Math.asin(r / dist);
  const startA    = Math.PI / 2 + halfAngle;
  const endA      = Math.PI / 2 - halfAngle;

  ctx.shadowColor   = 'rgba(0,0,0,0.52)';
  ctx.shadowBlur    = 7 * dpr;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2.5 * dpr;

  ctx.beginPath();
  ctx.moveTo(cx, pointY);
  ctx.arc(cx, cy, r, startA, endA, false);
  ctx.closePath();

  const gx = cx - r * 0.3, gy = cy - r * 0.3;
  const grad = ctx.createRadialGradient(gx, gy, r * 0.05, cx, cy, r * 1.2);
  grad.addColorStop(0,   lightenHex(color, 0.6));
  grad.addColorStop(0.55, color);
  grad.addColorStop(1,   darkenHex(color, 0.25));
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.lineWidth   = 2 * dpr;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.30, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();

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

  // ── Day / night sun lighting ─────────────────────────────────────────────
  viewer.scene.globe.enableLighting = true;
  // Fix clock to a realistic daytime so India is illuminated
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date('2024-01-15T06:00:00Z'));
  viewer.clock.shouldAnimate = false;

  // ── Camera ────────────────────────────────────────────────────────────────
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(78.0, 22.0, 14000000),
    duration: 0
  });

  // ── Build pin images ──────────────────────────────────────────────────────
  PHASES.forEach(p => {
    pinImages[p.id]        = buildPinCanvas(p.color, 36).toDataURL();
    pinImages[p.id + '_ks']= buildPinCanvas(p.color, 46).toDataURL();
  });
  // Selected-state pins: white body so they stand out from every phase colour
  pinImages['selected_sm'] = buildPinCanvas('#ffffff', 44).toDataURL();
  pinImages['selected_lg'] = buildPinCanvas('#ffffff', 56).toDataURL();

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
        width:  isKeystone ? 46 : 36,
        height: isKeystone ? 80 : 63,
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
      closeInfoPanel();
      deselectPin(selectedEntity);
      selectedEntity = null;
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
  entity.billboard.image = big ? pinImages['selected_lg'] : pinImages['selected_sm'];
  entity.billboard.scale = 1.6;
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
    const phaseOn = activePhases.has(loc.phase);
    const yr = extractYear(loc.date);
    const yearOn = (yr === null) || (yr <= timelineYear);
    ent.show = phaseOn && yearOn;
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

  // Fly to location
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(loc.lng, loc.lat, 1800000),
    duration: 1.8,
    easingFunction: Cesium.EasingFunction.CUBIC_OUT
  });

  // Highlight in sidebar
  document.querySelectorAll('.loc-item').forEach(el => el.classList.remove('active'));
  const listItem = document.querySelector(`.loc-item[data-id="${loc.id}"]`);
  if (listItem) { listItem.classList.add('active'); listItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

function closeInfoPanel() {
  document.getElementById('info-panel').classList.remove('open');
  document.querySelectorAll('.loc-item').forEach(el => el.classList.remove('active'));
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

// ── Timeline year scrubber ──────────────────────────────────────────────────
function setupTimeline() {
  const slider  = document.getElementById('year-slider');
  const display = document.getElementById('year-display');
  const resetBtn = document.getElementById('tl-reset-btn');
  if (!slider) return;

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

  function applyYear(yr) {
    timelineYear = yr;
    if (display) display.textContent = yr >= 1902 ? 'All Years' : `Up to ${yr}`;
    applyVisibility();
    // Update slider fill
    const pct = ((yr - 1863) / (1902 - 1863)) * 100;
    slider.style.setProperty('--tl-val', pct);
  }

  slider.addEventListener('input', () => {
    applyYear(parseInt(slider.value, 10));
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      slider.value = 1902;
      applyYear(1902);
    });
  }

  // Init
  applyYear(1902);
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
        else { closeInfoPanel(); deselectPin(selectedEntity); selectedEntity = null; }
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
  closeInfoPanel();
  deselectPin(selectedEntity);
  selectedEntity = null;
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
