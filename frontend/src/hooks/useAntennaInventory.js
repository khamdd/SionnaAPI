import { useCallback, useEffect, useState } from "react";

import { createAntenna, listAntennas } from "../api";

export default function useAntennaInventory(currentUser) {
  const [antennas, setAntennas] = useState([]);

  useEffect(() => {
    if (!currentUser) {
      setAntennas([]);
      return;
    }

    listAntennas()
      .then((result) => {
        setAntennas(result.antennas || []);
      })
      .catch(() => {
        setAntennas([]);
      });
  }, [currentUser]);

  const createInventoryAntenna = useCallback(async (payload) => {
    const result = await createAntenna(payload);
    const antenna = result.antenna || result;
    setAntennas((current) => [...current, antenna]);
    return antenna;
  }, []);

  return {
    antennas,
    createInventoryAntenna,
    setAntennas,
  };
}
