import numpy as np
from backend.constants import DEFAULT_TRANSMITTER_PATTERN

from sionna.rt import (
    PlanarArray,
    Transmitter,
)


def sync_transmitter(
    scene,
    name,
    position,
    tilt_deg,
    power_dbm,
    pattern=DEFAULT_TRANSMITTER_PATTERN,
    azimuth_deg=0.0,
    configure_tx_array=True,
):
    tilt_rad = tilt_deg * np.pi / 180
    azimuth_rad = azimuth_deg * np.pi / 180

    tx = scene.transmitters.get(name)

    if tx is not None:

        tx.position = list(position)

        tx.orientation = [
            azimuth_rad,
            tilt_rad,
            0.0,
        ]

        tx.power_dbm = power_dbm

    else:

        if configure_tx_array:
            scene.tx_array = PlanarArray(
                num_rows=1,
                num_cols=1,
                pattern=pattern,
                polarization="V",
            )

        tx = Transmitter(
            name=name,
            position=list(position),
            orientation=[
                azimuth_rad,
                tilt_rad,
                0.0,
            ],
            power_dbm=power_dbm,
        )

        scene.add(tx)

    return tx


def remove_entity(scene, name):
    try:
        scene.remove(name)
    except Exception as e:
        return {
            "error": str(e)
        }
