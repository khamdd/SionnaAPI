import { useCallback, useEffect, useState } from "react";

import {
  SCENE_SELECTION_ROUTE,
  isWorkSceneRequiredRoute,
  normalizeRoute,
} from "../utils/routes";

export default function usePlannerNavigation({ hasWorkScene, setSceneNotice }) {
  const [route, setRoute] = useState(() =>
    normalizeRoute(window.location.pathname),
  );

  useEffect(() => {
    function handlePopState() {
      setRoute(normalizeRoute(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback(
    (path, options = {}) => {
      let destination = path;
      if (
        !options.allowWithoutWorkScene &&
        !hasWorkScene &&
        isWorkSceneRequiredRoute(destination)
      ) {
        setSceneNotice(
          "Select or create a work scene before opening simulations.",
          true,
        );
        destination = SCENE_SELECTION_ROUTE;
      }

      const nextRoute = normalizeRoute(destination);
      if (options.replace) {
        window.history.replaceState({}, "", nextRoute);
      } else {
        window.history.pushState({}, "", nextRoute);
      }
      setRoute(nextRoute);
    },
    [hasWorkScene, setSceneNotice],
  );

  return { navigate, route };
}
