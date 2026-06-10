import numpy as np

from backend.simulations.sionna_engine import scene

from backend.simulations.antenna_factory import (
    sync_transmitter,
    remove_entity,
)

from backend.simulations.radio_calculator import (
    calculate_interference_plus_noise_power,
    execute_radio_map,
    extract_linear_sinr_at_point,
    extract_signal_power_at_point,
    linear_to_db,
    watts_to_dbm,
)


def calculate_sinr_service(req):

    try:

        sync_transmitter(
            scene,
            "tx0",
            req.transmitter_position,
            req.tilt,
            req.tx_power,
            pattern=req.transmitter_pattern,
        )

        sync_transmitter(
            scene,
            "tx_interferer",
            req.interferer_position,
            req.interferer_tilt,
            req.tx_power,
            pattern=req.transmitter_pattern,
        )

        rm = execute_radio_map(
            scene,
            req.solver,
        )

        linear_sinr = (
            extract_linear_sinr_at_point(
                rm,
                req.solver,
                req.receiver_position,
            )
        )

        signal_power = (
            extract_signal_power_at_point(
                rm,
                req.solver,
                req.receiver_position,
            )
        )

        interference_plus_noise = (
            calculate_interference_plus_noise_power(
                signal_power,
                linear_sinr,
            )
        )

        return {
            "status": "success",
            "sinr_db": round(
                linear_to_db(linear_sinr),
                2,
            ),
            "signal_power": round(
                watts_to_dbm(signal_power),
                2,
            ),
            "noise_power": round(
                watts_to_dbm(interference_plus_noise),
                2,
            ),
        }

    except Exception as e:

        return {
            "status": "failure",
            "error": str(e),
        }

    finally:

        remove_entity(scene, "tx0")
        remove_entity(scene, "tx_interferer")
