import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  DEFAULT_BUILDING_HEIGHT_M,
  EMPTY_ARRAY,
  HOVER_CELL_OUTLINE,
  SELECTED_CELL_OUTLINE,
} from "../constants";

const SCENE_MODEL_CACHE_LIMIT = 3;
const sceneModelCache = new Map();

export function hasCachedSceneModel(bounds) {
  if (!bounds) {
    return false;
  }

  return sceneModelCache.get(sceneBoundsKey(bounds))?.status === "ready";
}

export default function Scene3DPreview({
  antennas = EMPTY_ARRAY,
  bounds,
  className = "",
  coverageGrid = null,
  coverageDisplayMode = "quality",
  coverageImageUrl = "",
  onCoverageCellSelect = null,
  onLoadingChange = null,
  onRsrpUserSelect = null,
  rsrpUsers = EMPTY_ARRAY,
  sceneName,
  selectedCoverageCell = null,
  selectedRsrpUser = null,
  showOverlay = true,
  signalLinks = EMPTY_ARRAY,
  solver = null,
  viewMode = "oblique",
}) {
  const canvasHostRef = useRef(null);
  const selectedCoverageCellRef = useRef(selectedCoverageCell);
  const selectedRsrpUserRef = useRef(selectedRsrpUser);
  const [model, setModel] = useState(null);
  const [status, setStatus] = useState("Loading OSM buildings...");
  const boundsKey = sceneBoundsKey(bounds);

  useEffect(() => {
    selectedCoverageCellRef.current = selectedCoverageCell;
  }, [selectedCoverageCell]);

  useEffect(() => {
    selectedRsrpUserRef.current = selectedRsrpUser;
  }, [selectedRsrpUser]);

  useEffect(() => {
    if (!bounds) {
      setModel(null);
      setStatus("No scene bounds available.");
      onLoadingChange?.(false);
      return undefined;
    }

    const cachedModel = sceneModelCache.get(boundsKey);
    if (cachedModel?.status === "ready") {
      setModel(cachedModel.model);
      setStatus(cachedModel.message);
      onLoadingChange?.(false);
      return undefined;
    }

    const controller = new AbortController();
    let isActive = true;
    let loadingReported = false;

    function reportLoading(nextValue) {
      if (loadingReported === nextValue) {
        return;
      }

      loadingReported = nextValue;
      onLoadingChange?.(nextValue);
    }

    async function loadBuildings() {
      setModel(null);
      setStatus("Loading OSM buildings...");
      reportLoading(true);

      try {
        const cachedOrLoadedModel = await loadSceneModel(
          boundsKey,
          bounds,
          controller.signal,
        );

        if (!isActive) {
          return;
        }

        setModel(cachedOrLoadedModel.model);
        setStatus(cachedOrLoadedModel.message);
        reportLoading(false);
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        if (!isActive) {
          return;
        }

        setModel(buildModel(bounds, []));
        setStatus("OSM building lookup failed. Try refreshing or selecting a smaller area.");
        reportLoading(false);
      }
    }

    loadBuildings();

    return () => {
      isActive = false;
      controller.abort();
      reportLoading(false);
    };
  }, [boundsKey, onLoadingChange]);

  useEffect(() => {
    const host = canvasHostRef.current;

    if (!host || !model) {
      return undefined;
    }

    return renderThreeScene(
      host,
      model,
      viewMode,
      antennas,
      solver,
      coverageGrid,
      coverageDisplayMode,
      coverageImageUrl,
      signalLinks,
      rsrpUsers,
      selectedCoverageCellRef,
      selectedRsrpUserRef,
      onCoverageCellSelect,
      onRsrpUserSelect,
    );
  }, [antennas, coverageDisplayMode, coverageGrid, coverageImageUrl, model, onCoverageCellSelect, onRsrpUserSelect, rsrpUsers, signalLinks, solver, viewMode]);

  return (
    <div className={["scene-3d-preview", className].filter(Boolean).join(" ")}>
      <div ref={canvasHostRef} className="scene-3d-canvas" />
      {showOverlay && (
        <div className="scene-3d-overlay">
          <strong>{sceneName || "Selected scene"}</strong>
          <span>{status}</span>
        </div>
      )}
    </div>
  );
}

function sceneBoundsKey(bounds) {
  return bounds
    ? [bounds.south, bounds.west, bounds.north, bounds.east].join(":")
    : "";
}

async function loadSceneModel(boundsKey, bounds, signal) {
  const cachedModel = sceneModelCache.get(boundsKey);

  if (cachedModel?.status === "ready") {
    return cachedModel;
  }

  const buildings = await fetchBuildingsWithRetry(bounds, signal);
  const nextModel = {
    message: buildings.length
      ? buildHeightStatus(buildings)
      : "No OSM building footprints found for this area.",
    model: buildModel(bounds, buildings),
    status: "ready",
  };

  setSceneModelCache(boundsKey, nextModel);
  return nextModel;
}

function setSceneModelCache(boundsKey, value) {
  if (!boundsKey || value?.status !== "ready") {
    return;
  }

  sceneModelCache.delete(boundsKey);
  sceneModelCache.set(boundsKey, {
    message: value.message,
    model: value.model,
    status: "ready",
  });

  while (sceneModelCache.size > SCENE_MODEL_CACHE_LIMIT) {
    const oldestKey = sceneModelCache.keys().next().value;
    sceneModelCache.delete(oldestKey);
  }
}

async function fetchBuildings(bounds, signal) {
  const query = `
    [out:json][timeout:25];
    (
      way["building"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
      relation["building"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
    );
    out tags geom;
  `;
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({ data: query }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  return (data.elements || [])
    .flatMap((item, index) => parseOsmElement(item, index))
    .filter((building) => building.points.length >= 3);
}

async function fetchBuildingsWithRetry(bounds, signal, retries = 1) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchBuildings(bounds, signal);
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }

      lastError = error;

      if (attempt < retries) {
        await waitForRetry(700, signal);
      }
    }
  }

  throw lastError;
}

function waitForRetry(delayMs, signal) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(resolve, delayMs);

    if (!signal) {
      return;
    }

    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeoutId);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function parseOsmElement(item, index) {
  if (Array.isArray(item.geometry) && item.geometry.length >= 3) {
    return [buildBuildingRecord(item.id || `osm-${index}`, item.tags, item.geometry)];
  }

  if (Array.isArray(item.members)) {
    return item.members
      .filter((member) => member.role === "outer" && Array.isArray(member.geometry) && member.geometry.length >= 3)
      .map((member, memberIndex) => (
        buildBuildingRecord(`${item.id || index}-${memberIndex}`, item.tags, member.geometry)
      ));
  }

  return [];
}

function buildBuildingRecord(id, tags = {}, geometry) {
  const heightInfo = inferBuildingHeight(tags);

  return {
    id,
    tags,
    height: heightInfo.height,
    heightSource: heightInfo.source,
    points: geometry.map((point) => ({
      lat: point.lat,
      lon: point.lon,
    })),
  };
}

function inferBuildingHeight(tags = {}) {
  const explicitHeight = parseMeters(tags.height || tags["building:height"]);
  if (Number.isFinite(explicitHeight) && explicitHeight > 0) {
    return {
      height: clamp(explicitHeight, 2.5, 160),
      source: "exact",
    };
  }

  const minHeight = parseMeters(tags.min_height || tags["building:min_height"]);
  const roofHeight = parseMeters(tags["roof:height"]);
  const levels = parseFloat(tags["building:levels"] || tags.levels);
  if (Number.isFinite(levels) && levels > 0) {
    return {
      height: clamp((levels * 3.1) + (Number.isFinite(roofHeight) ? roofHeight : 0) + (Number.isFinite(minHeight) ? minHeight : 0), 2.5, 160),
      source: "levels",
    };
  }

  return {
    height: estimateHeightFromType(tags),
    source: "estimated",
  };
}

function estimateHeightFromType(tags = {}) {
  const type = String(tags.building || "").toLowerCase();

  if (["apartments", "residential", "hotel", "dormitory"].includes(type)) {
    return 18;
  }

  if (["office", "commercial", "retail", "public", "hospital"].includes(type)) {
    return 16;
  }

  if (["industrial", "warehouse", "manufacture"].includes(type)) {
    return 10;
  }

  if (["house", "detached", "semidetached_house", "terrace", "garage"].includes(type)) {
    return 7;
  }

  if (["church", "cathedral", "temple"].includes(type)) {
    return 24;
  }

  return DEFAULT_BUILDING_HEIGHT_M;
}

function parseMeters(value) {
  if (value === null || value === undefined || value === "") {
    return NaN;
  }

  const text = String(value).trim().toLowerCase();
  const numeric = parseFloat(text.replace(",", "."));

  if (!Number.isFinite(numeric)) {
    return NaN;
  }

  if (text.includes("ft") || text.includes("feet")) {
    return numeric * 0.3048;
  }

  return numeric;
}

function buildModel(bounds, buildings) {
  const centerLat = (bounds.south + bounds.north) / 2;
  const centerLon = (bounds.west + bounds.east) / 2;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.max(Math.cos(centerLat * Math.PI / 180), 0.01);
  const widthM = Math.max((bounds.east - bounds.west) * metersPerDegreeLon, 1);
  const heightM = Math.max((bounds.north - bounds.south) * metersPerDegreeLat, 1);
  const maxSide = Math.max(widthM, heightM);
  const scale = 460 / maxSide;

  const projected = buildings
    .map((building) => {
      const points = building.points.map((point) => ({
        x: (point.lon - centerLon) * metersPerDegreeLon * scale,
        z: -(point.lat - centerLat) * metersPerDegreeLat * scale,
      }));

      return {
        height: building.height,
        heightSource: building.heightSource,
        id: building.id,
        points: removeDuplicateClosingPoint(points),
        heightScaled: building.height * scale,
      };
    })
    .filter((building) => polygonArea(building.points) > 0.01);

  return {
    buildings: projected,
    width: widthM * scale,
    depth: heightM * scale,
    scale,
  };
}

function renderThreeScene(
  host,
  model,
  viewMode,
  antennas,
  solver,
  coverageGrid,
  coverageDisplayMode,
  coverageImageUrl,
  signalLinks,
  rsrpUsers,
  selectedCoverageCellRef,
  selectedRsrpUserRef,
  onCoverageCellSelect,
  onRsrpUserSelect,
) {
  host.innerHTML = "";

  const width = host.clientWidth || 820;
  const height = host.clientHeight || 430;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xedf2f7);

  const maxSide = Math.max(model.width, model.depth);
  const camera = viewMode === "top"
    ? createTopCamera(width, height, maxSide)
    : new THREE.PerspectiveCamera(42, width / height, 0.1, 4000);

  if (viewMode === "top") {
    camera.position.set(maxSide * 0.24, maxSide * 1.38, maxSide * 0.28);
  } else {
    camera.position.set(model.width * 0.55, maxSide * 0.72, model.depth * 0.9);
  }

  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  host.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.enableRotate = true;
  controls.minDistance = 80;
  controls.maxDistance = 1600;
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = Math.PI / 2.02;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(-180, 260, 120);
  sun.castShadow = true;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(model.width, 2, model.depth),
    new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.86 }),
  );
  ground.position.y = -1;
  ground.receiveShadow = true;
  scene.add(ground);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(model.width, 2, model.depth)),
    new THREE.LineBasicMaterial({ color: 0x2563eb }),
  );
  edge.position.y = -0.5;
  scene.add(edge);

  addRoadLines(scene, model);
  const coverageMesh = (
    addCoverageGrid(scene, model, coverageGrid, solver, coverageDisplayMode)
    || addCoverageImage(scene, model, coverageImageUrl)
  );
  const selectedCellGroup = new THREE.Group();
  const hoveredCellGroup = new THREE.Group();
  scene.add(selectedCellGroup);
  scene.add(hoveredCellGroup);
  let lastSelectedCell = null;
  let lastHoveredCell = null;

  model.buildings.forEach((building) => {
    const mesh = createBuildingMesh(building);
    if (mesh) {
      scene.add(mesh);
    }
  });

  addAntennas(scene, model, antennas, solver);
  addSignalLinks(scene, model, signalLinks, solver);
  const rsrpUserObjects = addRsrpUsers(scene, model, rsrpUsers, solver);
  const selectedRsrpUserGroup = new THREE.Group();
  scene.add(selectedRsrpUserGroup);
  let lastSelectedRsrpUser = null;

  const observer = new ResizeObserver(() => {
    const nextWidth = host.clientWidth || width;
    const nextHeight = host.clientHeight || height;
    updateCameraForSize(camera, viewMode, nextWidth, nextHeight, maxSide);
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight);
  });
  observer.observe(host);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerStart = null;

  function handlePointerDown(event) {
    pointerStart = {
      x: event.clientX,
      y: event.clientY,
    };
  }

  function setHoveredCell(cell) {
    if (cell === lastHoveredCell) {
      return;
    }

    updateCellOutlineGroup(hoveredCellGroup, model, cell, solver, HOVER_CELL_OUTLINE);
    lastHoveredCell = cell;
    renderer.domElement.style.cursor = cell ? "pointer" : "";
  }

  function handlePointerMove(event) {
    if (event.buttons !== 0) {
      setHoveredCell(null);
      return;
    }

    const user = pickRsrpUserFromEvent(
      event,
      renderer,
      camera,
      raycaster,
      pointer,
      rsrpUserObjects,
    );

    if (user) {
      setHoveredCell(null);
      renderer.domElement.style.cursor = "pointer";
      return;
    }

    setHoveredCell(pickCoverageCellFromEvent(
      event,
      renderer,
      camera,
      raycaster,
      pointer,
      coverageMesh,
      model,
      coverageGrid,
      solver,
    ));
  }

  function handlePointerLeave() {
    pointerStart = null;
    setHoveredCell(null);
  }

  function handlePointerUp(event) {
    if (!pointerStart) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - pointerStart.x,
      event.clientY - pointerStart.y,
    );
    pointerStart = null;

    if (distance > 5) {
      return;
    }

    const user = pickRsrpUserFromEvent(
      event,
      renderer,
      camera,
      raycaster,
      pointer,
      rsrpUserObjects,
    );

    if (user && onRsrpUserSelect) {
      onRsrpUserSelect(user);
      return;
    }

    if (!onCoverageCellSelect) {
      return;
    }

    const cell = pickCoverageCellFromEvent(
      event,
      renderer,
      camera,
      raycaster,
      pointer,
      coverageMesh,
      model,
      coverageGrid,
      solver,
    );
    if (cell) {
      onCoverageCellSelect(cell);
    }
  }

  renderer.domElement.addEventListener("pointerdown", handlePointerDown);
  renderer.domElement.addEventListener("pointermove", handlePointerMove);
  renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
  renderer.domElement.addEventListener("pointerup", handlePointerUp);

  let animationId = 0;
  function animate() {
    controls.update();
    syncSelectedCellOutline(selectedCellGroup, model, selectedCoverageCellRef, solver, lastSelectedCell, (cell) => {
      lastSelectedCell = cell;
    });
    syncSelectedRsrpUserOutline(selectedRsrpUserGroup, model, selectedRsrpUserRef, solver, lastSelectedRsrpUser, (user) => {
      lastSelectedRsrpUser = user;
    });
    renderer.render(scene, camera);
    animationId = window.requestAnimationFrame(animate);
  }
  animate();

  return () => {
    window.cancelAnimationFrame(animationId);
    observer.disconnect();
    controls.dispose();
    renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
    renderer.domElement.removeEventListener("pointermove", handlePointerMove);
    renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
    renderer.domElement.removeEventListener("pointerup", handlePointerUp);
    renderer.dispose();
    scene.traverse((object) => {
      if (object.geometry) {
        object.geometry.dispose();
      }
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(disposeMaterial);
        } else {
          disposeMaterial(object.material);
        }
      }
    });
    host.innerHTML = "";
  };
}

function syncSelectedCellOutline(group, model, selectedCoverageCellRef, solver, lastSelectedCell, setLastSelectedCell) {
  const cell = selectedCoverageCellRef?.current || null;

  if (cell === lastSelectedCell) {
    return;
  }

  updateCellOutlineGroup(group, model, cell, solver, SELECTED_CELL_OUTLINE);
  setLastSelectedCell(cell);
}

function updateCellOutlineGroup(group, model, cell, solver, style) {
  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    disposeThreeObject(child);
  }

  addCellOutline(group, model, cell, solver, style);
}

function addCoverageGrid(scene, model, grid, solver, coverageDisplayMode) {
  if (!grid || !Array.isArray(grid.cells) || !solver) {
    return;
  }

  const texture = createCoverageTexture(grid, coverageDisplayMode);

  if (!texture) {
    return;
  }

  const geometry = new THREE.PlaneGeometry(model.width, model.depth);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 1.8;
  mesh.renderOrder = 5;
  scene.add(mesh);
  return mesh;
}

function addCoverageImage(scene, model, imageUrl) {
  if (!imageUrl) {
    return null;
  }

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(model.width, model.depth),
    material,
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 1.8;
  mesh.renderOrder = 5;
  scene.add(mesh);

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  loader.load(
    imageUrl,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      material.map = texture;
      material.needsUpdate = true;
    },
    undefined,
    () => {
      material.color.set(0x60a5fa);
      material.opacity = 0.22;
    },
  );

  return mesh;
}

function addCellOutline(scene, model, cell, solver, style) {
  if (!cell || !solver) {
    return;
  }

  const sizeX = solver.size?.[0] || 300;
  const sizeY = solver.size?.[1] || 300;
  const centerX = solver.center?.[0] || 0;
  const centerY = solver.center?.[1] || 0;
  const cellWidth = Math.max(((solver.cell_size || 5) / sizeX) * model.width, 0.6);
  const cellDepth = Math.max(((solver.cell_size || 5) / sizeY) * model.depth, 0.6);
  const x = ((numericValue(cell.x) - centerX) / sizeX) * model.width;
  const z = -((numericValue(cell.y) - centerY) / sizeY) * model.depth;

  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return;
  }

  const y = style.y;
  const points = [
    new THREE.Vector3(x - cellWidth / 2, y, z - cellDepth / 2),
    new THREE.Vector3(x + cellWidth / 2, y, z - cellDepth / 2),
    new THREE.Vector3(x + cellWidth / 2, y, z + cellDepth / 2),
    new THREE.Vector3(x - cellWidth / 2, y, z + cellDepth / 2),
    new THREE.Vector3(x - cellWidth / 2, y, z - cellDepth / 2),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color: style.lineColor,
      linewidth: 2,
    }),
  );
  line.renderOrder = style.renderOrder;
  scene.add(line);

  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(cellWidth, cellDepth),
    new THREE.MeshBasicMaterial({
      color: style.fillColor,
      transparent: true,
      opacity: style.fillOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.set(x, y - 0.05, z);
  fill.renderOrder = style.renderOrder - 1;
  scene.add(fill);
}

function disposeThreeObject(object) {
  if (object.geometry) {
    object.geometry.dispose();
  }

  if (Array.isArray(object.material)) {
    object.material.forEach(disposeMaterial);
  } else if (object.material) {
    disposeMaterial(object.material);
  }
}

function disposeMaterial(material) {
  if (material.map) {
    material.map.dispose();
  }

  material.dispose();
}

function createCoverageTexture(grid, coverageDisplayMode) {
  const rows = Number(grid.rows);
  const cols = Number(grid.cols);

  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows <= 0 || cols <= 0) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, cols, rows);

  grid.cells.forEach((cell) => {
    const row = Number(cell.row);
    const col = Number(cell.col);

    if (!Number.isInteger(row) || !Number.isInteger(col)) {
      return;
    }

    context.fillStyle = colorForCoverageCell(cell, coverageDisplayMode);
    context.fillRect(col, rows - row - 1, 1, 1);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function findCoverageCellAtPoint(point, model, grid, solver) {
  const sizeX = solver.size?.[0] || 300;
  const sizeY = solver.size?.[1] || 300;
  const centerX = solver.center?.[0] || 0;
  const centerY = solver.center?.[1] || 0;
  const cellSize = solver.cell_size || 5;
  const xMin = centerX - sizeX / 2;
  const yMin = centerY - sizeY / 2;
  const worldX = (point.x / model.width) * sizeX + centerX;
  const worldY = -(point.z / model.depth) * sizeY + centerY;
  const col = Math.floor((worldX - xMin) / cellSize);
  const row = Math.floor((worldY - yMin) / cellSize);

  return grid.cells.find((cell) => (
    Number(cell.row) === row
    && Number(cell.col) === col
  ));
}

function pickCoverageCellFromEvent(
  event,
  renderer,
  camera,
  raycaster,
  pointer,
  coverageMesh,
  model,
  coverageGrid,
  solver,
) {
  if (!coverageMesh || !coverageGrid || !solver) {
    return null;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  raycaster.setFromCamera(pointer, camera);

  const hit = raycaster.intersectObject(coverageMesh, false)[0];
  if (!hit) {
    return null;
  }

  return findCoverageCellAtPoint(hit.point, model, coverageGrid, solver) || null;
}

function addAntennas(scene, model, antennas, solver) {
  if (!Array.isArray(antennas) || !solver) {
    return;
  }

  const group = new THREE.Group();

  antennas.forEach((antenna, index) => {
    const position = scenePointFromWorld(model, solver, antenna.position, 0);

    if (!position) {
      return;
    }

    const mastHeight = clamp((antenna.position[2] || 25) * model.scale, 18, 74);
    const marker = createAntennaObject(antenna, index, mastHeight);
    marker.position.set(position.x, 0, position.z);
    group.add(marker);
  });

  scene.add(group);
}

function createAntennaObject(antenna, index, mastHeight) {
  const group = new THREE.Group();
  const palette = antennaPalette(antenna.id);
  const mastMaterial = new THREE.MeshStandardMaterial({ color: palette.mast, roughness: 0.55 });
  const headMaterial = new THREE.MeshStandardMaterial({ color: palette.head, roughness: 0.4 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.6 });

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(2, 2, mastHeight, 12),
    mastMaterial,
  );
  mast.position.y = mastHeight / 2;
  mast.castShadow = true;
  group.add(mast);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(6, 20, 20),
    headMaterial,
  );
  head.position.y = mastHeight + 4;
  head.castShadow = true;
  group.add(head);

  const azimuthRad = ((antenna.azimuth || 0) * Math.PI) / 180;
  const dirX = Math.sin(azimuthRad);
  const dirZ = -Math.cos(azimuthRad);
  const arrowLength = 28;
  const arrowGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, mastHeight + 4, 0),
    new THREE.Vector3(dirX * arrowLength, mastHeight + 4, dirZ * arrowLength),
  ]);
  const arrow = new THREE.Line(
    arrowGeometry,
    new THREE.LineBasicMaterial({ color: palette.mast, linewidth: 2 }),
  );
  group.add(arrow);

  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(4, 10, 16),
    mastMaterial,
  );
  cone.position.set(dirX * arrowLength, mastHeight + 4, dirZ * arrowLength);
  cone.lookAt(
    dirX * (arrowLength + 1),
    mastHeight + 4,
    dirZ * (arrowLength + 1),
  );
  cone.rotateX(Math.PI / 2);
  group.add(cone);

  const label = new THREE.Sprite(createAntennaLabelMaterial(antenna.id || `A${index + 1}`, palette.label));
  label.position.y = mastHeight + 18;
  label.scale.set(24, 24, 1);
  group.add(label);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 5, 2, 16),
    darkMaterial,
  );
  base.position.y = 1;
  group.add(base);

  return group;
}

function addSignalLinks(scene, model, signalLinks, solver) {
  if (!Array.isArray(signalLinks) || !signalLinks.length || !solver) {
    return;
  }

  const group = new THREE.Group();
  const receiverPositions = new Map();

  signalLinks.forEach((link) => {
    const start = scenePointFromWorld(model, solver, link.from, 6);
    const end = scenePointFromWorld(model, solver, link.to, 6);

    if (!start || !end) {
      return;
    }

    const palette = signalLinkPalette(link.type);
    const horizontalDistance = Math.hypot(start.x - end.x, start.z - end.z);
    const arcHeight = clamp(horizontalDistance * 0.12, 18, 70);
    const midpoint = new THREE.Vector3(
      (start.x + end.x) / 2,
      Math.max(start.y, end.y) + arcHeight,
      (start.z + end.z) / 2,
    );
    const curve = new THREE.CatmullRomCurve3([
      start,
      midpoint,
      end,
    ]);
    const geometry = new THREE.TubeGeometry(curve, 36, palette.radius, 8, false);
    const material = new THREE.MeshBasicMaterial({
      color: palette.color,
      depthTest: false,
      transparent: true,
      opacity: palette.opacity,
      depthWrite: false,
    });
    const tube = new THREE.Mesh(geometry, material);
    tube.renderOrder = 10;
    group.add(tube);

    if (link.label) {
      const label = new THREE.Sprite(createTextSpriteMaterial(link.label, palette.color));
      label.position.copy(midpoint);
      label.position.y += 10;
      label.scale.set(68, 22, 1);
      group.add(label);
    }

    receiverPositions.set(`${end.x.toFixed(2)}:${end.z.toFixed(2)}`, end);
  });

  receiverPositions.forEach((position) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(13, 1.7, 10, 48),
      new THREE.MeshBasicMaterial({
        color: 0x2563eb,
        depthTest: false,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(position.x, 4.2, position.z);
    ring.renderOrder = 11;
    group.add(ring);
  });

  scene.add(group);
}

function addRsrpUsers(scene, model, users, solver) {
  if (!Array.isArray(users) || !users.length || !solver) {
    return [];
  }

  const group = new THREE.Group();
  const materials = new Map();
  const objects = [];

  users.forEach((user) => {
    const position = scenePointFromWorld(model, solver, user.position, 7);

    if (!position) {
      return;
    }

    const material = getRsrpUserMaterial(materials, user.quality);
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(8.5, 8.5, 1);
    sprite.renderOrder = 12;
    sprite.userData.rsrpUser = user;
    group.add(sprite);
    objects.push(sprite);
  });

  scene.add(group);
  return objects;
}

function getRsrpUserMaterial(materials, quality) {
  const key = quality || "no_coverage";

  if (!materials.has(key)) {
    materials.set(
      key,
      new THREE.SpriteMaterial({
        map: createRsrpDotTexture(rsrpQualityColor(key)),
        transparent: true,
        depthTest: false,
      }),
    );
  }

  return materials.get(key);
}

function createRsrpDotTexture(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");

  context.clearRect(0, 0, 64, 64);
  context.fillStyle = "rgba(255,255,255,0.86)";
  context.beginPath();
  context.arc(32, 32, 24, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = color;
  context.beginPath();
  context.arc(32, 32, 18, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = 5;
  context.strokeStyle = "rgba(15,23,42,0.24)";
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function rsrpQualityColor(quality) {
  if (quality === "excellent") {
    return "#16a34a";
  }
  if (quality === "good") {
    return "#84cc16";
  }
  if (quality === "fair") {
    return "#facc15";
  }
  if (quality === "poor") {
    return "#f97316";
  }
  return "#ef4444";
}

function pickRsrpUserFromEvent(
  event,
  renderer,
  camera,
  raycaster,
  pointer,
  rsrpUserObjects,
) {
  if (!rsrpUserObjects.length) {
    return null;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  raycaster.setFromCamera(pointer, camera);

  const hit = raycaster.intersectObjects(rsrpUserObjects, false)[0];
  return hit?.object?.userData?.rsrpUser || null;
}

function syncSelectedRsrpUserOutline(group, model, selectedRsrpUserRef, solver, lastSelectedRsrpUser, setLastSelectedRsrpUser) {
  const user = selectedRsrpUserRef?.current || null;

  if (user === lastSelectedRsrpUser) {
    return;
  }

  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    disposeThreeObject(child);
  }

  if (user && solver) {
    const position = scenePointFromWorld(model, solver, user.position, 6.8);

    if (position) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(8.5, 1.5, 12, 48),
        new THREE.MeshBasicMaterial({
          color: 0x0f172a,
          depthTest: false,
          transparent: true,
          opacity: 0.9,
        }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(position);
      ring.renderOrder = 13;
      group.add(ring);
    }
  }

  setLastSelectedRsrpUser(user);
}

function scenePointFromWorld(model, solver, position, yOffset = 0) {
  if (!Array.isArray(position) || position.length < 2) {
    return null;
  }

  const sizeX = solver.size?.[0] || 300;
  const sizeY = solver.size?.[1] || 300;
  const centerX = solver.center?.[0] || 0;
  const centerY = solver.center?.[1] || 0;
  const x = ((Number(position[0]) - centerX) / sizeX) * model.width;
  const z = -((Number(position[1]) - centerY) / sizeY) * model.depth;
  const y = clamp((Number(position[2]) || 0) * model.scale + yOffset, 6, 90);

  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(y)) {
    return null;
  }

  return new THREE.Vector3(x, y, z);
}

function antennaPalette(id = "") {
  const normalized = String(id).toUpperCase();

  if (normalized.includes("RX")) {
    return {
      head: 0x2563eb,
      label: "#1d4ed8",
      mast: 0x1d4ed8,
    };
  }

  if (normalized.includes("INT")) {
    return {
      head: 0xf97316,
      label: "#c2410c",
      mast: 0xea580c,
    };
  }

  return {
    head: 0xef4444,
    label: "#111827",
    mast: 0xb91c1c,
  };
}

function signalLinkPalette(type = "") {
  if (type === "interference") {
    return {
      color: 0xef4444,
      opacity: 0.82,
      radius: 1.6,
    };
  }

  if (type === "comparison") {
    return {
      color: 0x38bdf8,
      opacity: 0.7,
      radius: 1.5,
    };
  }

  return {
    color: 0x22c55e,
    opacity: 0.82,
    radius: 2.1,
  };
}

function createAntennaLabelMaterial(labelText, fillStyle = "#111827") {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const number = String(labelText).replace(/^A/i, "");

  context.fillStyle = fillStyle;
  context.beginPath();
  context.arc(64, 64, 46, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = "#ffffff";
  context.stroke();
  context.fillStyle = "#ffffff";
  context.font = "700 44px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(number, 64, 66);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  return new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
}

function createTextSpriteMaterial(text, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 128;
  const context = canvas.getContext("2d");

  context.fillStyle = "rgba(255,255,255,0.92)";
  roundRect(context, 12, 28, 360, 70, 18);
  context.fill();
  context.lineWidth = 6;
  context.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
  context.stroke();
  context.fillStyle = "#111827";
  context.font = "700 32px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 192, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  return new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function createTopCamera(width, height, maxSide) {
  const aspect = width / Math.max(height, 1);
  const frustumHeight = maxSide * 1.12;

  return new THREE.OrthographicCamera(
    (-frustumHeight * aspect) / 2,
    (frustumHeight * aspect) / 2,
    frustumHeight / 2,
    -frustumHeight / 2,
    0.1,
    4000,
  );
}

function updateCameraForSize(camera, viewMode, width, height, maxSide) {
  if (viewMode !== "top") {
    camera.aspect = width / Math.max(height, 1);
    return;
  }

  const aspect = width / Math.max(height, 1);
  const frustumHeight = maxSide * 1.12;
  camera.left = (-frustumHeight * aspect) / 2;
  camera.right = (frustumHeight * aspect) / 2;
  camera.top = frustumHeight / 2;
  camera.bottom = -frustumHeight / 2;
}

function createBuildingMesh(building) {
  const shape = new THREE.Shape();
  const first = building.points[0];
  shape.moveTo(first.x, first.z);
  building.points.slice(1).forEach((point) => shape.lineTo(point.x, point.z));
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(building.heightScaled, 1.8),
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    color: building.heightSource === "estimated" ? 0x94a3b8 : 0x64748b,
    roughness: 0.78,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = {
    height: building.height,
    heightSource: building.heightSource,
  };

  return mesh;
}

function colorForCoverageCell(cell, coverageDisplayMode = "quality") {
  if (coverageDisplayMode === "overlap") {
    return colorForOverlapCell(cell);
  }

  const sinrDb = numericValue(cell.sinr_db);

  if (Number.isFinite(sinrDb) && sinrDb > -80) {
    if (sinrDb < 0) {
      return "rgba(185, 28, 28, 0.72)";
    }
    if (sinrDb < 8) {
      return "rgba(234, 179, 8, 0.72)";
    }
    if (sinrDb < 18) {
      return "rgba(34, 197, 94, 0.68)";
    }
    return "rgba(14, 165, 233, 0.68)";
  }

  const throughput = numericValue(cell.throughput_mbps);
  if (Number.isFinite(throughput) && throughput > 0) {
    if (throughput < 100) {
      return "rgba(185, 28, 28, 0.66)";
    }
    if (throughput < 500) {
      return "rgba(234, 179, 8, 0.66)";
    }
    if (throughput < 1200) {
      return "rgba(34, 197, 94, 0.62)";
    }
    return "rgba(14, 165, 233, 0.62)";
  }

  const signalDbm = numericValue(cell.signal_dbm);
  if (Number.isFinite(signalDbm) && signalDbm > -130) {
    if (signalDbm < -105) {
      return "rgba(185, 28, 28, 0.54)";
    }
    if (signalDbm < -90) {
      return "rgba(234, 179, 8, 0.54)";
    }
    if (signalDbm < -75) {
      return "rgba(34, 197, 94, 0.50)";
    }
    return "rgba(14, 165, 233, 0.50)";
  }

  return "rgba(107, 114, 128, 0.28)";
}

function colorForOverlapCell(cell) {
  const level = String(cell.overlap_level || "no_coverage");

  if (level === "single_coverage") {
    return "rgba(37, 99, 235, 0.58)";
  }
  if (level === "normal_overlap") {
    return "rgba(34, 197, 94, 0.64)";
  }
  if (level === "high_overlap") {
    return "rgba(234, 179, 8, 0.72)";
  }
  if (level === "excessive_overlap") {
    return "rgba(220, 38, 38, 0.76)";
  }

  return "rgba(107, 114, 128, 0.24)";
}

function numericValue(value) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  return NaN;
}

function addRoadLines(scene, model) {
  const material = new THREE.LineBasicMaterial({ color: 0x93c5fd });
  const lines = [
    [[-0.45, -0.2], [-0.1, -0.05], [0.45, -0.15]],
    [[-0.36, 0.36], [0.0, 0.05], [0.42, 0.3]],
    [[-0.48, 0.12], [0.48, 0.12]],
  ];

  lines.forEach((line) => {
    const points = line.map(([x, z]) => new THREE.Vector3(x * model.width, 1.2, z * model.depth));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    scene.add(new THREE.Line(geometry, material));
  });
}

function removeDuplicateClosingPoint(points) {
  if (points.length < 2) {
    return points;
  }

  const first = points[0];
  const last = points[points.length - 1];

  if (Math.abs(first.x - last.x) < 0.001 && Math.abs(first.z - last.z) < 0.001) {
    return points.slice(0, -1);
  }

  return points;
}

function polygonArea(points) {
  if (points.length < 3) {
    return 0;
  }

  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.z - next.x * current.z;
  }

  return Math.abs(area) / 2;
}

function generateFallbackBuildings(bounds) {
  const centerLat = (bounds.south + bounds.north) / 2;
  const centerLon = (bounds.west + bounds.east) / 2;
  const latStep = (bounds.north - bounds.south) / 7;
  const lonStep = (bounds.east - bounds.west) / 7;

  return Array.from({ length: 18 }, (_, index) => {
    const col = index % 6;
    const row = Math.floor(index / 6);
    const lat = centerLat + (row - 1) * latStep * 1.3;
    const lon = centerLon + (col - 2.5) * lonStep;
    const halfLat = latStep * (0.18 + (index % 3) * 0.04);
    const halfLon = lonStep * (0.18 + (index % 4) * 0.035);

    return {
      id: `fallback-${index}`,
      height: 6 + (index % 7) * 4,
      heightSource: "estimated",
      points: [
        { lat: lat - halfLat, lon: lon - halfLon },
        { lat: lat - halfLat, lon: lon + halfLon },
        { lat: lat + halfLat, lon: lon + halfLon },
        { lat: lat + halfLat, lon: lon - halfLon },
      ],
    };
  });
}

function buildHeightStatus(buildings) {
  const exactCount = buildings.filter((building) => building.heightSource === "exact").length;
  const levelCount = buildings.filter((building) => building.heightSource === "levels").length;
  const estimatedCount = buildings.length - exactCount - levelCount;

  return `${buildings.length} OSM buildings. ${exactCount} exact heights, ${levelCount} level-based heights, ${estimatedCount} estimated.`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
