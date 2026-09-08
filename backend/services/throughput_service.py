from backend.exceptions import ClientInputError
from backend.schemas.requests import ThroughputRequest
from backend.services.analytical_service import (
    calculate_selected_analytical_link,
)
from backend.simulations.antenna_factory import (
    remove_entity,
    sync_transmitter,
)
from backend.simulations.radio_calculator import (
    calculate_5g_throughput,
    execute_radio_map,
    extract_linear_sinr_at_point,
)


def compare_throughput_service(req: ThroughputRequest, scene):
    if getattr(req, "propagation_model", "sionna") != "sionna":
        return compare_analytical_throughput_service(req)

    try:
        sync_transmitter(
            scene,
            "tx0",
            req.transmitter_position,
            req.base_tilt,
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

        rm_base = execute_radio_map(
            scene,
            req.solver,
        )
        sinr_base = extract_linear_sinr_at_point(
            rm_base,
            req.solver,
            req.receiver_position,
        )
        throughput_base = calculate_5g_throughput(
            sinr_base,
            req.bandwidth_mhz,
            req.mimo_layers,
        )

        sync_transmitter(
            scene,
            "tx0",
            req.transmitter_position,
            req.target_tilt,
            req.tx_power,
            pattern=req.transmitter_pattern,
        )

        rm_target = execute_radio_map(
            scene,
            req.solver,
        )
        sinr_target = extract_linear_sinr_at_point(
            rm_target,
            req.solver,
            req.receiver_position,
        )
        throughput_target = calculate_5g_throughput(
            sinr_target,
            req.bandwidth_mhz,
            req.mimo_layers,
        )

        delta_mbps = round(
            throughput_target - throughput_base,
            2,
        )
        percentage_change = (
            round(
                (delta_mbps / throughput_base) * 100,
                2,
            )
            if throughput_base > 0
            else 0.0
        )
        direction = _change_direction(delta_mbps)

        return {
            "status": "success",
            "propagation_model": "sionna",
            "comparison": {
                "base_tilt_deg": req.base_tilt,
                "target_tilt_deg": req.target_tilt,
                "base_throughput_mbps": throughput_base,
                "target_throughput_mbps": throughput_target,
                "delta_mbps": delta_mbps,
                "percentage_change": percentage_change,
                "direction": direction,
            },
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
            "recommendation": (
                "Antenna modification yields a "
                f"{abs(percentage_change)}% {direction} "
                "in download throughput."
            ),
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


def compare_analytical_throughput_service(req: ThroughputRequest):
    try:
        result = calculate_selected_analytical_link(req)
        throughput = calculate_5g_throughput(
            10.0 ** (result["sinr_db"] / 10.0),
            req.bandwidth_mhz,
            req.mimo_layers,
        )

        return {
            "status": "success",
            "propagation_model": req.propagation_model,
            "sinr_db": result["sinr_db"],
            "signal_power": result["signal_power_dbm"],
            "interference_power": result["interference_power_dbm"],
            "thermal_noise_power": result["thermal_noise_power_dbm"],
            "noise_power": result["interference_plus_noise_power_dbm"],
            "comparison": {
                "base_tilt_deg": req.base_tilt,
                "target_tilt_deg": req.target_tilt,
                "base_throughput_mbps": throughput,
                "target_throughput_mbps": throughput,
                "delta_mbps": 0.0,
                "percentage_change": 0.0,
                "direction": "no_change",
            },
            "receiver_position": req.receiver_position,
            "solver": solver_metadata(req.solver),
            "antennas": result_antennas(req),
            "recommendation": (
                f"{result['model']} does not model antenna tilt, so base and "
                "target tilt produce the same throughput."
            ),
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


def _change_direction(delta_mbps):
    if delta_mbps > 0:
        return "increase"

    if delta_mbps < 0:
        return "decrease"

    return "no_change"


def solver_metadata(solver):
    if not all(hasattr(solver, attr) for attr in ("cell_size", "center", "size")):
        return None

    return {
        "cell_size": solver.cell_size,
        "center": solver.center,
        "size": solver.size,
    }
