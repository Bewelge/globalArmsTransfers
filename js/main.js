/*
 * Interactive Arms Transfer Visualisation by Bewelge.
 * Inspired by Will Geary's (@wgeary) video — https://vimeo.com/286751571
 * SVG Map by AMCharts — https://www.amcharts.com/svg-maps/?map=world
 * Dataset from SIPRI — https://www.sipri.org/databases/armstransfers
 *
 * Dependency-free vanilla JS. Open index.html (served) and it runs.
 */

"use strict";

/* ------------------------------------------------------------------ *
 * Constants & state
 * ------------------------------------------------------------------ */

// Native dimensions of worldHigh.svg — the map is drawn scaled from these.
const MAP_NATIVE_W = 1009.673;
const MAP_NATIVE_H = 665.963;

// Mercator projection bounds matching the SVG map.
const leftLongitude = -169.110266;
const rightLongitude = 190.480712;
const topLatitude = 83.63001;
const bottomLatitude = -58.488473;

// Layout
const TIMELINE_BAND = 70; // px reserved at the bottom for the timeline
const TIMELINE_MARGIN = 64; // horizontal inset of the timeline track

// Canvas layers
let mapCanvas, fxCanvas, mctx, fctx;
let glCanvas, gl;            // WebGL layer for the dots
let dpr = 1;

// Viewport + map placement (recomputed on resize)
let vw = 0, vh = 0;          // viewport
let mapW = 0, mapH = 0;      // scaled map dimensions (map-local drawing space)
let offsetX = 0, offsetY = 0; // top-left of the map within the viewport
let mapScale = 1;            // mapW / MAP_NATIVE_W

// Data
let countryLocations = {};
let countryShapes = {};
let armsTransfers = {};
let allCountriesByValue = {};      // supplier -> total TIV
let allRecipientForCountry = {};   // supplier -> { recipient -> { volume, value, arcX, arcY } }

// Selection / colours
let chosenCountries = {};          // supplier -> hex colour string
const shapeCache = {};             // country -> Path2D
const colorCache = {};             // hex -> { r, g, b } normalised 0..1

// Simulation settings
let startYear = 1950, endYear = 2025;
let ticksPerYear = 150;
let maxDots = 50000; // internal cap — WebGL handles this comfortably (no UI setting)
let valueDenominator = 3;
let dotRad = 3;
let arcRandomness = 12;
let dotSpeed = 50;
let turbulence = 34;               // noise flow-field amplitude (px)
let spawnMode = "value";           // "value" | "volume"
let dotRenderMode = "shader";      // "shader" (procedural) | "texture" (circle_05.png)

// Runtime
let dots = {};                     // supplier -> array of dot tuples
let glow = {};                     // recipient -> { i, r, g, b }
let ripples = [];                  // arrival craters: { x, y, age, r, g, b }
const RIPPLE_LIFE = 26;            // frames
const RIPPLE_CAP = 320;            // max concurrent (subsamples at high density)
const LAND_LIFE = 34;              // frames a dot lingers & blooms after arriving
const LAND_GROW = 2.2;             // how much it grows over that time
let ticker = 0;
let currentYear = startYear;
let toSpawnThisYear = {};
let dotsToSpawnNextTick = 0;
let paused = true;
let rafId = null;

// Dot tuple indices: [color, traveled, dist, x1, y1, x2, y2, arcX, arcY, rad, recipient, speedFactor, seed]
const GLOW_HIT = 0.035;  // intensity added when a dot lands (subtle)
const GLOW_DECAY = 0.985; // per-frame multiplier (slow fade)
const GLOW_MAX = 1.6;    // accumulation cap
const GLOW_MAX_ALPHA = 0.8;
const DARK_FACTOR = 0.38; // how dark filled countries are vs their dot colour

// WebGL dot buffers (grown on demand)
let glProgram, glPosBuf, glColBuf, glSizeBuf, glParBuf;
let glLoc = {};
let posArr = new Float32Array(0);   // x,y per dot (map-local px)
let colArr = new Float32Array(0);   // r,g,b per dot (0..1)
let sizeArr = new Float32Array(0);  // point size per dot (device px)
let parArr = new Float32Array(0);   // progress t, seed per dot
let dotCapacity = 0;
let glStartTime = 0;
let dotTexture = null;              // circle_05.png sprite

// Ripples ride along in the SAME point pass as the dots, flagged per-vertex.
let glKindBuf;
let kindArr = new Float32Array(0);  // 0 = dot, 1 = ripple ring

/* ------------------------------------------------------------------ *
 * Historical events overlay
 * ------------------------------------------------------------------ *
 * Each event is drawn twice: as a mark/span on the timeline, and — while the
 * playhead sits within its year range — as a small label anchored on the map
 * at its lon/lat. Single-year events render as a diamond, ranges as a bar.
 * `lon`/`lat` may be omitted for global treaties: those get no map label and
 * instead surface their name in a caption next to the playhead when active.
 */
let showEvents = true;
let categoryOn = { war: true, crisis: true, political: true, treaty: true, embargo: true };
let eventLayout = [];               // [{ ev, isPoint, x0, x1, lane }] — rebuilt with the timeline
let landMask = null;               // cached ImageData of the map layer (land vs ocean)
let oceanAnchorCache = {};         // event name -> ocean label anchor (screen px), per layout
const ONGOING = 2025;              // open-ended ranges clamp here (dataset max)
const EVENT_LANE_BASE = 34;        // px above the track centre for lane 0
                                   // (clears the year-pointer label, which sits
                                   // ~11–30px above the track)
const EVENT_LANE_STEP = 8;         // vertical spacing between lanes
const EVENT_BAR_H = 6;             // span-bar thickness
const EVENT_COLORS = {
	war:      "#e23b3b",
	crisis:   "#f5821f",
	political: "#e0b13c",
	treaty:   "#3a9bdc",
	embargo:  "#a978d8"
};
const EVENTS = [
	// --- Cold War conflicts & crises ---
	{ name: "Korean War",                 start: 1950, end: 1953, cat: "war",       lon: 127.8, lat: 38.3 },
	{ name: "Suez Crisis",                start: 1956, end: 1956, cat: "crisis",    lon: 32.5,  lat: 30.0 },
	{ name: "Hungarian Uprising",         start: 1956, end: 1956, cat: "crisis",    lon: 19.0,  lat: 47.5 },
	{ name: "Vietnam War",                start: 1955, end: 1975, cat: "war",       lon: 107.8, lat: 16.0 },
	{ name: "Cuban Missile Crisis",       start: 1962, end: 1962, cat: "crisis",    lon: -79.5, lat: 22.0 },
	{ name: "Six-Day War",                start: 1967, end: 1967, cat: "war",       lon: 34.8,  lat: 31.5 },
	{ name: "Prague Spring invasion",     start: 1968, end: 1968, cat: "crisis",    lon: 14.4,  lat: 50.1 },
	{ name: "Indo-Pakistani War",         start: 1971, end: 1971, cat: "war",       lon: 90.4,  lat: 23.7 },
	{ name: "Yom Kippur War",             start: 1973, end: 1973, cat: "war",       lon: 33.0,  lat: 30.5 },
	{ name: "Soviet–Afghan War",          start: 1979, end: 1989, cat: "war",       lon: 66.0,  lat: 34.8 },
	{ name: "Iran–Iraq War",              start: 1980, end: 1988, cat: "war",       lon: 47.5,  lat: 31.0 },
	{ name: "Falklands War",              start: 1982, end: 1982, cat: "war",       lon: -59.2, lat: -51.7 },
	// --- Post–Cold War ---
	{ name: "Fall of the Berlin Wall",    start: 1989, end: 1989, cat: "political", lon: 13.4,  lat: 52.5 },
	{ name: "Gulf War",                   start: 1990, end: 1991, cat: "war",       lon: 47.9,  lat: 29.4 },
	{ name: "Dissolution of the USSR",    start: 1991, end: 1991, cat: "political", lon: 37.6,  lat: 55.8 },
	{ name: "Yugoslav Wars",              start: 1991, end: 1999, cat: "war",       lon: 17.7,  lat: 43.9 },
	{ name: "Rwandan Genocide",           start: 1994, end: 1994, cat: "crisis",    lon: 30.1,  lat: -1.9 },
	{ name: "Kosovo War",                 start: 1998, end: 1999, cat: "war",       lon: 21.0,  lat: 42.6 },
	// --- 21st century ---
	{ name: "9/11 attacks",               start: 2001, end: 2001, cat: "crisis",    lon: -74.0, lat: 40.7 },
	{ name: "War in Afghanistan",         start: 2001, end: 2021, cat: "war",       lon: 67.5,  lat: 33.5 },
	{ name: "Iraq War",                   start: 2003, end: 2011, cat: "war",       lon: 44.4,  lat: 33.3 },
	{ name: "Russo-Georgian War",         start: 2008, end: 2008, cat: "war",       lon: 43.5,  lat: 42.0 },
	{ name: "Arab Spring",                start: 2011, end: 2011, cat: "political", lon: 9.5,   lat: 34.0 },
	{ name: "Libyan Civil War",           start: 2011, end: 2011, cat: "war",       lon: 17.0,  lat: 27.0 },
	{ name: "Syrian Civil War",           start: 2011, end: ONGOING, cat: "war",    lon: 38.5,  lat: 35.0 },
	{ name: "Annexation of Crimea",       start: 2014, end: 2014, cat: "crisis",    lon: 34.5,  lat: 45.3 },
	{ name: "Yemen Civil War",            start: 2014, end: ONGOING, cat: "war",    lon: 47.5,  lat: 15.5 },
	{ name: "Nagorno-Karabakh War",       start: 2020, end: 2020, cat: "war",       lon: 46.7,  lat: 39.8 },
	{ name: "Russia invades Ukraine",     start: 2022, end: ONGOING, cat: "war",    lon: 32.0,  lat: 49.0 },
	{ name: "Israel–Hamas / Gaza war",    start: 2023, end: ONGOING, cat: "war",    lon: 34.4,  lat: 31.4 },
	// --- Treaties & embargoes (explain dips; geo ones labelled, treaties timeline-only) ---
	{ name: "SALT I & ABM Treaty",        start: 1972, end: 1972, cat: "treaty" },
	{ name: "UN embargo on South Africa", start: 1977, end: 1994, cat: "embargo",  lon: 25.0,  lat: -29.0 },
	{ name: "SALT II",                    start: 1979, end: 1979, cat: "treaty" },
	{ name: "INF Treaty",                 start: 1987, end: 1987, cat: "treaty" },
	{ name: "EU/US embargo on China",     start: 1989, end: ONGOING, cat: "embargo", lon: 104.0, lat: 35.5 },
	{ name: "START I",                    start: 1991, end: 1991, cat: "treaty" },
	{ name: "UN embargo on Yugoslavia",   start: 1991, end: 1996, cat: "embargo",  lon: 20.9,  lat: 44.0 },
	{ name: "UN arms embargo on Iran",    start: 2007, end: 2020, cat: "embargo",  lon: 53.0,  lat: 32.5 },
	{ name: "New START",                  start: 2010, end: 2010, cat: "treaty" },
	{ name: "Arms Trade Treaty in force", start: 2014, end: 2014, cat: "treaty" },
	{ name: "Embargo on Russia",          start: 2014, end: ONGOING, cat: "embargo", lon: 50.0, lat: 58.0 }
];

/* ------------------------------------------------------------------ *
 * Bootstrap
 * ------------------------------------------------------------------ */

const svgMap = new Image();
svgMap.src = "worldHigh.svg";

let svgReady = false, domReady = false, dataReady = false;
svgMap.onload = () => { svgReady = true; tryStart(); };
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => { domReady = true; tryStart(); });
} else {
	domReady = true; tryStart();
}

function tryStart() {
	if (!svgReady || !domReady) return;
	mapCanvas = document.getElementById("mapCanvas");
	glCanvas = document.getElementById("glCanvas");
	fxCanvas = document.getElementById("fxCanvas");
	mctx = mapCanvas.getContext("2d");
	fctx = fxCanvas.getContext("2d");
	initGL();

	layout();
	initStaticUI();
	drawStatic(); // show the map + timeline straight away

	loadData().then(() => {
		dataReady = true;
		assignColors();
		buildCountryList();
		// Pre-select the two largest exporters.
		if (armsTransfers["United States"]) chooseCountry("United States");
		if (armsTransfers["Russia"]) chooseCountry("Russia");
		drawStatic();
		draw();
	});

	window.addEventListener("resize", onResize);
	window.addEventListener("mousedown", onPointerDown);
	window.addEventListener("mousemove", onPointerMove);
	window.addEventListener("mouseup", onPointerUp);
	fxCanvas.style.pointerEvents = "none";
}

async function loadData() {
	const [loc, shapes, transfers] = await Promise.all([
		fetch("countryLocations.json").then(r => r.json()),
		fetch("countryShapes.json").then(r => r.json()),
		fetch("armsTransfers.json").then(r => r.json())
	]);
	countryLocations = loc;
	countryShapes = shapes;
	armsTransfers = transfers;

	for (const supplier in armsTransfers) {
		let total = 0;
		for (const yr in armsTransfers[supplier]) {
			for (const recip in armsTransfers[supplier][yr]) {
				for (const t of armsTransfers[supplier][yr][recip]) {
					const v = parseFloat(t[1]);
					if (!isNaN(v)) total += v;
				}
			}
		}
		allCountriesByValue[supplier] = total;
	}
	getAllCountryPositions();
}

/* ------------------------------------------------------------------ *
 * Layout / projection (responsive)
 * ------------------------------------------------------------------ */

function layout() {
	vw = window.innerWidth;
	vh = window.innerHeight;

	const availH = Math.max(120, vh - TIMELINE_BAND);
	mapScale = Math.min(vw / MAP_NATIVE_W, availH / MAP_NATIVE_H);
	mapW = MAP_NATIVE_W * mapScale;
	mapH = MAP_NATIVE_H * mapScale;
	offsetX = (vw - mapW) / 2;
	offsetY = (availH - mapH) / 2;

	dpr = Math.min(window.devicePixelRatio || 1, 2);
	for (const cnv of [mapCanvas, glCanvas, fxCanvas]) {
		if (!cnv) continue;
		cnv.width = vw * dpr;
		cnv.height = vh * dpr;
		cnv.style.width = vw + "px";
		cnv.style.height = vh + "px";
	}
	mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	if (gl) gl.viewport(0, 0, glCanvas.width, glCanvas.height);

	// Map geometry changed: drop the land mask + ocean label anchors so they're
	// recomputed against the new projection.
	landMask = null;
	oceanAnchorCache = {};

	getAllCountryPositions();
}

function getAllCountryPositions() {
	for (const c in countryLocations) {
		const p = project(countryLocations[c].long, countryLocations[c].lat);
		countryLocations[c].x = p.x;
		countryLocations[c].y = p.y;
	}
}

function project(longit, lat) {
	const mapLonDelta = Math.abs(leftLongitude) + rightLongitude;
	const mapLatBottom = bottomLatitude * Math.PI / 180;
	const x = (longit - leftLongitude) * (mapW / mapLonDelta);
	const latRad = lat * Math.PI / 180;
	const worldMapWidth = ((mapW / mapLonDelta) * 360) / (2 * Math.PI);
	const mapOffsetY = (worldMapWidth / 2 * Math.log((1 + Math.sin(mapLatBottom)) / (1 - Math.sin(mapLatBottom))));
	const y = mapH - ((worldMapWidth / 2 * Math.log((1 + Math.sin(latRad)) / (1 - Math.sin(latRad)))) - mapOffsetY);
	return { x, y };
}

let resizeTimer = null;
function onResize() {
	if (resizeTimer) cancelAnimationFrame(resizeTimer);
	resizeTimer = requestAnimationFrame(() => {
		layout();
		shapeCacheReset();
		for (const c in chosenCountries) {
			getAllArcsForCountry(c);
		}
		dots = {};
		glow = {};
		ripples = [];
	ripples = [];
		drawStatic();
		draw();
	});
}

function shapeCacheReset() { for (const k in shapeCache) delete shapeCache[k]; }

function getShape(country) {
	if (!countryShapes[country]) return null;
	if (!shapeCache[country]) shapeCache[country] = new Path2D(countryShapes[country].d);
	return shapeCache[country];
}

/* ------------------------------------------------------------------ *
 * Static layer: map + chosen-country fills + timeline track
 * ------------------------------------------------------------------ */

function drawStatic() {
	mctx.clearRect(0, 0, vw, vh);
	mctx.save();
	mctx.translate(offsetX, offsetY);
	mctx.drawImage(svgMap, 0, 0, mapW, mapH);
	for (const c in chosenCountries) {
		fillCountryShape(mctx, c, darkShade(chosenCountries[c], DARK_FACTOR, 0.85));
	}
	mctx.restore();
	drawTimelineTrack();
}

// The country paths in countryShapes.json are raw, but the SVG renders them
// inside a <g> with this transform — apply it so fills line up with the grey map.
const MAP_TF = [0.99999728, 0, 0, 1, -0.80424889, 0.25140113];

function fillCountryShape(ctx, country, fillStyle) {
	const shape = getShape(country);
	if (!shape) return;
	ctx.save();
	ctx.scale(mapScale, mapScale);
	ctx.transform(MAP_TF[0], MAP_TF[1], MAP_TF[2], MAP_TF[3], MAP_TF[4], MAP_TF[5]);
	ctx.fillStyle = fillStyle;
	ctx.fill(shape);
	ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Timeline (static track on map layer, moving pointer on fx layer)
 * ------------------------------------------------------------------ */

function timelineGeom() {
	return {
		x0: TIMELINE_MARGIN,
		x1: vw - TIMELINE_MARGIN,
		y: vh - TIMELINE_BAND / 2
	};
}

function yearToX(year) {
	const g = timelineGeom();
	const span = Math.max(1, endYear - startYear);
	return g.x0 + (year - startYear) / span * (g.x1 - g.x0);
}

function drawTimelineTrack() {
	const g = timelineGeom();
	mctx.save();
	mctx.lineCap = "round";
	mctx.strokeStyle = "rgba(233, 238, 247, 0.28)";
	mctx.fillStyle = "rgba(233, 238, 247, 0.55)";
	mctx.font = "600 11px Inter, Arial, sans-serif";
	mctx.textBaseline = "middle";

	mctx.lineWidth = 4;
	mctx.beginPath();
	mctx.moveTo(g.x0, g.y);
	mctx.lineTo(g.x1, g.y);
	mctx.stroke();

	mctx.lineWidth = 1.5;
	mctx.beginPath();
	for (let yr = startYear; yr <= endYear; yr++) {
		const x = yearToX(yr);
		const major = yr % 10 === 0;
		const mid = yr % 5 === 0;
		const h = major ? 9 : mid ? 6 : 3;
		mctx.moveTo(x, g.y - h);
		mctx.lineTo(x, g.y + h);
	}
	mctx.stroke();

	mctx.textAlign = "center";
	const span = endYear - startYear;
	const labelStep = span > 60 ? 10 : 5;
	for (let yr = Math.ceil(startYear / labelStep) * labelStep; yr <= endYear; yr += labelStep) {
		mctx.fillText(yr, yearToX(yr), g.y + 22);
	}
	mctx.textAlign = "start";
	mctx.restore();

	drawEventMarks();
}

/* ------------------------------------------------------------------ *
 * Historical events: timeline marks + on-map labels
 * ------------------------------------------------------------------ */

// Events overlapping the visible year range whose category is enabled.
function visibleEvents() {
	return EVENTS.filter(ev =>
		categoryOn[ev.cat] !== false && ev.end >= startYear && ev.start <= endYear);
}

// Greedy first-fit lane packing so overlapping spans stack instead of colliding.
function computeEventLayout() {
	const items = visibleEvents().map(ev => {
		const isPoint = ev.start === ev.end;
		let x0, x1;
		if (isPoint) {
			const x = yearToX(ev.start); x0 = x - 3; x1 = x + 3;
		} else {
			x0 = yearToX(Math.max(ev.start, startYear));
			x1 = yearToX(Math.min(ev.end, endYear));
			if (x1 < x0 + 5) x1 = x0 + 5;
		}
		return { ev, isPoint, x0, x1, lane: 0 };
	}).sort((a, b) => a.x0 - b.x0);

	const laneEnds = [];
	const pad = 6;
	for (const it of items) {
		let lane = 0;
		while (lane < laneEnds.length && laneEnds[lane] > it.x0 - pad) lane++;
		if (lane === laneEnds.length) laneEnds.push(it.x1);
		else laneEnds[lane] = it.x1;
		it.lane = lane;
	}
	return items;
}

function eventLaneY(lane) {
	return timelineGeom().y - EVENT_LANE_BASE - lane * EVENT_LANE_STEP;
}

// Static, dim marks above the timeline track. Always drawn (the `showEvents`
// toggle only governs the on-map labels); category chips filter them.
function drawEventMarks() {
	eventLayout = computeEventLayout();
	mctx.save();
	for (const it of eventLayout) {
		const col = EVENT_COLORS[it.ev.cat] || "#888";
		const y = eventLaneY(it.lane);
		mctx.fillStyle = withAlpha(col, 0.5);
		if (it.isPoint) {
			const cx = (it.x0 + it.x1) / 2, r = EVENT_BAR_H;
			mctx.beginPath();
			mctx.moveTo(cx, y - r); mctx.lineTo(cx + r, y);
			mctx.lineTo(cx, y + r); mctx.lineTo(cx - r, y);
			mctx.closePath(); mctx.fill();
		} else {
			roundRect(mctx, it.x0, y - EVENT_BAR_H / 2, it.x1 - it.x0, EVENT_BAR_H, EVENT_BAR_H / 2);
			mctx.fill();
		}
	}
	mctx.restore();
}

// Per-frame: brighten the marks for events active in the current year. When the
// `showEvents` (map-labels) toggle is on, also surface their names — geo events
// as map labels, treaties as a caption by the playhead.
function drawActiveEvents() {
	if (!eventLayout.length) return;
	const cy = currentYear;
	const placed = [];     // map-label boxes for overlap avoidance
	const caption = [];    // active events without coordinates (treaties)

	fctx.save();
	fctx.textBaseline = "alphabetic";
	for (const it of eventLayout) {
		const ev = it.ev;
		if (cy < ev.start || cy > ev.end) continue;
		const col = EVENT_COLORS[ev.cat] || "#888";

		// brighten the timeline mark
		const y = eventLaneY(it.lane);
		fctx.fillStyle = col;
		if (it.isPoint) {
			const cx = (it.x0 + it.x1) / 2, r = EVENT_BAR_H + 1;
			fctx.beginPath();
			fctx.moveTo(cx, y - r); fctx.lineTo(cx + r, y);
			fctx.lineTo(cx, y + r); fctx.lineTo(cx - r, y);
			fctx.closePath(); fctx.fill();
		} else {
			const h = EVENT_BAR_H + 1;
			roundRect(fctx, it.x0, y - h / 2, it.x1 - it.x0, h, h / 2);
			fctx.fill();
		}

		if (!showEvents) continue;   // toggle hides only the appearing labels
		if (ev.lon != null && ev.lat != null) {
			const p = project(ev.lon, ev.lat);
			const mX = offsetX + p.x, mY = offsetY + p.y;
			fctx.font = "600 11px Inter, Arial, sans-serif";
			const w = fctx.measureText(ev.name).width + 14, lh = 16;
			const anchor = findOceanAnchor(ev.name, mX, mY, w / 2, lh);
			const pos = resolveLabelPos(anchor, w, lh, placed);
			placed.push({ x: pos.x - w / 2, y: pos.y - lh / 2, w, h: lh });
			drawMapLabel(mX, mY, pos.x, pos.y, ev.name, col);
		} else {
			caption.push({ name: ev.name, col });
		}
	}
	if (showEvents && caption.length) drawEventCaption(caption);
	fctx.restore();
}

/* ------------------------------------------------------------------ *
 * Timeline event hover tooltip
 * ------------------------------------------------------------------ */

let hoverEvent = null;             // currently hovered timeline-mark item
let hoverX = 0, hoverY = 0;        // last cursor position (canvas px)

// Hit-test the timeline marks at canvas coords (mx, my). Returns a layout item.
function eventAt(mx, my) {
	if (!eventLayout.length) return null;
	for (const it of eventLayout) {
		const y = eventLaneY(it.lane);
		if (Math.abs(my - y) > EVENT_BAR_H + 1) continue;
		if (it.isPoint) {
			const cx = (it.x0 + it.x1) / 2;
			if (Math.abs(mx - cx) <= EVENT_BAR_H + 2) return it;
		} else if (mx >= it.x0 - 2 && mx <= it.x1 + 2) {
			return it;
		}
	}
	return null;
}

function drawEventTooltip() {
	if (!hoverEvent) return;
	const ev = hoverEvent.ev;
	const col = EVENT_COLORS[ev.cat] || "#888";
	const years = ev.start === ev.end
		? `${ev.start}`
		: `${ev.start}–${ev.end >= ONGOING ? "now" : ev.end}`;

	fctx.save();
	fctx.textBaseline = "alphabetic";
	fctx.font = "700 12px Inter, Arial, sans-serif";
	const nameW = fctx.measureText(ev.name).width;
	fctx.font = "600 11px Inter, Arial, sans-serif";
	const yrW = fctx.measureText(years).width;

	const padX = 10, padY = 7, nameH = 14, gap = 2, yrH = 12, dotGap = 14;
	const w = Math.max(nameW, yrW) + padX * 2 + dotGap;
	const h = padY * 2 + nameH + gap + yrH;
	let bx = Math.max(4, Math.min(vw - w - 4, hoverX - w / 2));
	let by = hoverY - h - 12;
	if (by < 4) by = hoverY + 18;

	fctx.fillStyle = "rgba(12,18,30,0.95)";
	roundRect(fctx, bx, by, w, h, 7); fctx.fill();
	fctx.strokeStyle = withAlpha(col, 0.85); fctx.lineWidth = 1;
	roundRect(fctx, bx, by, w, h, 7); fctx.stroke();

	fctx.fillStyle = col;
	fctx.beginPath(); fctx.arc(bx + padX + 3, by + padY + 6, 4, 0, Math.PI * 2); fctx.fill();

	fctx.textAlign = "left";
	fctx.fillStyle = "#f0f4fb";
	fctx.font = "700 12px Inter, Arial, sans-serif";
	fctx.fillText(ev.name, bx + padX + dotGap, by + padY + nameH - 2);
	fctx.fillStyle = "rgba(202,212,228,0.78)";
	fctx.font = "600 11px Inter, Arial, sans-serif";
	fctx.fillText(years, bx + padX + dotGap, by + padY + nameH + gap + yrH - 2);
	fctx.restore();
}

/* --- Ocean placement: keep labels off the landmass --- */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// True if the map layer has something drawn at this css-px point (land or a
// chosen-country fill). Ocean is transparent, so alpha ~0 there.
function mapPixelIsLand(sx, sy) {
	if (!mapCanvas) return false;
	if (!landMask) {
		try { landMask = mctx.getImageData(0, 0, mapCanvas.width, mapCanvas.height); }
		catch (e) { landMask = null; return false; } // tainted canvas -> treat as ocean
	}
	const px = Math.round(sx * dpr), py = Math.round(sy * dpr);
	if (px < 0 || py < 0 || px >= landMask.width || py >= landMask.height) return false;
	return landMask.data[(py * landMask.width + px) * 4 + 3] > 40;
}

// A label box (centred at x,y) is "on land" if any of its sampled points are.
function boxOnLand(x, y, halfW) {
	return mapPixelIsLand(x, y) ||
		mapPixelIsLand(x - halfW, y) || mapPixelIsLand(x + halfW, y) ||
		mapPixelIsLand(x, y - 7) || mapPixelIsLand(x, y + 7);
}

// Openness of a water point: the radius of the largest land-free disk around it
// (capped). Narrow seas/gulfs score low; big oceans score high.
function oceanOpenness(x, y) {
	const dirs = 12, step = 18, maxOpen = 162;
	for (let r = step; r <= maxOpen; r += step) {
		for (let a = 0; a < dirs; a++) {
			const ang = (a / dirs) * Math.PI * 2;
			if (mapPixelIsLand(x + Math.cos(ang) * r, y + Math.sin(ang) * r)) return r - step;
		}
	}
	return maxOpen;
}

// Pick a label anchor out in open water: scan candidates around the marker and
// maximise surrounding openness (so labels land in big oceans, not coastal
// seas), with a mild penalty for distance. Cached per event/layout.
function findOceanAnchor(name, sx, sy, halfW, h) {
	if (oceanAnchorCache[name]) return oceanAnchorCache[name];
	let best = { x: sx, y: sy }, bestScore = -Infinity;
	const step = 18, maxR = 620, angles = 18;
	for (let r = 0; r <= maxR; r += step) {
		const ringAngles = r === 0 ? 1 : angles;
		for (let a = 0; a < ringAngles; a++) {
			const ang = (a / ringAngles) * Math.PI * 2;
			const x = sx + Math.cos(ang) * r;
			const y = sy + Math.sin(ang) * r;
			if (x < halfW + 6 || x > vw - halfW - 6) continue;
			if (y < h + 4 || y > vh - TIMELINE_BAND - h - 4) continue;
			if (boxOnLand(x, y, halfW)) continue;
			const score = oceanOpenness(x, y) - r * 0.32;
			if (score > bestScore) { bestScore = score; best = { x, y }; }
		}
	}
	oceanAnchorCache[name] = best;
	return best;
}

// Final label centre: start from the ocean anchor, then step to a nearby spot
// that is still over water AND doesn't overlap an already-placed label.
function resolveLabelPos(anchor, w, h, placed) {
	const halfW = w / 2, halfH = h / 2;
	const overlaps = (x, y) => placed.some(q =>
		x - halfW < q.x + q.w && x + halfW > q.x && y - halfH < q.y + q.h && y + halfH > q.y);
	const s = h + 4;
	const cands = [
		[0, 0], [0, s], [0, -s], [0, 2 * s], [0, -2 * s], [0, 3 * s], [0, -3 * s],
		[w * 0.6, 0], [-w * 0.6, 0], [w * 0.6, s], [-w * 0.6, s],
		[w * 0.6, -s], [-w * 0.6, -s], [w * 0.6, 2 * s], [-w * 0.6, 2 * s]
	];
	for (const [dx, dy] of cands) {
		const x = clamp(anchor.x + dx, halfW + 4, vw - halfW - 4);
		const y = clamp(anchor.y + dy, halfH + 4, vh - TIMELINE_BAND - halfH - 2);
		if (boxOnLand(x, y, halfW)) continue;
		if (overlaps(x, y)) continue;
		return { x, y };
	}
	return {
		x: clamp(anchor.x, halfW + 4, vw - halfW - 4),
		y: clamp(anchor.y, halfH + 4, vh - TIMELINE_BAND - halfH - 2)
	};
}

// Draw the marker dot at its true location and the name pill at (lx, ly),
// connected by a leader line. The pill sits over open water by construction.
function drawMapLabel(markerX, markerY, lx, ly, text, col) {
	fctx.font = "600 11px Inter, Arial, sans-serif";
	const padX = 7, h = 16;
	const w = fctx.measureText(text).width + padX * 2;
	const bx = clamp(lx - w / 2, 4, vw - w - 4);
	const by = clamp(ly - h / 2, 4, vh - TIMELINE_BAND - h - 2);

	// leader from the marker to the pill
	fctx.strokeStyle = withAlpha(col, 0.55);
	fctx.lineWidth = 1;
	fctx.beginPath(); fctx.moveTo(markerX, markerY); fctx.lineTo(bx + w / 2, by + h / 2); fctx.stroke();

	// pill
	fctx.fillStyle = "rgba(15,22,36,0.86)";
	roundRect(fctx, bx, by, w, h, 5); fctx.fill();
	fctx.strokeStyle = withAlpha(col, 0.9); fctx.lineWidth = 1;
	roundRect(fctx, bx, by, w, h, 5); fctx.stroke();
	fctx.fillStyle = "#eef3fb";
	fctx.textAlign = "left";
	fctx.fillText(text, bx + padX, by + h - 5);
}

// Stacked name chips for active treaties (no geographic anchor), by the playhead.
function drawEventCaption(list) {
	const g = timelineGeom();
	const px = yearToX(Math.min(endYear, currentYear) + (currentYear < endYear ? ticker / ticksPerYear : 0));
	fctx.font = "600 11px Inter, Arial, sans-serif";
	fctx.textBaseline = "alphabetic";
	const h = 16, gap = 3;
	let maxW = 0;
	for (const c of list) maxW = Math.max(maxW, fctx.measureText(c.name).width);
	const boxW = maxW + 26;
	let bx = px + 12;
	if (bx + boxW > vw - 6) bx = px - 12 - boxW;
	let by = g.y - 42 - list.length * (h + gap);
	if (by < 6) by = 6;

	for (let i = 0; i < list.length; i++) {
		const c = list[i];
		const y = by + i * (h + gap);
		fctx.fillStyle = "rgba(15,22,36,0.86)";
		roundRect(fctx, bx, y, boxW, h, 5); fctx.fill();
		fctx.fillStyle = c.col;
		fctx.beginPath(); fctx.arc(bx + 10, y + h / 2, 3.5, 0, Math.PI * 2); fctx.fill();
		fctx.fillStyle = "#eef3fb"; fctx.textAlign = "left";
		fctx.fillText(c.name, bx + 19, y + h - 5);
	}
}

function drawYearPointer() {
	if (!dataReady) return;
	const g = timelineGeom();
	const frac = ticker / ticksPerYear;
	const x = yearToX(Math.min(endYear, currentYear) + (currentYear < endYear ? frac : 0));

	fctx.save();
	fctx.fillStyle = "#e9eef7";
	// pin
	fctx.beginPath();
	fctx.arc(x, g.y, 6, 0, Math.PI * 2);
	fctx.fill();
	fctx.strokeStyle = "rgba(47,126,240,0.9)";
	fctx.lineWidth = 2;
	fctx.beginPath();
	fctx.moveTo(x, g.y - TIMELINE_BAND / 2 + 6);
	fctx.lineTo(x, g.y + TIMELINE_BAND / 2 - 22);
	fctx.stroke();
	// year label
	fctx.font = "700 14px Inter, Arial, sans-serif";
	fctx.textAlign = "center";
	fctx.textBaseline = "alphabetic";
	const label = String(Math.min(endYear, Math.max(startYear, currentYear)));
	const w = fctx.measureText(label).width + 14;
	fctx.fillStyle = "rgba(17,25,40,0.9)";
	roundRect(fctx, x - w / 2, g.y - 30, w, 19, 6);
	fctx.fill();
	fctx.fillStyle = "#e9eef7";
	fctx.fillText(label, x, g.y - 16);
	fctx.textAlign = "start";
	fctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

/* ------------------------------------------------------------------ *
 * Timeline drag-to-seek
 * ------------------------------------------------------------------ */

let dragging = false;

function clientToCanvasX(e) {
	const rect = fxCanvas.getBoundingClientRect();
	return e.clientX - rect.left;
}
function inTimelineBand(e) {
	const rect = fxCanvas.getBoundingClientRect();
	const y = e.clientY - rect.top;
	const x = e.clientX - rect.left;
	return y > vh - TIMELINE_BAND - 6 && x > TIMELINE_MARGIN - 24 && x < vw - TIMELINE_MARGIN + 24;
}

function onPointerDown(e) {
	if (!dataReady || !inTimelineBand(e)) return;
	if (e.target.closest && e.target.closest("#panel, #topbar, #descriptionDiv, #infoDiv")) return;
	dragging = true;
	document.body.classList.add("seeking");
	seekFromX(clientToCanvasX(e));
}
function onPointerMove(e) {
	if (dragging) { seekFromX(clientToCanvasX(e)); return; }

	const rect = fxCanvas.getBoundingClientRect();
	const mx = e.clientX - rect.left, my = e.clientY - rect.top;
	hoverX = mx; hoverY = my;
	const prev = hoverEvent;
	hoverEvent = eventAt(mx, my);

	if (hoverEvent) document.body.style.cursor = "pointer";
	else if (dataReady && inTimelineBand(e)) document.body.style.cursor = "grab";
	else if (document.body.style.cursor === "grab" || document.body.style.cursor === "pointer")
		document.body.style.cursor = "";

	// Redraw so the tooltip follows the cursor (cheap; the loop already redraws
	// every frame while playing).
	if (hoverEvent || hoverEvent !== prev) draw();
}
function onPointerUp() {
	if (!dragging) return;
	dragging = false;
	document.body.classList.remove("seeking");
	document.body.style.cursor = "";
}

function seekFromX(x) {
	const g = timelineGeom();
	const frac = (x - g.x0) / (g.x1 - g.x0);
	seekToFraction(frac);
}

function seekToFraction(frac) {
	frac = Math.max(0, Math.min(1, frac));
	const span = endYear - startYear;
	const pos = startYear + frac * span;
	currentYear = Math.floor(pos);
	if (currentYear >= endYear) currentYear = endYear;
	const yearFrac = pos - currentYear;
	ticker = Math.floor(yearFrac * ticksPerYear);

	dots = {};
	glow = {};
	ripples = [];
	toSpawnThisYear = {};
	dotsToSpawnNextTick = 0;
	computeSpawnsForCurrentYear();
	// Pre-mark dots already "due" by this point in the year so we don't burst.
	for (const c1 in toSpawnThisYear) {
		for (const c2 in toSpawnThisYear[c1]) {
			const slot = toSpawnThisYear[c1][c2];
			slot.spawned = Math.ceil(ticker / ticksPerYear * slot.toSpawn);
		}
	}
	draw();
}

/* ------------------------------------------------------------------ *
 * Colours: pinned US/Russia + curated palette + deterministic fallback
 * ------------------------------------------------------------------ */

const PINNED = { "United States": "#2f7ef0", "Russia": "#e23b3b" };
const PALETTE = [
	"#f5821f", "#2ca02c", "#9467bd", "#17becf", "#e377c2",
	"#bcbd22", "#8c564b", "#ffbf00", "#7cb342", "#5e35b1",
	"#00acc1", "#ec407a", "#ff7043", "#9ccc65", "#26a69a",
	"#ab47bc", "#ffa726", "#42a5f5", "#66bb6a", "#d4e157"
];
let colorMap = {};

function assignColors() {
	colorMap = Object.assign({}, PINNED);
	const order = Object.keys(allCountriesByValue).sort(
		(a, b) => allCountriesByValue[b] - allCountriesByValue[a]
	);
	let pi = 0;
	for (const name of order) {
		if (colorMap[name]) continue;
		if (pi < PALETTE.length) colorMap[name] = PALETTE[pi++];
	}
}

function colorForCountry(name) {
	if (colorMap[name]) return colorMap[name];
	// deterministic, well-spread fallback hue from the name
	let h = 0;
	for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
	const hex = hslToHex(h, 62, 58);
	colorMap[name] = hex;
	return hex;
}

function hslToHex(h, s, l) {
	s /= 100; l /= 100;
	const k = n => (n + h / 30) % 12;
	const a = s * Math.min(l, 1 - l);
	const f = n => {
		const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
		return Math.round(255 * c).toString(16).padStart(2, "0");
	};
	return `#${f(0)}${f(8)}${f(4)}`;
}

function parseColor(col) {
	if (col[0] === "#") {
		let h = col.slice(1);
		if (h.length === 3) h = h.split("").map(c => c + c).join("");
		return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
	}
	const m = col.match(/(\d+(\.\d+)?)/g);
	return { r: +m[0], g: +m[1], b: +m[2] };
}

function withAlpha(col, a) {
	const c = parseColor(col);
	return `rgba(${c.r},${c.g},${c.b},${a})`;
}

// Darkened shade of a colour — used to fill chosen countries so their bright,
// same-coloured dots stand out clearly on top.
function darkShade(col, factor, a) {
	const c = parseColor(col);
	return `rgba(${Math.round(c.r * factor)},${Math.round(c.g * factor)},${Math.round(c.b * factor)},${a})`;
}

/* ------------------------------------------------------------------ *
 * Choosing / removing countries
 * ------------------------------------------------------------------ */

function chooseCountry(country) {
	if (chosenCountries[country]) return;
	chosenCountries[country] = colorForCountry(country);
	getAllRecipientsForCountry(country);
	getAllArcsForCountry(country);
	renderChosen();
	buildCountryList();
	drawStatic();
}

function removeCountry(country) {
	delete chosenCountries[country];
	delete dots[country];
	delete allRecipientForCountry[country];
	if (toSpawnThisYear[country]) delete toSpawnThisYear[country]; // stop the tick loop spawning ghost dots
	renderChosen();
	buildCountryList();
	drawStatic();
}

function recolorCountry(country, hex) {
	chosenCountries[country] = hex;
	colorMap[country] = hex;
	drawStatic();          // <-- map fill updates immediately after a colour change
	renderChosen();
}

function getAllRecipientsForCountry(country) {
	const recips = {};
	for (const yr in armsTransfers[country]) {
		for (const recip in armsTransfers[country][yr]) {
			if (!recips[recip]) recips[recip] = { volume: 0, value: 0 };
			for (const t of armsTransfers[country][yr][recip]) {
				const vol = parseFloat(t[0]);
				const val = parseFloat(t[1]);
				if (!isNaN(vol)) recips[recip].volume += vol;
				if (!isNaN(val)) recips[recip].value += val;
			}
		}
	}
	for (const r in recips) {
		if (recips[r].volume + recips[r].value === 0) delete recips[r];
	}
	allRecipientForCountry[country] = recips;
}

function getAllArcsForCountry(country) {
	const recips = allRecipientForCountry[country];
	if (!recips) return;
	for (const recip in recips) {
		if (!countryLocations[country] || !countryLocations[recip]) { delete recips[recip]; continue; }
		const p1 = { x: countryLocations[country].x, y: countryLocations[country].y };
		const p2 = { x: countryLocations[recip].x, y: countryLocations[recip].y };
		const x2 = (p1.x + p2.x) / 2;
		const y2 = (p1.y + p2.y) / 2;
		const ang = angle(p1.x, p1.y, p2.x, p2.y);
		const dis = distance(p1.x, p1.y, p2.x, p2.y);
		const angDiff =
			(Math.abs(mapW / 2 - p1.x) / (mapW / 2 - p1.x)) *
			(Math.abs(p1.x - p2.x) / (p1.x - p2.x)) *
			(Math.abs(p1.y - p2.y) / (p1.y - p2.y)) * Math.PI * 0.5;
		recips[recip].arcX = x2 + Math.cos(ang + angDiff) * (20 + dis * (0.2 + 0.4 * Math.random()));
		recips[recip].arcY = y2 + Math.sin(ang + angDiff) * (20 + dis * (0.2 + 0.4 * Math.random()));
	}
}

// Normalised (0..1) rgb for the GL colour attribute, cached per hex string.
function rgbNorm(col) {
	let c = colorCache[col];
	if (!c) {
		const p = parseColor(col);
		c = colorCache[col] = { r: p.r / 255, g: p.g / 255, b: p.b / 255 };
	}
	return c;
}

/* ------------------------------------------------------------------ *
 * Simulation
 * ------------------------------------------------------------------ */

function play() {
	if (!dataReady) return;
	paused = false;
	setPlayLabel(true);
	tick();
}
function pauseSim() {
	paused = true;
	setPlayLabel(false);
}
function togglePlay() { paused ? play() : pauseSim(); }

function reset() {
	pauseSim();
	currentYear = startYear;
	ticker = 0;
	dots = {};
	glow = {};
	ripples = [];
	toSpawnThisYear = {};
	dotsToSpawnNextTick = 0;
	draw();
}

function dotSum() {
	let s = 0;
	for (const k in dots) s += dots[k].length;
	return s;
}

function computeSpawnsForCurrentYear() {
	const idx = spawnMode === "volume" ? 0 : 1;
	for (const key in chosenCountries) {
		if (!armsTransfers[key] || !armsTransfers[key][currentYear]) continue;
		toSpawnThisYear[key] = {};
		for (const recip in armsTransfers[key][currentYear]) {
			let sum = 0;
			for (const t of armsTransfers[key][currentYear][recip]) {
				const v = parseFloat(t[idx]);
				if (!isNaN(v)) sum += idx === 1 ? v / valueDenominator : v;
			}
			toSpawnThisYear[key][recip] = { spawned: 0, toSpawn: sum };
		}
	}
}

function tick() {
	if (paused) return;
	if (dotSum() <= maxDots - dotsToSpawnNextTick) {
		dotsToSpawnNextTick = 0;
		if (currentYear < endYear) ticker++;

		for (const c1 in toSpawnThisYear) {
			for (const c2 in toSpawnThisYear[c1]) {
				const slot = toSpawnThisYear[c1][c2];
				const dif = Math.ceil(ticker / ticksPerYear * slot.toSpawn) - slot.spawned;
				dotsToSpawnNextTick += Math.ceil((ticker + 1) / ticksPerYear * slot.toSpawn) - slot.spawned;
				if (dif > 0) {
					slot.spawned += dif;
					for (let i = 0; i < dif; i++) spawnDot(c1, c2);
				}
			}
		}

		if (ticker >= ticksPerYear) {
			toSpawnThisYear = {};
			if (currentYear < endYear) {
				currentYear++;
				ticker = 0;
				computeSpawnsForCurrentYear();
			}
		}
	} else if (dotSum() === 0) {
		const dif = (maxDots / 5) / dotsToSpawnNextTick;
		ticker += dif;
		dotsToSpawnNextTick *= dif;
	}

	draw();

	if (currentYear >= endYear && dotSum() === 0) {
		reset();
	} else if (!paused) {
		rafId = requestAnimationFrame(tick);
	}
}

function spawnDot(country1, country2) {
	if (!chosenCountries[country1]) return; // country was removed mid-run
	const recips = allRecipientForCountry[country1];
	if (!recips || !recips[country2] || !countryLocations[country1] || !countryLocations[country2]) return;
	const p1 = { x: countryLocations[country1].x, y: countryLocations[country1].y };
	const p2 = { x: countryLocations[country2].x, y: countryLocations[country2].y };

	// Spread the landing point a little around the recipient's anchor. A fixed
	// small radius (in map px), so it never spans a huge country.
	const dAng = Math.random() * Math.PI * 2;
	const dRad = Math.sqrt(Math.random()) * 3 * mapScale;  // uniform within a disk
	const dx = p2.x + Math.cos(dAng) * dRad;
	const dy = p2.y + Math.sin(dAng) * dRad;

	const ang = angle(p1.x, p1.y, p2.x, p2.y);
	let x2 = recips[country2].arcX;
	let y2 = recips[country2].arcY;
	const perp = p1.x < p2.x ? ang - Math.PI * 0.5 : ang + Math.PI * 0.5;
	x2 += Math.cos(perp) * (arcRandomness * Math.random());
	y2 += Math.sin(perp) * (arcRandomness * Math.random());

	// Per-dot variation so the stream doesn't move in lockstep.
	const speedFactor = 0.65 + Math.random() * 0.8;        // ~0.65–1.45
	const rad = dotRad * (0.7 + Math.random() * 0.7);      // ~0.7–1.4 × base
	const startOffset = Math.random() * 6;                 // tiny head start spread

	if (!dots[country1]) dots[country1] = [];
	dots[country1].push([
		chosenCountries[country1], startOffset, distance(p1.x, p1.y, dx, dy),
		p1.x, p1.y, dx, dy, x2, y2, rad, country2, speedFactor, Math.random()
	]);
}

/* ------------------------------------------------------------------ *
 * Glow on hit
 * ------------------------------------------------------------------ */

// glow[recipient] = { supplier -> { i, r, g, b } }. Each supplier's contribution
// decays independently and is composited with "lighten" so two colours combine
// into one stable mix instead of a flickering running average.
function addGlow(recipient, supplier, r, g_, b) {
	let rec = glow[recipient];
	if (!rec) rec = glow[recipient] = {};
	let s = rec[supplier];
	if (!s) s = rec[supplier] = { i: 0, r: r, g: g_, b: b };
	s.r = r; s.g = g_; s.b = b;            // track the supplier's current colour
	s.i = Math.min(s.i + GLOW_HIT, GLOW_MAX);
}

function decayGlow() {
	for (const recip in glow) {
		const rec = glow[recip];
		let any = false;
		for (const sup in rec) {
			rec[sup].i *= GLOW_DECAY;
			if (rec[sup].i < 0.02) delete rec[sup];
			else any = true;
		}
		if (!any) delete glow[recip];
	}
}

function renderGlow(ctx) {
	for (const recip in glow) {
		const rec = glow[recip];
		for (const sup in rec) {
			const s = rec[sup];
			const a = Math.min(GLOW_MAX_ALPHA, s.i);
			// Darkened tint (matches the chosen-country fill) so the bright dots
			// landing on a recipient stay clearly visible on top.
			fillCountryShape(ctx, recip, `rgba(${(s.r * DARK_FACTOR) | 0},${(s.g * DARK_FACTOR) | 0},${(s.b * DARK_FACTOR) | 0},${a})`);
		}
	}
}

/* ------------------------------------------------------------------ *
 * Draw
 * ------------------------------------------------------------------ */

function draw() {
	decayGlow();

	// 1) Pack points in layer order: landing blooms + ripples first (underneath),
	//    then the flying dots on top (same buffers, one draw call).
	ensureDotCapacity(dotSum() + ripples.length);
	let nTotal = 0;
	nTotal = packBlooms(nTotal);
	nTotal = appendRipples(nTotal);
	nTotal = packFlyingDots(nTotal);

	// 2) Glow + timeline pointer on the 2D fx layer.
	fctx.clearRect(0, 0, vw, vh);
	fctx.save();
	fctx.translate(offsetX, offsetY);
	try {
		renderGlow(fctx);
	} finally {
		fctx.restore();
	}
	// Event marks first, then the year pointer on top (so its big year label is
	// never hidden by an event bar), then the hover tooltip above everything.
	drawActiveEvents();
	drawYearPointer();
	drawEventTooltip();

	// 3) Dots + ripples on the GPU, one draw call.
	drawDotsGL(nTotal);
}

// Age the arrival ripples and pack them (as kind=1 points) after the dots.
// `start` is the next free index in the GL buffers. Returns the new total count.
function appendRipples(start) {
	let n = start;
	const minR = dotRad * 0.6;
	const maxR = 9 * mapScale + dotRad;
	for (let i = ripples.length - 1; i >= 0; i--) {
		const rp = ripples[i];
		rp.age++;
		const t = rp.age / RIPPLE_LIFE;
		if (t >= 1) { ripples.splice(i, 1); continue; }
		const radius = minR + (maxR - minR) * t;
		posArr[n * 2] = rp.x;
		posArr[n * 2 + 1] = rp.y;
		colArr[n * 3] = rp.r / 255;
		colArr[n * 3 + 1] = rp.g / 255;
		colArr[n * 3 + 2] = rp.b / 255;
		sizeArr[n] = radius * 2 * dpr; // point size = ring diameter
		parArr[n * 2] = t;             // life -> fades & sizes the ring
		parArr[n * 2 + 1] = 0;
		kindArr[n] = 1;                // ripple
		n++;
	}
	return n;
}

// Pass 1: landed dots linger as a growing, fading bloom. Packed first so they
// render UNDERNEATH the flying dots. Advances the landing age and retires them.
function packBlooms(n) {
	for (const key in dots) {
		const arr = dots[key];
		const col = chosenCountries[key] || (arr.length ? arr[0][0] : null);
		const rgb = col ? rgbNorm(col) : null;
		for (let k = arr.length - 1; k >= 0; k--) {
			const d = arr[k];
			if (d[13] === undefined) continue;          // still flying -> pass 2
			if (!rgb || d[13] >= LAND_LIFE) { arr.splice(k, 1); continue; }
			const lt = d[13] / LAND_LIFE;
			posArr[n * 2] = d[5];
			posArr[n * 2 + 1] = d[6];
			colArr[n * 3] = rgb.r;
			colArr[n * 3 + 1] = rgb.g;
			colArr[n * 3 + 2] = rgb.b;
			sizeArr[n] = d[9] * 2 * dpr * (1 + lt * LAND_GROW); // grows as it lingers
			parArr[n * 2] = lt;      // life -> fade
			parArr[n * 2 + 1] = 0;
			kindArr[n] = 2;          // arrival bloom
			n++;
			d[13]++;
		}
		if (arr.length === 0) delete dots[key];
	}
	return n;
}

// Pass 2: advance the flying dots and pack them last, so they sit on top of the
// blooms/ripples. Arrivals add glow + a ripple and flip into the landing state.
function packFlyingDots(n) {
	for (const key in dots) {
		const arr = dots[key];
		if (arr.length === 0) { delete dots[key]; continue; }
		const col = chosenCountries[key] || arr[0][0];
		if (!col) { delete dots[key]; continue; }
		const rgb = rgbNorm(col);
		for (let k = arr.length - 1; k >= 0; k--) {
			const d = arr[k];
			if (d[13] !== undefined) continue;          // landed -> handled in pass 1
			d[1] += Math.max(3, (d[2] - d[1]) / 50) * dotSpeed / 50 * d[11];
			if (d[1] > d[2]) {
				addGlow(d[10], key, rgb.r * 255, rgb.g * 255, rgb.b * 255);
				if (ripples.length < RIPPLE_CAP) {
					ripples.push({ x: d[5], y: d[6], age: 0, r: rgb.r * 255, g: rgb.g * 255, b: rgb.b * 255 });
				}
				d[13] = 0; // arrived -> blooms from next frame (rendered underneath)
				continue;
			}
			const t = d[1] / d[2];
			const t2 = t * t, ti2 = (1 - t) * (1 - t), tit2 = (1 - t) * 2 * t;
			posArr[n * 2] = ti2 * d[3] + tit2 * d[7] + t2 * d[5];
			posArr[n * 2 + 1] = ti2 * d[4] + tit2 * d[8] + t2 * d[6];
			colArr[n * 3] = rgb.r;
			colArr[n * 3 + 1] = rgb.g;
			colArr[n * 3 + 2] = rgb.b;
			sizeArr[n] = d[9] * 2 * dpr;
			parArr[n * 2] = t;       // progress 0..1 (turbulence envelope)
			parArr[n * 2 + 1] = d[12]; // per-dot seed
			kindArr[n] = 0;          // dot
			n++;
		}
	}
	return n;
}

function ensureDotCapacity(need) {
	if (need <= dotCapacity) return;
	dotCapacity = Math.max(need, Math.ceil(dotCapacity * 1.5) + 1024);
	posArr = new Float32Array(dotCapacity * 2);
	colArr = new Float32Array(dotCapacity * 3);
	sizeArr = new Float32Array(dotCapacity);
	parArr = new Float32Array(dotCapacity * 2);
	kindArr = new Float32Array(dotCapacity);
}

/* ------------------------------------------------------------------ *
 * WebGL dot renderer
 * ------------------------------------------------------------------ */

const DOT_VS = `
	attribute vec2 a_pos;      // map-local px
	attribute vec3 a_color;
	attribute float a_size;    // device px
	attribute vec2 a_param;    // dot: x = progress, y = seed | ripple: x = life t
	attribute float a_kind;    // 0 = dot, 1 = ripple ring
	uniform vec2 u_resolution; // device px
	uniform vec2 u_offset;     // css px
	uniform float u_dpr;
	uniform float u_time;      // seconds
	uniform float u_turb;      // turbulence amplitude (px)
	varying vec3 v_color;
	varying float v_height;    // 0 at endpoints, 1 at the arc's apex
	varying float v_kind;
	varying float v_life;      // ripple life 0..1

	// --- gradient (Perlin-style) value noise, range ~[-1,1] ---
	vec2 hash22(vec2 p) {
		p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
		return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
	}
	float noise(vec2 p) {
		vec2 i = floor(p), f = fract(p);
		vec2 u = f * f * (3.0 - 2.0 * f);
		float a = dot(hash22(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0));
		float b = dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
		float c = dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
		float d = dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
		return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
	}

	void main() {
		v_color = a_color;
		v_kind = a_kind;
		vec2 pos = a_pos;
		float env = 0.0;

		if (a_kind < 0.5) {
			// --- dot: turbulence + arc-height lift ---
			float t = a_param.x;
			float seed = a_param.y;
			env = sin(t * 3.14159265); // no wobble at endpoints, max mid-arc

			// (1) broad, drifting flow field sampled at the dot's own position ->
			// neighbours share an overall current. Low frequency = big soft swirls.
			vec2 np = a_pos * 0.004 + vec2(u_time * 0.05, -u_time * 0.04);
			vec2 flow = 0.2 * vec2(noise(np), noise(np + vec2(37.2, 17.9)));

			// (2) per-dot turbulence keyed by the seed, so two dots in the same spot
			// are pushed differently and jostle apart.
			vec2 sp = vec2(seed * 53.7, seed * 91.3) + vec2(u_time * 0.8, u_time * 0.7);
			flow += 1.2 * vec2(noise(sp), noise(sp + vec2(19.1, 71.3)));

			pos += flow * (u_turb * env);
			gl_PointSize = a_size * (1.0 + env * 0.6); // larger at apex -> lifted
		} else {
			// --- ripple: static expanding ring ---
			v_life = a_param.x;
			gl_PointSize = a_size;
		}
		v_height = env;

		vec2 px = (pos + u_offset) * u_dpr;
		vec2 clip = (px / u_resolution) * 2.0 - 1.0;
		gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
	}`;

const DOT_FS = `
	precision mediump float;
	varying vec3 v_color;
	varying float v_height;
	varying float v_kind;
	varying float v_life;
	uniform sampler2D u_tex;
	uniform float u_useTex;   // 1 = circle_05.png sprite, 0 = procedural shader dot
	void main() {
		float d = length(gl_PointCoord - vec2(0.5)) * 2.0; // 0 centre, 1 edge

		if (v_kind > 1.5) {
			// Arrival bloom: the landed dot lingers, grows (size set on the CPU)
			// and fades out, looking just like the dot but dissolving.
			float ab;
			if (u_useTex > 0.5) ab = texture2D(u_tex, gl_PointCoord).a;
			else { if (d >= 1.0) discard; ab = 1.0 - smoothstep(0.35, 1.0, d); }
			float bcore = 1.0 - smoothstep(0.0, 0.45, d);
			ab = clamp(ab * 0.95 + bcore * 0.4, 0.0, 1.0) * (1.0 - v_life * v_life);
			if (ab <= 0.003) discard;
			gl_FragColor = vec4(mix(v_color, vec3(1.0), bcore * 0.3), ab);
			return;
		}

		if (v_kind > 0.5) {
			// Ripple: a thin ring near the point's edge, fading as it ages/grows.
			float ring = smoothstep(0.74, 0.93, d) * (1.0 - smoothstep(0.93, 1.0, d));
			if (ring <= 0.01) discard;
			gl_FragColor = vec4(v_color, ring * (1.0 - v_life) * 0.6);
			return;
		}

		float a;
		if (u_useTex > 0.5) {
			// Soft sprite defines the dot shape via its alpha.
			a = texture2D(u_tex, gl_PointCoord).a;
		} else {
			// Procedural soft radial dot: solid-ish core, feathered transparent border.
			if (d >= 1.0) discard;
			a = 1.0 - smoothstep(0.35, 1.0, d);
		}
		// Solid bright core fading to a translucent coloured halo.
		float core = 1.0 - smoothstep(0.0, 0.45, d);
		a = clamp(a * 0.95 + core * 0.4, 0.0, 1.0);
		if (a <= 0.003) discard;
		vec3 col = mix(v_color, vec3(1.0), core * 0.3); // bright highlight at centre
		// Arc-height lighting: a little dimmer near the ground, brighter at the apex,
		// so the dots read as rising up off the flat map and settling back down.
		col *= 0.85 + v_height * 0.3;
		gl_FragColor = vec4(col, a);
	}`;

function initGL() {
	gl = glCanvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: true })
		|| glCanvas.getContext("experimental-webgl", { alpha: true, premultipliedAlpha: false });
	if (!gl) { console.warn("WebGL unavailable — dots disabled."); return; }

	const vs = compileShader(gl.VERTEX_SHADER, DOT_VS);
	const fs = compileShader(gl.FRAGMENT_SHADER, DOT_FS);
	glProgram = gl.createProgram();
	gl.attachShader(glProgram, vs);
	gl.attachShader(glProgram, fs);
	gl.linkProgram(glProgram);
	if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
		console.warn("Shader link failed:", gl.getProgramInfoLog(glProgram));
		gl = null; return;
	}
	glLoc = {
		a_pos: gl.getAttribLocation(glProgram, "a_pos"),
		a_color: gl.getAttribLocation(glProgram, "a_color"),
		a_size: gl.getAttribLocation(glProgram, "a_size"),
		a_param: gl.getAttribLocation(glProgram, "a_param"),
		a_kind: gl.getAttribLocation(glProgram, "a_kind"),
		u_resolution: gl.getUniformLocation(glProgram, "u_resolution"),
		u_offset: gl.getUniformLocation(glProgram, "u_offset"),
		u_dpr: gl.getUniformLocation(glProgram, "u_dpr"),
		u_time: gl.getUniformLocation(glProgram, "u_time"),
		u_turb: gl.getUniformLocation(glProgram, "u_turb"),
		u_tex: gl.getUniformLocation(glProgram, "u_tex"),
		u_useTex: gl.getUniformLocation(glProgram, "u_useTex")
	};
	glPosBuf = gl.createBuffer();
	glColBuf = gl.createBuffer();
	glSizeBuf = gl.createBuffer();
	glParBuf = gl.createBuffer();
	glKindBuf = gl.createBuffer();
	glStartTime = performance.now();
	loadDotTexture("circle_05.png");

	gl.disable(gl.DEPTH_TEST);
	gl.enable(gl.BLEND);
	// Normal alpha blending: overlapping translucent dots build opacity toward the
	// saturated base colour instead of summing to white.
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

function loadDotTexture(src) {
	const img = new Image();
	img.onload = () => {
		dotTexture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, dotTexture);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	};
	img.src = src;
}

function compileShader(type, src) {
	const s = gl.createShader(type);
	gl.shaderSource(s, src);
	gl.compileShader(s);
	if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
		console.warn("Shader compile error:", gl.getShaderInfoLog(s));
	}
	return s;
}

function drawDotsGL(count) {
	if (!gl) return;
	gl.clear(gl.COLOR_BUFFER_BIT);
	if (count <= 0) return;

	// Texture mode needs the sprite loaded; otherwise fall back to the shader dot.
	const useTex = (dotRenderMode === "texture" && dotTexture) ? 1 : 0;

	gl.useProgram(glProgram);
	gl.activeTexture(gl.TEXTURE0);
	if (dotTexture) gl.bindTexture(gl.TEXTURE_2D, dotTexture);
	gl.uniform1i(glLoc.u_tex, 0);
	gl.uniform1f(glLoc.u_useTex, useTex);
	gl.uniform2f(glLoc.u_resolution, glCanvas.width, glCanvas.height);
	gl.uniform2f(glLoc.u_offset, offsetX, offsetY);
	gl.uniform1f(glLoc.u_dpr, dpr);
	gl.uniform1f(glLoc.u_time, (performance.now() - glStartTime) / 1000);
	gl.uniform1f(glLoc.u_turb, turbulence);

	gl.bindBuffer(gl.ARRAY_BUFFER, glPosBuf);
	gl.bufferData(gl.ARRAY_BUFFER, posArr.subarray(0, count * 2), gl.DYNAMIC_DRAW);
	gl.enableVertexAttribArray(glLoc.a_pos);
	gl.vertexAttribPointer(glLoc.a_pos, 2, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, glColBuf);
	gl.bufferData(gl.ARRAY_BUFFER, colArr.subarray(0, count * 3), gl.DYNAMIC_DRAW);
	gl.enableVertexAttribArray(glLoc.a_color);
	gl.vertexAttribPointer(glLoc.a_color, 3, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, glSizeBuf);
	gl.bufferData(gl.ARRAY_BUFFER, sizeArr.subarray(0, count), gl.DYNAMIC_DRAW);
	gl.enableVertexAttribArray(glLoc.a_size);
	gl.vertexAttribPointer(glLoc.a_size, 1, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, glParBuf);
	gl.bufferData(gl.ARRAY_BUFFER, parArr.subarray(0, count * 2), gl.DYNAMIC_DRAW);
	gl.enableVertexAttribArray(glLoc.a_param);
	gl.vertexAttribPointer(glLoc.a_param, 2, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, glKindBuf);
	gl.bufferData(gl.ARRAY_BUFFER, kindArr.subarray(0, count), gl.DYNAMIC_DRAW);
	gl.enableVertexAttribArray(glLoc.a_kind);
	gl.vertexAttribPointer(glLoc.a_kind, 1, gl.FLOAT, false, 0, 0);

	gl.drawArrays(gl.POINTS, 0, count);
}

/* ------------------------------------------------------------------ *
 * Math helpers
 * ------------------------------------------------------------------ */

function angle(x1, y1, x2, y2) { return Math.atan2(y2 - y1, x2 - x1); }
function distance(x1, y1, x2, y2) { return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2); }
function nFormatter(num) {
	if (num >= 1e9) return (num / 1e9).toFixed(1) + "B";
	if (num >= 1e6) return (num / 1e6).toFixed(1) + "M";
	if (num >= 1e3) return (num / 1e3).toFixed(1) + "k";
	return Math.round(num);
}

/* ------------------------------------------------------------------ *
 * UI
 * ------------------------------------------------------------------ */

function initStaticUI() {
	document.getElementById("playBtn").onclick = togglePlay;
	document.getElementById("resetBtn").onclick = reset;

	const seg = document.getElementById("modeSeg");
	seg.querySelectorAll("button").forEach(b => {
		b.onclick = () => {
			seg.querySelectorAll("button").forEach(x => x.classList.remove("active"));
			b.classList.add("active");
			spawnMode = b.dataset.mode;
			if (!paused) { /* will pick up next year */ } else seekToFraction(currentSeekFraction());
		};
	});

	const startEl = document.getElementById("startYear");
	const endEl = document.getElementById("endYear");
	const updateYears = () => {
		startYear = parseInt(startEl.value);
		endYear = parseInt(endEl.value);
		if (endYear <= startYear) {
			if (document.activeElement === startEl) { endYear = startYear + 1; endEl.value = endYear; }
			else { startYear = endYear - 1; startEl.value = startYear; }
		}
		document.getElementById("yearRangeLabel").textContent = `${startYear}–${endYear}`;
		currentYear = Math.max(startYear, Math.min(endYear, currentYear));
		drawStatic();
		reset();
	};
	startEl.oninput = updateYears;
	endEl.oninput = updateYears;
	document.getElementById("yearRangeLabel").textContent = `${startYear}–${endYear}`;

	const search = document.getElementById("countrySearch");
	const list = document.getElementById("countryList");
	search.oninput = () => { buildCountryList(); list.classList.toggle("open", search.value.length > 0); };
	search.onfocus = () => { if (search.value.length > 0) list.classList.add("open"); };
	search.onblur = () => setTimeout(() => list.classList.remove("open"), 150);

	document.getElementById("panelToggle").onclick = () =>
		document.getElementById("panel").classList.toggle("collapsed");

	document.getElementById("descriptionLink").onclick = (e) => {
		e.preventDefault();
		document.getElementById("descriptionDiv").classList.add("open");
	};
	document.getElementById("closeDescription").onclick = () =>
		document.getElementById("descriptionDiv").classList.remove("open");

	buildAdvanced();
}

function setPlayLabel(playing) {
	document.getElementById("playBtn").textContent = playing ? "Pause" : "Play";
}

function currentSeekFraction() {
	const span = endYear - startYear;
	return ((currentYear - startYear) + ticker / ticksPerYear) / span;
}

function buildCountryList() {
	const list = document.getElementById("countryList");
	const q = document.getElementById("countrySearch").value.trim().toLowerCase();
	const names = Object.keys(allCountriesByValue)
		.filter(n => !chosenCountries[n])
		.filter(n => !q || n.toLowerCase().includes(q))
		.sort((a, b) => allCountriesByValue[b] - allCountriesByValue[a]);

	list.innerHTML = "";
	for (const name of names.slice(0, 60)) {
		const row = document.createElement("div");
		row.className = "pick";
		row.innerHTML = `<span>${name}</span><span class="val">${nFormatter(allCountriesByValue[name])} M$</span>`;
		row.onmousedown = (e) => {
			e.preventDefault();
			chooseCountry(name);
			document.getElementById("countrySearch").value = "";
			list.classList.remove("open");
		};
		list.appendChild(row);
	}
}

function renderChosen() {
	const cont = document.getElementById("chosenList");
	cont.innerHTML = "";
	const keys = Object.keys(chosenCountries);
	document.getElementById("chosenCount").textContent = keys.length ? `(${keys.length})` : "";
	for (const name of keys) {
		const chip = document.createElement("div");
		chip.className = "chip";

		const swatch = document.createElement("input");
		swatch.type = "color";
		swatch.className = "swatch";
		swatch.value = toHex(chosenCountries[name]);
		swatch.oninput = () => recolorCountry(name, swatch.value);

		const label = document.createElement("span");
		label.textContent = name;

		const rem = document.createElement("span");
		rem.className = "remove";
		rem.textContent = "×";
		rem.title = "Remove";
		rem.onclick = () => removeCountry(name);

		chip.appendChild(swatch);
		chip.appendChild(label);
		chip.appendChild(rem);
		cont.appendChild(chip);
	}
}

function toHex(col) {
	if (col[0] === "#") return col.length === 7 ? col : col;
	const c = parseColor(col);
	const h = n => n.toString(16).padStart(2, "0");
	return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/* --- Advanced controls --- */

function buildAdvanced() {
	const body = document.querySelector("#advanced .adv-body");

	const sliders = [
		// Higher = faster playback. Maps inversely to ticks-per-year (4500/speed).
		{ label: "Speed", min: 1, max: 100, step: 1, val: 30, set: v => ticksPerYear = Math.max(5, Math.round(4500 / v)) },
		{ label: "Value / dot (M$)", min: 0.1, max: 100, step: 0.1, val: valueDenominator, set: v => valueDenominator = v },
		{ label: "Dot radius", min: 0.5, max: 10, step: 0.1, val: dotRad, set: v => dotRad = v },
		{ label: "Dot speed", min: 10, max: 100, step: 1, val: dotSpeed, set: v => dotSpeed = v },
		{ label: "Arc spread", min: 0, max: 60, step: 1, val: arcRandomness, set: v => arcRandomness = v },
		{ label: "Turbulence", min: 0, max: 150, step: 1, val: turbulence, set: v => turbulence = v }
	];
	for (const s of sliders) body.appendChild(makeSlider(s));

	// Dot style: textured sprite vs procedural shader dot.
	const toggle = document.createElement("div");
	toggle.className = "adv-toggle";
	toggle.innerHTML = `<span>Dot style</span>`;
	const seg = document.createElement("div");
	seg.className = "segmented";
	[["texture", "Sprite"], ["shader", "Shader"]].forEach(([mode, lbl]) => {
		const b = document.createElement("button");
		b.textContent = lbl;
		if (mode === dotRenderMode) b.classList.add("active");
		b.onclick = () => {
			seg.querySelectorAll("button").forEach(x => x.classList.remove("active"));
			b.classList.add("active");
			dotRenderMode = mode;
		};
		seg.appendChild(b);
	});
	toggle.appendChild(seg);
	body.appendChild(toggle);

	// Event map-labels on/off (timeline marks stay — hover them for names).
	const evToggle = document.createElement("div");
	evToggle.className = "adv-toggle";
	evToggle.innerHTML = `<span>Event map labels</span>`;
	const evSeg = document.createElement("div");
	evSeg.className = "segmented";
	[["on", "On"], ["off", "Off"]].forEach(([mode, lbl]) => {
		const b = document.createElement("button");
		b.textContent = lbl;
		if ((mode === "on") === showEvents) b.classList.add("active");
		b.onclick = () => {
			evSeg.querySelectorAll("button").forEach(x => x.classList.remove("active"));
			b.classList.add("active");
			showEvents = (mode === "on");
			drawStatic();
			draw();
		};
		evSeg.appendChild(b);
	});
	evToggle.appendChild(evSeg);
	body.appendChild(evToggle);

	// Per-category visibility chips (click to hide/show each event type).
	const cats = [
		["war", "Wars"], ["crisis", "Crises"], ["political", "Political"],
		["treaty", "Treaties"], ["embargo", "Embargoes"]
	];
	const catWrap = document.createElement("div");
	catWrap.className = "cat-toggles";
	for (const [cat, label] of cats) {
		const col = EVENT_COLORS[cat];
		const chip = document.createElement("button");
		chip.type = "button";
		chip.className = "cat-toggle";
		const dot = document.createElement("span");
		dot.className = "dot";
		const txt = document.createElement("span");
		txt.textContent = label;
		chip.appendChild(dot);
		chip.appendChild(txt);
		const sync = () => {
			const on = categoryOn[cat] !== false;
			chip.classList.toggle("off", !on);
			dot.style.background = on ? col : "transparent";
			dot.style.boxShadow = on ? "none" : `inset 0 0 0 1.6px ${col}`;
		};
		chip.onclick = () => {
			categoryOn[cat] = categoryOn[cat] === false;
			sync();
			drawStatic();
			draw();
		};
		sync();
		catWrap.appendChild(chip);
	}
	body.appendChild(catWrap);
}

function makeSlider({ label, min, max, step, val, set }) {
	const wrap = document.createElement("div");
	wrap.className = "slider";
	const head = document.createElement("div");
	head.className = "slabel";
	head.innerHTML = `<span>${label}</span><span class="sval">${val}</span>`;
	const input = document.createElement("input");
	input.type = "range";
	input.min = min; input.max = max; input.step = step; input.value = val;
	input.oninput = () => {
		const v = parseFloat(input.value);
		head.querySelector(".sval").textContent = v;
		set(v);
	};
	wrap.appendChild(head);
	wrap.appendChild(input);
	return wrap;
}
