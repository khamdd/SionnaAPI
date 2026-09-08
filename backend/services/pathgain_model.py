import numpy as np
from typing import Literal


PathGainName = Literal["UMa", "Ericsson", "Friis"]


class PathGainModel:
    """Analytical path-gain baselines described by the Geo2SigMap paper."""

    c = 3e8  # speed of light

    def __init__(
        self,
        distance_m: float,
        antenna_height: float,
        ue_height: float,
        fc_hz: float,
    ):
        values = {
            "distance_m": distance_m,
            "antenna_height": antenna_height,
            "ue_height": ue_height,
            "fc_hz": fc_hz,
        }
        for name, value in values.items():
            if not np.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be a finite value greater than zero")

        self.distance_m = float(distance_m)
        self.antenna_height = float(antenna_height)
        self.ue_height = float(ue_height)
        self.fc_hz = float(fc_hz)

    def received_power(self, tx_power_dbm: float, model: PathGainName) -> float:
        if not np.isfinite(tx_power_dbm):
            raise ValueError("tx_power_dbm must be finite")

        loss_fn = {
            "UMa": self._uma_urban_macro,
            "Ericsson": self._ericsson_channel,
            "Friis": self._friis_free_space,
        }
        if model not in loss_fn:
            raise ValueError(f"Unknown path-gain model: {model}")
        return float(tx_power_dbm + loss_fn[model]())

    def _uma_urban_macro(self):
        fc_Ghz = self.fc_hz / 1e9

        dbp = (
            4
            * (self.antenna_height - 1)
            * (self.ue_height - 1)
            * (self.fc_hz / self.c)
        )
        if self.distance_m < dbp:
            los = -(
                28.0
                + 22 * np.log10(self.distance_m)
                + 20 * np.log10(fc_Ghz)
            )
        else:
            los = -(
                28.0
                + 40 * np.log10(self.distance_m)
                + 20 * np.log10(fc_Ghz)
                - 9 * np.log10((dbp) ** 2 + (self.antenna_height - self.ue_height) ** 2)
            )

        nlos = -(
            13.45
            + 39.08 * np.log10(self.distance_m)
            + 20 * np.log10(fc_Ghz)
            - 0.6 * (self.ue_height - 1.5)
        )

        return min(los, nlos)

    def _ericsson_channel(self):
        # specific for urban environments
        a0 = 36.2
        a1 = 30.2
        a2 = 12
        a3 = 0.1

        fc_Mhz = self.fc_hz / 1e6
        d_km = self.distance_m / 1e3

        gf = 44.49 * np.log10(fc_Mhz) - 4.78 * (np.log10(fc_Mhz)) ** 2

        return -(
            a0
            + a1 * np.log10(d_km)
            + a2 * np.log10(self.antenna_height)
            + a3 * np.log10(self.antenna_height) * np.log10(d_km)
            - 3.2 * (np.log10(11.75 * self.ue_height)) ** 2
            + gf
        )

    def _friis_free_space(self):
        d_km = self.distance_m / 1e3
        f_Mhz = self.fc_hz / 1e6
        return -(32.45 + 20 * np.log10(d_km) + 20 * np.log10(f_Mhz))
