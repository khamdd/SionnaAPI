import math


class RuntimeAntenna:
    def __init__(self, antenna, bounds):
        self._antenna = antenna
        self.id = antenna.id
        self.longitude = antenna.longitude
        self.latitude = antenna.latitude
        self.height_m = antenna.height_m
        self.tilt = antenna.tilt
        self.azimuth = antenna.azimuth
        self.tx_power = antenna.tx_power
        self.position = lng_lat_to_scene_position(
            antenna.longitude,
            antenna.latitude,
            antenna.height_m,
            bounds,
        )

    def model_dump(self, *args, **kwargs):
        return self._antenna.model_dump(*args, **kwargs)


def with_runtime_antenna_positions(req, scene_info):
    antennas = getattr(req, "antennas", None)

    if not antennas:
        return req

    bounds = (scene_info or {}).get("bounds")
    if not bounds:
        raise ValueError("Selected scene bounds are required for antenna conversion.")

    runtime_antennas = [
        RuntimeAntenna(validate_antenna_bounds(antenna, bounds), bounds)
        for antenna in antennas
    ]

    return req.model_copy(update={"antennas": runtime_antennas})


def validate_antenna_bounds(antenna, bounds):
    if antenna.longitude is None or antenna.latitude is None:
        raise ValueError(f"Antenna {antenna.id} must include longitude and latitude.")

    if antenna.height_m is None:
        raise ValueError(f"Antenna {antenna.id} must include height_m.")

    if not lng_lat_inside_bounds(antenna.longitude, antenna.latitude, bounds):
        raise ValueError(
            f"Antenna {antenna.id} must stay inside the selected scene bounds."
        )

    return antenna


def lng_lat_to_scene_position(longitude, latitude, height_m, bounds):
    center_lat = (float(bounds["south"]) + float(bounds["north"])) / 2.0
    center_lng = (float(bounds["west"]) + float(bounds["east"])) / 2.0
    meters_per_degree_lat = 111_320.0
    meters_per_degree_lng = meters_per_degree_lat * max(
        math.cos(math.radians(center_lat)),
        0.01,
    )

    return (
        (float(longitude) - center_lng) * meters_per_degree_lng,
        (float(latitude) - center_lat) * meters_per_degree_lat,
        float(height_m),
    )


def lng_lat_inside_bounds(longitude, latitude, bounds):
    return (
        float(bounds["west"]) <= float(longitude) <= float(bounds["east"])
        and float(bounds["south"]) <= float(latitude) <= float(bounds["north"])
    )
