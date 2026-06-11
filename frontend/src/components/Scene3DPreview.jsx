import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const DEFAULT_HEIGHT_M = 9;

export default function Scene3DPreview({ bounds, sceneName }) {
  const canvasHostRef = useRef(null);
  const [model, setModel] = useState(null);
  const [status, setStatus] = useState("Loading OSM buildings...");

  useEffect(() => {
    if (!bounds) {
      return undefined;
    }

    const controller = new AbortController();

    async function loadBuildings() {
      setStatus("Loading OSM buildings...");

      try {
        const buildings = await fetchBuildings(bounds, controller.signal);

        if (buildings.length) {
          setModel(buildModel(bounds, buildings));
          setStatus(buildHeightStatus(buildings));
          return;
        }

        const fallback = generateFallbackBuildings(bounds);
        setModel(buildModel(bounds, fallback));
        setStatus("No OSM building footprints found. Showing generated blocks for preview only.");
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        const fallback = generateFallbackBuildings(bounds);
        setModel(buildModel(bounds, fallback));
        setStatus("OSM building lookup failed. Showing generated blocks for preview only.");
      }
    }

    loadBuildings();

    return () => controller.abort();
  }, [bounds]);

  useEffect(() => {
    const host = canvasHostRef.current;

    if (!host || !model) {
      return undefined;
    }

    return renderThreeScene(host, model);
  }, [model]);

  return (
    <div className="scene-3d-preview">
      <div ref={canvasHostRef} className="scene-3d-canvas" />
      <div className="scene-3d-overlay">
        <strong>{sceneName || "Selected scene"}</strong>
        <span>{status}</span>
      </div>
    </div>
  );
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

  return DEFAULT_HEIGHT_M;
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
        ...building,
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

function renderThreeScene(host, model) {
  host.innerHTML = "";

  const width = host.clientWidth || 820;
  const height = host.clientHeight || 430;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xedf2f7);

  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 4000);
  camera.position.set(model.width * 0.55, Math.max(model.width, model.depth) * 0.72, model.depth * 0.9);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  host.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.minDistance = 80;
  controls.maxDistance = 1200;
  controls.maxPolarAngle = Math.PI / 2.15;

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

  model.buildings.forEach((building) => {
    const mesh = createBuildingMesh(building);
    if (mesh) {
      scene.add(mesh);
    }
  });

  const observer = new ResizeObserver(() => {
    const nextWidth = host.clientWidth || width;
    const nextHeight = host.clientHeight || height;
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight);
  });
  observer.observe(host);

  let animationId = 0;
  function animate() {
    controls.update();
    renderer.render(scene, camera);
    animationId = window.requestAnimationFrame(animate);
  }
  animate();

  return () => {
    window.cancelAnimationFrame(animationId);
    observer.disconnect();
    controls.dispose();
    renderer.dispose();
    scene.traverse((object) => {
      if (object.geometry) {
        object.geometry.dispose();
      }
      if (object.material) {
        object.material.dispose();
      }
    });
    host.innerHTML = "";
  };
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
