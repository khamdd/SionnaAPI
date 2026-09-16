import { useCallback, useState } from "react";

import { listScenes } from "../api";

export default function useSceneWorkspace() {
  const [activeScene, setActiveScene] = useState(null);
  const [hasWorkScene, setHasWorkScene] = useState(false);
  const [isListLoading, setIsListLoading] = useState(true);
  const [isSceneLoading, setIsSceneLoading] = useState(false);
  const [notice, setNoticeState] = useState(null);
  const [scenes, setScenes] = useState([]);

  const setNotice = useCallback((message, error = false) => {
    setNoticeState({ message, error });
  }, []);

  const load = useCallback(async (options = {}) => {
    const syncActiveScene = options.syncActiveScene ?? false;
    setIsListLoading(true);

    try {
      const result = await listScenes();
      const nextScenes = result.scenes || [];
      const nextActiveScene = result.active_scene || null;

      setScenes(nextScenes);
      if (syncActiveScene) {
        setActiveScene(nextActiveScene);
        setHasWorkScene(Boolean(nextActiveScene));
      }
      return {
        ...result,
        active_scene: nextActiveScene,
        scenes: nextScenes,
      };
    } finally {
      setIsListLoading(false);
    }
  }, []);

  const activate = useCallback(
    (scene) => {
      setActiveScene(scene);
      setHasWorkScene(true);
      setNotice(`${scene.name} is now active.`);
    },
    [setNotice],
  );

  const clear = useCallback(() => {
    setHasWorkScene(false);
    setActiveScene(null);
  }, []);

  return {
    activate,
    activeScene,
    clear,
    hasWorkScene,
    isListLoading,
    isSceneLoading,
    load,
    notice,
    scenes,
    setIsSceneLoading,
    setNotice,
  };
}
