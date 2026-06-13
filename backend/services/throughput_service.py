from backend.exceptions import ClientInputError
from backend.schemas.requests import ThroughputRequest
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
            req.tx_power,
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
