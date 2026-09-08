import numpy as np

from backend.exceptions import ClientInputError
from backend.schemas.requests import SINRRequest
from backend.services.analytical_service import calculate_selected_analytical_link

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


def calculate_sinr_service(req: SINRRequest, scene):

    if getattr(req, "propagation_model", "sionna") != "sionna":
        return calculate_analytical_sinr_service(req)

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
            interferer_power(req),
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
            "propagation_model": "sionna",
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
            "receiver_position": req.receiver_position,
            "solver": solver_metadata(req.solver),
            "antennas": [
                {
                    "id": "TX",
                    "position": req.transmitter_position,
                    "azimuth": 0,
                },
                {
                    "id": "INT",
                    "position": req.interferer_position,
                    "azimuth": 0,
                },
                {
                    "id": "RX",
                    "position": req.receiver_position,
                    "azimuth": 0,
                },
            ],
        }

    except ClientInputError as e:

        return {
            "status": "failure",
            "status_code": 400,
            "error": str(e),
        }

    except Exception as e:

        return {
            "status": "failure",
            "error": str(e),
        }

    finally:

        remove_entity(scene, "tx0")
        remove_entity(scene, "tx_interferer")


def calculate_analytical_sinr_service(req: SINRRequest):
    try:
        result = calculate_selected_analytical_link(req)

        return {
            "status": "success",
            "propagation_model": req.propagation_model,
            "sinr_db": result["sinr_db"],
            "signal_power": result["signal_power_dbm"],
            "interference_power": result["interference_power_dbm"],
            "thermal_noise_power": result["thermal_noise_power_dbm"],
            "noise_power": result["interference_plus_noise_power_dbm"],
            "receiver_position": req.receiver_position,
            "solver": solver_metadata(req.solver),
            "antennas": result_antennas(req),
        }
    except Exception as exc:
        return {
            "status": "failure",
            "status_code": 400,
            "error": str(exc),
        }


def result_antennas(req):
    return [
        {"id": "TX", "position": req.transmitter_position, "azimuth": 0},
        {"id": "INT", "position": req.interferer_position, "azimuth": 0},
        {"id": "RX", "position": req.receiver_position, "azimuth": 0},
    ]


def interferer_power(req):
    value = getattr(req, "interferer_tx_power", None)
    return req.tx_power if value is None else value


def solver_metadata(solver):
    if not all(hasattr(solver, attr) for attr in ("cell_size", "center", "size")):
        return None

    return {
        "cell_size": solver.cell_size,
        "center": solver.center,
        "size": solver.size,
    }
