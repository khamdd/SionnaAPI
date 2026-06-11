import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteSimulationRun,
  getSimulationRun,
  listSimulationRuns,
  runNetworkCoverage,
} from "./api";
import {
  DEFAULT_ANTENNAS,
  DEFAULT_SOLVER,
  TRANSMITTER_PATTERN,
} from "./constants";
import AntennaPanel from "./components/AntennaPanel";
import {
  CoverageApiPage,
  SinrApiPage,
  ThroughputApiPage,
} from "./components/ApiPages";
import ComparisonResult from "./components/ComparisonResult";
import HistoryDetail from "./components/HistoryDetail";
import HistoryModal, { HistoryModalBody } from "./components/HistoryModal";
import HistoryPanel from "./components/HistoryPanel";
import MapPanel from "./components/MapPanel";
import { formatDateTime, formatSimulationType } from "./utils/format";
import {
  isSuccessfulHistoryItem,
  pruneComparisonDetails,
  pruneComparisonSelection,
} from "./utils/history";
import {
  drawHeatmap,
  summarizeGrid,
} from "./utils/map";

const ROUTES = [
  { path: "/network", label: "Network Coverage" },
  { path: "/coverage", label: "Coverage API" },
  { path: "/sinr", label: "SINR API" },
  { path: "/throughput", label: "Throughput API" },
  { path: "/history", label: "History" },
];

function clone(value) {
  return structuredClone(value);
}

export default function App() {
  const [route, setRoute] = useState(() => normalizeRoute(window.location.pathname));
  const [antennas, setAntennas] = useState(() => clone(DEFAULT_ANTENNAS));
  const [latestGrid, setLatestGrid] = useState(null);
  const [latestSolver, setLatestSolver] = useState(() => clone(DEFAULT_SOLVER));
  const [coverageImageUrl, setCoverageImageUrl] = useState("");
  const [runStatus, setRunStatus] = useState("Ready");
  const [runError, setRunError] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [historyStatus, setHistoryStatus] = useState("No history loaded.");
  const [historyError, setHistoryError] = useState(false);
  const [latestHistory, setLatestHistory] = useState([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState(null);
  const [comparisonType, setComparisonType] = useState(null);
  const [selectedComparisonIds, setSelectedComparisonIds] = useState(() => new Set());
  const [comparisonDetails, setComparisonDetails] = useState(() => new Map());
  const [modalContent, setModalContent] = useState(null);
  const [hover, setHover] = useState(null);

  const canvasRef = useRef(null);
  const mapStageRef = useRef(null);
  const summary = useMemo(() => summarizeGrid(latestGrid), [latestGrid]);

  const loadHistory = useCallback(async () => {
    setHistoryStatus("Loading history...");
    setHistoryError(false);

    try {
      const result = await listSimulationRuns(25);

      if (!result.database_configured) {
        setLatestHistory([]);
        setSelectedComparisonIds(new Set());
        setComparisonDetails(new Map());
        setComparisonType(null);
        setModalContent(null);
        setHistoryStatus("Database is not configured. Set DATABASE_URL to use history.");
        return;
      }

      if (result.error) {
        throw new Error(result.error);
      }

      const items = result.items || [];
      setLatestHistory(items);
      setHistoryStatus(items.length ? `${items.length} saved simulations` : "No saved simulations yet.");
      setSelectedComparisonIds((current) => pruneComparisonSelection(current, items, comparisonType));
      setComparisonDetails((current) => pruneComparisonDetails(current, items));
    } catch (error) {
      setHistoryStatus(`History failed: ${error.message}`);
      setHistoryError(true);
    }
  }, [comparisonType]);

  useEffect(() => {
    function handlePopState() {
      setRoute(normalizeRoute(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (route === "/history") {
      loadHistory();
    }
  }, [route, loadHistory]);

  useEffect(() => {
    if (comparisonType && selectedComparisonIds.size === 0) {
      setComparisonType(null);
    }
  }, [comparisonType, selectedComparisonIds]);

  useEffect(() => {
    drawHeatmap(canvasRef.current, mapStageRef.current, latestGrid);
  }, [latestGrid, route]);

  useEffect(() => {
    function handleResize() {
      drawHeatmap(canvasRef.current, mapStageRef.current, latestGrid);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [latestGrid]);

  useEffect(() => {
    if (!modalContent) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeModal();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [modalContent]);

  function navigate(path) {
    const nextRoute = normalizeRoute(path);
    window.history.pushState({}, "", nextRoute);
    setRoute(nextRoute);
  }

  async function runSimulation() {
    setIsRunning(true);
    setRunError(false);
    setRunStatus("Running GPU simulation...");

    try {
      const result = await runNetworkCoverage(buildNetworkCoveragePayload(antennas));

      if (result.status !== "success") {
        throw new Error(result.error || "Simulation failed");
      }

      setLatestGrid(result.grid);
      setLatestSolver(result.solver);
      setCoverageImageUrl(`${result.coverage_map_image_url}?t=${Date.now()}`);
      setRunStatus("Simulation complete");
    } catch (error) {
      setRunStatus(`Simulation failed: ${error.message}`);
      setRunError(true);
    } finally {
      setIsRunning(false);
    }
  }

  function updateAntenna(index, field, value) {
    setAntennas((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) {
        return item;
      }

      return {
        ...item,
        [field]: {
          ...item[field],
          current: value,
        },
      };
    }));
  }

  function resetAntennas() {
    setAntennas(clone(DEFAULT_ANTENNAS));
    setLatestGrid(null);
    setLatestSolver(clone(DEFAULT_SOLVER));
    setCoverageImageUrl("");
    setHover(null);
    setRunStatus("Ready");
    setRunError(false);
  }

  function toggleComparisonSelection(item) {
    if (!isSuccessfulHistoryItem(item)) {
      return;
    }

    if (comparisonType && item.simulation_type !== comparisonType) {
      return;
    }

    setComparisonType((current) => current || item.simulation_type);
    setSelectedComparisonIds((current) => toggleSetValue(current, item.id));
    setComparisonDetails((current) => removeMapValue(current, item.id));
  }

  function cancelComparison() {
    setComparisonType(null);
    setSelectedComparisonIds(new Set());
    setComparisonDetails(new Map());
  }

  async function showComparisonResult() {
    if (!comparisonType || selectedComparisonIds.size < 2) {
      return;
    }

    setHistoryStatus("Loading comparison...");
    setHistoryError(false);

    try {
      const { items, details } = await loadComparisonDetails(
        selectedComparisonIds,
        comparisonDetails,
      );

      setComparisonDetails(details);
      setModalContent(
        <HistoryModalBody title={`Comparison: ${formatSimulationType(comparisonType)}`}>
          <ComparisonResult type={comparisonType} items={items} />
        </HistoryModalBody>,
      );
      cancelComparison();
      setSelectedHistoryId(null);
      setHistoryStatus(`Compared ${items.length} simulations.`);
    } catch (error) {
      setHistoryStatus(`Comparison failed: ${error.message}`);
      setHistoryError(true);
    }
  }

  async function openHistoryDetail(runId) {
    setSelectedHistoryId(runId);
    setModalContent(<p className="history-status">Loading detail...</p>);

    try {
      const result = await getSimulationRun(runId);

      if (!result.database_configured) {
        setModalContent(<p className="history-status">Database is not configured.</p>);
        return;
      }

      if (result.error) {
        throw new Error(result.error);
      }

      if (!result.item) {
        setModalContent(<p className="history-status">Simulation not found.</p>);
        return;
      }

      setModalContent(<HistoryDetail item={result.item} />);
    } catch (error) {
      setModalContent(<p className="history-status error-text">Detail failed: {error.message}</p>);
    }
  }

  async function deleteHistoryItem(item) {
    const confirmed = window.confirm(
      `Delete ${formatSimulationType(item.simulation_type)} history from ${formatDateTime(item.created_at)}?`,
    );

    if (!confirmed) {
      return;
    }

    setHistoryStatus("Deleting history...");
    setHistoryError(false);

    try {
      await deleteSimulationRun(item.id);

      if (selectedHistoryId === item.id) {
        closeModal();
      }

      setSelectedComparisonIds((current) => removeSetValue(current, item.id));
      setComparisonDetails((current) => removeMapValue(current, item.id));

      await loadHistory();
    } catch (error) {
      setHistoryStatus(`Delete failed: ${error.message}`);
      setHistoryError(true);
    }
  }

  function closeModal() {
    setModalContent(null);
    setSelectedHistoryId(null);
  }

  function handleHover(event) {
    if (!latestGrid) {
      setHover(null);
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const col = Math.floor((x / rect.width) * latestGrid.cols);
    const row = latestGrid.rows - 1 - Math.floor((y / rect.height) * latestGrid.rows);
    const cell = latestGrid.cells.find((item) => item.row === row && item.col === col);

    if (!cell) {
      setHover(null);
      return;
    }

    setHover({
      cell,
      left: Math.min(x + 14, rect.width - 252),
      top: Math.max(y - 80, 10),
    });
  }

  return (
    <div className="app-frame">
      <Navbar route={route} onNavigate={navigate} />
      {route === "/network" && (
        <NetworkCoveragePage
          antennas={antennas}
          canvasRef={canvasRef}
          coverageImageUrl={coverageImageUrl}
          hover={hover}
          isRunning={isRunning}
          latestSolver={latestSolver}
          mapStageRef={mapStageRef}
          onHover={handleHover}
          onHoverEnd={() => setHover(null)}
          onResetAntennas={resetAntennas}
          onRun={runSimulation}
          onUpdateAntenna={updateAntenna}
          runError={runError}
          runStatus={runStatus}
          summary={summary}
        />
      )}
      {route === "/coverage" && <CoverageApiPage />}
      {route === "/sinr" && <SinrApiPage />}
      {route === "/throughput" && <ThroughputApiPage />}
      {route === "/history" && (
        <HistoryRoutePage
          comparisonType={comparisonType}
          historyError={historyError}
          historyStatus={historyStatus}
          items={latestHistory}
          onCancelComparison={cancelComparison}
          onDelete={deleteHistoryItem}
          onOpen={openHistoryDetail}
          onRefresh={loadHistory}
          onShowComparison={showComparisonResult}
          onToggleCompare={toggleComparisonSelection}
          selectedComparisonIds={selectedComparisonIds}
          selectedHistoryId={selectedHistoryId}
        />
      )}

      {modalContent && (
        <HistoryModal onClose={closeModal}>
          {modalContent}
        </HistoryModal>
      )}
    </div>
  );
}

function Navbar({ onNavigate, route }) {
  return (
    <header className="app-navbar">
      <div>
        <strong>Sionna Planner</strong>
        <span>GPU radio simulation workspace</span>
      </div>
      <nav aria-label="Primary navigation">
        {ROUTES.map((item) => (
          <button
            key={item.path}
            className={route === item.path ? "active" : ""}
            type="button"
            onClick={() => onNavigate(item.path)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  );
}

function NetworkCoveragePage({
  antennas,
  canvasRef,
  coverageImageUrl,
  hover,
  isRunning,
  latestSolver,
  mapStageRef,
  onHover,
  onHoverEnd,
  onResetAntennas,
  onRun,
  onUpdateAntenna,
  runError,
  runStatus,
  summary,
}) {
  return (
    <main className="app-shell">
      <MapPanel
        antennas={antennas}
        coverageImageUrl={coverageImageUrl}
        canvasRef={canvasRef}
        hover={hover}
        isRunning={isRunning}
        latestSolver={latestSolver}
        mapStageRef={mapStageRef}
        onHover={onHover}
        onHoverEnd={onHoverEnd}
        onRun={onRun}
        runError={runError}
        runStatus={runStatus}
        summary={summary}
      />
      <aside className="control-panel" aria-label="Antenna controls">
        <div className="panel-header">
          <h2>Antenna sectors</h2>
          <div className="panel-actions">
            <button className="ghost-button" type="button" onClick={onResetAntennas}>
              Reset
            </button>
          </div>
        </div>
        <AntennaPanel antennas={antennas} onChange={onUpdateAntenna} />
      </aside>
    </main>
  );
}

function HistoryRoutePage({
  comparisonType,
  historyError,
  historyStatus,
  items,
  onCancelComparison,
  onDelete,
  onOpen,
  onRefresh,
  onShowComparison,
  onToggleCompare,
  selectedComparisonIds,
  selectedHistoryId,
}) {
  return (
    <main className="route-page">
      <div className="page-title with-action">
        <div>
          <h1>Simulation History</h1>
          <p>Review saved simulation runs, compare matching successful runs, or delete old records.</p>
        </div>
        <button className="ghost-button" type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      <section className="history-page-panel">
        <HistoryPanel
          comparisonType={comparisonType}
          historyError={historyError}
          historyStatus={historyStatus}
          items={items}
          onCancelComparison={onCancelComparison}
          onDelete={onDelete}
          onOpen={onOpen}
          onShowComparison={onShowComparison}
          onToggleCompare={onToggleCompare}
          selectedComparisonIds={selectedComparisonIds}
          selectedHistoryId={selectedHistoryId}
        />
      </section>
    </main>
  );
}

function buildNetworkCoveragePayload(antennas) {
  return {
    antennas,
    transmitter_pattern: TRANSMITTER_PATTERN,
    solver: DEFAULT_SOLVER,
    camera: {
      position: [0, 0, 650],
      look_at: [0, 0, 0],
    },
    bandwidth_mhz: 100,
    mimo_layers: 4,
  };
}

async function loadComparisonDetails(selectedIds, cachedDetails) {
  const items = [];
  const details = new Map(cachedDetails);

  for (const runId of selectedIds) {
    let item = details.get(runId);

    if (!item) {
      const result = await getSimulationRun(runId);

      if (!result.database_configured) {
        throw new Error("Database is not configured.");
      }

      if (result.error) {
        throw new Error(result.error);
      }

      if (!result.item) {
        throw new Error("Simulation not found.");
      }

      item = result.item;
      details.set(runId, item);
    }

    items.push(item);
  }

  return {
    items,
    details,
  };
}

function normalizeRoute(pathname) {
  if (pathname === "/") {
    return "/network";
  }

  return ROUTES.some((item) => item.path === pathname)
    ? pathname
    : "/network";
}

function toggleSetValue(current, value) {
  const next = new Set(current);

  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }

  return next;
}

function removeSetValue(current, value) {
  const next = new Set(current);
  next.delete(value);
  return next;
}

function removeMapValue(current, key) {
  if (!current.has(key)) {
    return current;
  }

  const next = new Map(current);
  next.delete(key);
  return next;
}
