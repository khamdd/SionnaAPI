import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { runNetworkCoverage } from "../api";
import { DEFAULT_SOLVER } from "../constants";
import { validateNetworkCoverageSimulationAntennas } from "../utils/antennas";
import { clone } from "../utils/collections";
import { buildNetworkCoveragePayload } from "../utils/jobAdapters";
import { drawHeatmap, summarizeGrid } from "../utils/map";
import { solverForScene } from "../utils/scene";

export default function useNetworkCoverage({
  activeAntennas,
  activeScene,
  draft,
  isSceneListLoading,
  isSceneLoading,
  loadJobs,
  onJobQueued,
  route,
}) {
  const [coverageImageUrl, setCoverageImageUrl] = useState("");
  const [hover, setHover] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [latestGrid, setLatestGrid] = useState(null);
  const [latestSolver, setLatestSolver] = useState(() => clone(DEFAULT_SOLVER));
  const [runError, setRunError] = useState(false);
  const [runStatus, setRunStatus] = useState("Ready");
  const [solverDraft, setSolverDraft] = useState(() => clone(DEFAULT_SOLVER));
  const canvasRef = useRef(null);
  const mapStageRef = useRef(null);
  const hoverFrameRef = useRef(0);
  const hoverPointRef = useRef(null);

  const summary = useMemo(() => summarizeGrid(latestGrid), [latestGrid]);
  const solver = useMemo(
    () => solverForScene(activeScene, solverDraft),
    [activeScene, solverDraft],
  );
  const cellIndex = useMemo(() => {
    const index = new Map();
    if (latestGrid) {
      for (const cell of latestGrid.cells) {
        index.set(cell.row * latestGrid.cols + cell.col, cell);
      }
    }
    return index;
  }, [latestGrid]);

  const clearResult = useCallback(() => {
    setLatestGrid(null);
    setLatestSolver(solverForScene(activeScene));
    setCoverageImageUrl("");
    setHover(null);
    setRunStatus("Ready");
    setRunError(false);
  }, [activeScene]);

  useEffect(() => {
    clearResult();
  }, [activeScene?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    drawHeatmap(canvasRef.current, mapStageRef.current, latestGrid);
  }, [latestGrid, route]);

  useEffect(() => {
    let frame = 0;
    function handleResize() {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        drawHeatmap(canvasRef.current, mapStageRef.current, latestGrid);
      });
    }

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [latestGrid]);

  useEffect(
    () => () => {
      if (hoverFrameRef.current) {
        window.cancelAnimationFrame(hoverFrameRef.current);
      }
    },
    [],
  );

  const run = useCallback(async () => {
    if (isRunning || isSceneLoading || isSceneListLoading || !activeScene) {
      return;
    }

    setIsRunning(true);
    setRunError(false);
    setRunStatus("Running GPU simulation...");

    try {
      const validationError = validateNetworkCoverageSimulationAntennas(
        activeAntennas,
        activeScene,
      );
      if (validationError) {
        throw new Error(validationError);
      }

      const result = await runNetworkCoverage(
        buildNetworkCoveragePayload(activeAntennas, activeScene, solverDraft),
      );
      if (result.status === "queued") {
        onJobQueued({ ...result, scene_name: activeScene.name });
        setRunStatus("Simulation recorded in the queue.");
        loadJobs().catch(() => {});
        return;
      }
      if (result.status !== "success") {
        throw new Error(result.error || "Simulation failed");
      }

      setLatestGrid(result.grid);
      setLatestSolver(result.solver);
      setCoverageImageUrl(
        result.coverage_map_image_url
          ? `${result.coverage_map_image_url}?t=${Date.now()}`
          : "",
      );
      setRunStatus("Simulation complete");
    } catch (runFailure) {
      setRunStatus(`Simulation failed: ${runFailure.message}`);
      setRunError(true);
    } finally {
      setIsRunning(false);
    }
  }, [
    activeAntennas,
    activeScene,
    isRunning,
    isSceneListLoading,
    isSceneLoading,
    loadJobs,
    onJobQueued,
    solverDraft,
  ]);

  const updateAntenna = useCallback(
    (antennaId, field, value) => draft.updateAntenna(antennaId, field, value),
    [draft],
  );

  const addType2Antenna = useCallback(
    (antenna) => {
      const result = draft.addAntennas(antenna);
      if (result.ok) {
        clearResult();
      }
      return result;
    },
    [clearResult, draft],
  );

  const removeType2Antenna = useCallback(
    (antennaId) => {
      if (!activeScene?.id) {
        return;
      }
      draft.removeAntenna(antennaId);
      clearResult();
    },
    [activeScene?.id, clearResult, draft],
  );

  const resetAntennas = useCallback(() => {
    draft.clear();
    clearResult();
  }, [clearResult, draft]);

  const applyOptimization = useCallback(
    (settings) => {
      Object.entries(settings).forEach(([id, values]) => {
        if (values && typeof values === "object") {
          updateAntenna(id, "tilt", values.tilt);
          updateAntenna(id, "tx_power", values.tx_power);
          updateAntenna(id, "azimuth", values.azimuth);
          return;
        }
        updateAntenna(id, "tilt", values);
      });
      setLatestGrid(null);
      setCoverageImageUrl("");
      setRunStatus(
        "Optimized antenna settings applied. Run Network Coverage to view the updated map.",
      );
    },
    [updateAntenna],
  );

  const handleHover = useCallback(
    (event) => {
      hoverPointRef.current = { clientX: event.clientX, clientY: event.clientY };
      if (hoverFrameRef.current) {
        return;
      }
      hoverFrameRef.current = window.requestAnimationFrame(() => {
        hoverFrameRef.current = 0;
        const point = hoverPointRef.current;
        const canvas = canvasRef.current;
        if (!point || !canvas) {
          return;
        }
        if (!latestGrid) {
          setHover(null);
          return;
        }
        const rect = canvas.getBoundingClientRect();
        const x = point.clientX - rect.left;
        const y = point.clientY - rect.top;
        const col = Math.floor((x / rect.width) * latestGrid.cols);
        const row =
          latestGrid.rows - 1 - Math.floor((y / rect.height) * latestGrid.rows);
        const cell = cellIndex.get(row * latestGrid.cols + col) || null;
        if (!cell) {
          setHover(null);
          return;
        }
        setHover({
          cell,
          left: Math.min(x + 14, rect.width - 252),
          top: Math.max(y - 80, 10),
        });
      });
    },
    [cellIndex, latestGrid],
  );

  return {
    addType2Antenna,
    applyOptimization,
    canvasRef,
    clearResult,
    coverageImageUrl,
    handleHover,
    hover,
    isRunning,
    latestGrid,
    latestSolver,
    mapStageRef,
    removeType2Antenna,
    resetAntennas,
    run,
    runError,
    runStatus,
    setHover,
    setSolverDraft,
    solver,
    summary,
    updateAntenna,
  };
}
