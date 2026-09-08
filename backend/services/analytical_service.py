import math

from backend.services.pathgain_model import PathGainModel


MODEL_NAMES = {
    "uma": "UMa",
    "ericsson": "Ericsson",
    "friis": "Friis",
}
THERMAL_NOISE_DENSITY_DBM_HZ = -174.0


def calculate_selected_analytical_link(req):
    try:
        model = MODEL_NAMES[req.propagation_model]
    except KeyError as exc:
        raise ValueError(
            f"Unsupported analytical propagation model: {req.propagation_model}"
        ) from exc

    return calculate_analytical_link(req, model)


def calculate_analytical_link(req, model):
    frequency_hz = float(req.carrier_frequency_ghz) * 1e9
    signal_power_dbm = received_power_dbm(
        req.transmitter_position,
        req.receiver_position,
        req.tx_power,
        frequency_hz,
        model,
    )
    interference_power_dbm = received_power_dbm(
        req.interferer_position,
        req.receiver_position,
        interferer_power(req),
        frequency_hz,
        model,
    )
    thermal_noise_power_dbm = (
        THERMAL_NOISE_DENSITY_DBM_HZ
        + 10.0 * math.log10(float(req.bandwidth_mhz) * 1e6)
        + float(req.noise_figure_db)
    )
    interference_plus_noise_dbm = watts_to_dbm(
        dbm_to_watts(interference_power_dbm)
        + dbm_to_watts(thermal_noise_power_dbm)
    )
    sinr_db = signal_power_dbm - interference_plus_noise_dbm

    return {
        "model": model,
        "sinr_db": round(sinr_db, 2),
        "signal_power_dbm": round(signal_power_dbm, 2),
        "interference_power_dbm": round(interference_power_dbm, 2),
        "thermal_noise_power_dbm": round(thermal_noise_power_dbm, 2),
        "interference_plus_noise_power_dbm": round(
            interference_plus_noise_dbm,
            2,
        ),
    }


def interferer_power(req):
    value = getattr(req, "interferer_tx_power", None)
    return req.tx_power if value is None else value


def received_power_dbm(tx_position, rx_position, tx_power_dbm, frequency_hz, model):
    distance_m = math.dist(tx_position, rx_position)
    return PathGainModel(
        distance_m=distance_m,
        antenna_height=float(tx_position[2]),
        ue_height=float(rx_position[2]),
        fc_hz=frequency_hz,
    ).received_power(tx_power_dbm, model)


def dbm_to_watts(value):
    return 10.0 ** ((float(value) - 30.0) / 10.0)


def watts_to_dbm(value):
    return 10.0 * math.log10(float(value)) + 30.0
