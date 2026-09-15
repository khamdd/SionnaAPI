import math
from typing import List, Literal, Tuple

from pydantic import BaseModel, ConfigDict, Field, model_serializer, model_validator

from backend.constants import (
    DEFAULT_RSRP_USER_COUNT,
    DEFAULT_TRANSMITTER_PATTERN,
    DEFAULT_USER_HEIGHT_M,
    MAX_GRID_CELLS,
    MAX_RSRP_USER_COUNT,
)


class SolverConfig(BaseModel):
    max_depth: int = Field(default=5, ge=0, le=10)
    samples_per_tx: int = Field(default=10**6, gt=0, le=10**7)
    cell_size: float = Field(default=2.0, gt=0, le=50.0)
    center: Tuple[float, float, float] = (
        0.0,
        0.0,
        0.0,
    )

    size: Tuple[float, float] = (
        400.0,
        400.0,
    )

    @model_validator(mode="after")
    def validate_grid_size(self):
        if self.size[0] <= 0 or self.size[1] <= 0:
            raise ValueError("solver size values must be greater than 0")

        cells = (self.size[0] / self.cell_size) * (self.size[1] / self.cell_size)
        if cells > MAX_GRID_CELLS:
            raise ValueError("simulation grid is too large")
        return self


class CoverageRequest(BaseModel):
    tilt: float

    azimuth: float = Field(
        default=0.0,
        ge=0.0,
        le=360.0,
    )

    transmitter_position: Tuple[
        float,
        float,
        float
    ]

    tx_power: float = 30.0

    transmitter_pattern: str = DEFAULT_TRANSMITTER_PATTERN

    solver: SolverConfig = Field(
        default_factory=SolverConfig
    )


class RangeValue(BaseModel):
    min: float
    current: float
    max: float

    @model_validator(mode="after")
    def validate_current_inside_range(self):
        if self.min > self.max:
            raise ValueError("min must be less than or equal to max")

        if not self.min <= self.current <= self.max:
            raise ValueError("current must be between min and max")

        return self


class AntennaConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str

    longitude: float | None = Field(default=None, ge=-180.0, le=180.0)
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0)
    height_m: float | None = Field(default=None, gt=0.0)

    tilt: RangeValue
    azimuth: float = Field(ge=0.0, le=360.0)
    tx_power: RangeValue


class NetworkCoverageRequest(BaseModel):
    antennas: List[AntennaConfig] = Field(
        min_length=1,
        max_length=10,
    )

    transmitter_pattern: str = DEFAULT_TRANSMITTER_PATTERN

    solver: SolverConfig = Field(
        default_factory=SolverConfig
    )

    bandwidth_mhz: float = Field(
        default=100.0,
        gt=0,
    )

    mimo_layers: int = Field(
        default=4,
        gt=0,
    )


class OptimizationObjective(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["aggregate", "threshold_area", "percentile"] = "aggregate"
    metric: Literal[
        "uncovered_area_percent",
        "covered_area_percent",
        "overlap_area_percent",
        "average_overlap_count",
    ] | None = None
    measurement: Literal["rsrp_dbm", "sinr_db", "throughput_mbps"] | None = None
    threshold_operator: Literal["<", ">", "<=", ">="] | None = None
    threshold: float | None = Field(default=None, allow_inf_nan=False)
    percentile: int | None = Field(default=None, ge=1, le=99)
    operator: Literal["<", ">", "<=", ">=", "="]
    target: float = Field(allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_objective_shape(self):
        if self.kind == "aggregate":
            if self.metric is None:
                raise ValueError("Aggregate objectives require a metric")
            if self.target < 0:
                raise ValueError("Aggregate objective targets must not be negative")
            limit = 10 if self.metric == "average_overlap_count" else 100
            if self.target > limit:
                raise ValueError(f"Target must not exceed {limit}")
            if any(
                value is not None
                for value in (
                    self.measurement,
                    self.threshold_operator,
                    self.threshold,
                    self.percentile,
                )
            ):
                raise ValueError("Aggregate objectives only accept metric, operator, and target")
            return self

        if self.metric is not None:
            raise ValueError("RF objectives use measurement instead of metric")
        if self.measurement is None:
            raise ValueError("RF objectives require a measurement")
        if self.measurement == "throughput_mbps" and self.target < 0:
            raise ValueError("Throughput targets must not be negative")

        if self.kind == "threshold_area":
            if self.threshold is None or self.threshold_operator is None:
                raise ValueError(
                    "Threshold-area objectives require a threshold and threshold operator"
                )
            if self.percentile is not None:
                raise ValueError("Threshold-area objectives do not accept a percentile")
            if self.target < 0 or self.target > 100:
                raise ValueError("Threshold-area targets must be between 0 and 100")
            return self

        if self.percentile is None:
            raise ValueError("Percentile objectives require a percentile")
        if self.threshold is not None or self.threshold_operator is not None:
            raise ValueError("Percentile objectives do not accept threshold fields")
        return self

    def identity_key(self):
        if self.kind == "aggregate":
            return (self.kind, self.metric)
        if self.kind == "threshold_area":
            return (self.kind, self.measurement)
        return (self.kind, self.measurement, self.percentile)

    @model_serializer(mode="wrap")
    def serialize_objective(self, handler):
        data = handler(self)
        if self.kind == "aggregate":
            data.pop("kind", None)
        for key in tuple(data):
            if data[key] is None:
                data.pop(key)
        return data


class OptimizationVariable(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: Literal["tilt", "tx_power", "azimuth"]
    scope: Literal["enabled_antennas"] = "enabled_antennas"


class OptimizationGuardrail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metric: Literal[
        "covered_area_percent",
        "uncovered_area_percent",
        "overlap_area_percent",
        "average_overlap_count",
        "rsrp_dbm_p10",
        "sinr_db_p10",
        "throughput_mbps_p10",
    ]
    max_regression: float = Field(default=0.0, ge=0, allow_inf_nan=False)


class NetworkCoverageOptimizationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_id: str | None = Field(
        default=None,
        min_length=1,
    )

    base_request: NetworkCoverageRequest
    tilt_step: float = Field(default=2.0, gt=0, le=20, allow_inf_nan=False)
    power_step: float = Field(default=2.0, gt=0, le=20, allow_inf_nan=False)
    azimuth_step: float = Field(default=30.0, gt=0, le=180, allow_inf_nan=False)
    max_candidates: int = Field(default=300, ge=1, le=5000)
    eligible_antenna_ids: List[str] | None = Field(default=None, min_length=1)
    max_tilt_change: float | None = Field(default=None, gt=0, le=20, allow_inf_nan=False)
    max_power_change: float | None = Field(default=None, gt=0, le=20, allow_inf_nan=False)
    max_azimuth_change: float | None = Field(default=None, gt=0, le=180, allow_inf_nan=False)
    max_changed_antennas: int | None = Field(default=None, ge=1, le=10)
    prevent_total_power_increase: bool = False

    objectives: List[OptimizationObjective] = Field(
        min_length=1,
        max_length=4,
    )

    variables: List[OptimizationVariable] = Field(
        default_factory=lambda: [
            OptimizationVariable(field="tilt"),
            OptimizationVariable(field="tx_power"),
            OptimizationVariable(field="azimuth"),
        ],
        min_length=1,
        max_length=3,
    )
    guardrails: List[OptimizationGuardrail] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def validate_unique_objective_metrics(self):
        antenna_ids = [antenna.id for antenna in self.base_request.antennas]
        if len(antenna_ids) != len(set(antenna_ids)):
            raise ValueError("Optimization antennas must have unique IDs")
        if self.eligible_antenna_ids is not None:
            if len(self.eligible_antenna_ids) != len(set(self.eligible_antenna_ids)):
                raise ValueError("eligible antenna IDs must be unique")
            unknown = set(self.eligible_antenna_ids).difference(antenna_ids)
            if unknown:
                raise ValueError("eligible antenna IDs must belong to the base request")
        objective_keys = [objective.identity_key() for objective in self.objectives]
        if len(objective_keys) != len(set(objective_keys)):
            raise ValueError("optimization objectives must be unique")
        guardrail_metrics = [guardrail.metric for guardrail in self.guardrails]
        if len(guardrail_metrics) != len(set(guardrail_metrics)):
            raise ValueError("optimization guardrails must use unique metrics")
        return self

    @model_serializer(mode="wrap")
    def serialize_request(self, handler):
        data = handler(self)
        for key in (
            "eligible_antenna_ids",
            "max_tilt_change",
            "max_power_change",
            "max_azimuth_change",
            "max_changed_antennas",
        ):
            if data.get(key) is None:
                data.pop(key, None)
        if not data.get("prevent_total_power_increase"):
            data.pop("prevent_total_power_increase", None)
        if not data.get("guardrails"):
            data.pop("guardrails", None)
        return data


class RSRPRequest(BaseModel):
    antennas: List[AntennaConfig] = Field(
        min_length=1,
        max_length=10,
    )

    transmitter_pattern: str = DEFAULT_TRANSMITTER_PATTERN

    solver: SolverConfig = Field(
        default_factory=SolverConfig
    )

    user_count: int = Field(
        default=DEFAULT_RSRP_USER_COUNT,
        ge=1,
        le=MAX_RSRP_USER_COUNT,
    )

    user_height_m: float = Field(
        default=DEFAULT_USER_HEIGHT_M,
        ge=0.5,
        le=10.0,
    )

    random_seed: int = Field(
        default=42,
        ge=0,
    )


class SINRRequest(BaseModel):
    propagation_model: Literal["sionna", "uma", "ericsson", "friis"] = "sionna"

    carrier_frequency_ghz: float = Field(default=3.5, gt=0.0, le=100.0)

    bandwidth_mhz: float = Field(default=100.0, gt=0.0)

    noise_figure_db: float = Field(default=7.0, ge=0.0, le=30.0)

    tilt: float

    transmitter_position: Tuple[
        float,
        float,
        float
    ]

    receiver_position: Tuple[
        float,
        float,
        float
    ]

    interferer_position: Tuple[
        float,
        float,
        float
    ] = (
        120.0,
        100.0,
        25.0,
    )

    interferer_tilt: float = 12.0

    tx_power: float = 30.0

    interferer_tx_power: float | None = None

    transmitter_pattern: str = DEFAULT_TRANSMITTER_PATTERN

    solver: SolverConfig = Field(
        default_factory=SolverConfig
    )


class ThroughputRequest(BaseModel):
    propagation_model: Literal["sionna", "uma", "ericsson", "friis"] = "sionna"

    carrier_frequency_ghz: float = Field(default=3.5, gt=0.0, le=100.0)

    noise_figure_db: float = Field(default=7.0, ge=0.0, le=30.0)

    base_tilt: float

    target_tilt: float

    transmitter_position: Tuple[
        float,
        float,
        float
    ]

    receiver_position: Tuple[
        float,
        float,
        float
    ]

    interferer_position: Tuple[
        float,
        float,
        float
    ] = (
        120.0,
        100.0,
        25.0,
    )

    interferer_tilt: float = 12.0

    tx_power: float = 30.0

    interferer_tx_power: float | None = None

    transmitter_pattern: str = DEFAULT_TRANSMITTER_PATTERN

    bandwidth_mhz: float = Field(
        default=100.0,
        gt=0,
    )

    mimo_layers: int = Field(
        default=4,
        gt=0,
    )

    solver: SolverConfig = Field(
        default_factory=SolverConfig
    )


class WardBoundaryProperties(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ward_code: str = Field(min_length=1, max_length=16)
    ward_name: str = Field(min_length=1, max_length=120)
    ward_full_name: str | None = Field(default=None, max_length=160)


class WardBoundaryGeometry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["Polygon", "MultiPolygon"]
    coordinates: list

    @model_validator(mode="after")
    def validate_coordinates(self):
        polygons = [self.coordinates] if self.type == "Polygon" else self.coordinates

        if not polygons:
            raise ValueError("ward boundary must contain at least one polygon")

        point_count = 0
        for polygon in polygons:
            if not isinstance(polygon, list) or not polygon:
                raise ValueError("ward boundary polygons must contain rings")

            for ring in polygon:
                if not isinstance(ring, list) or len(ring) < 4:
                    raise ValueError("ward boundary rings must contain at least four points")

                normalized_ring = []
                for point in ring:
                    if not isinstance(point, list) or len(point) < 2:
                        raise ValueError("ward boundary points must be longitude/latitude pairs")

                    longitude = float(point[0])
                    latitude = float(point[1])
                    if (
                        not math.isfinite(longitude)
                        or not math.isfinite(latitude)
                        or longitude < -180.0
                        or longitude > 180.0
                        or latitude < -90.0
                        or latitude > 90.0
                    ):
                        raise ValueError("ward boundary coordinates are invalid")

                    normalized_ring.append((longitude, latitude))
                    point_count += 1
                    if point_count > 100_000:
                        raise ValueError("ward boundary contains too many points")

                if normalized_ring[0] != normalized_ring[-1]:
                    raise ValueError("ward boundary rings must be closed")

        return self

    def points(self):
        polygons = [self.coordinates] if self.type == "Polygon" else self.coordinates
        for polygon in polygons:
            for ring in polygon:
                for point in ring:
                    yield float(point[0]), float(point[1])


class WardBoundaryFeature(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["Feature"] = "Feature"
    properties: WardBoundaryProperties
    geometry: WardBoundaryGeometry


class SceneBoundsRequest(BaseModel):
    name: str | None = Field(
        default=None,
        max_length=80,
    )

    fixed_antennas: List[AntennaConfig] = Field(
        default_factory=list,
    )

    ward_boundary: WardBoundaryFeature | None = None

    south: float = Field(
        ge=-90.0,
        le=90.0,
    )

    west: float = Field(
        ge=-180.0,
        le=180.0,
    )

    north: float = Field(
        ge=-90.0,
        le=90.0,
    )

    east: float = Field(
        ge=-180.0,
        le=180.0,
    )

    @model_validator(mode="after")
    def validate_bounds(self):
        if self.south >= self.north:
            raise ValueError("south must be less than north")

        if self.west >= self.east:
            raise ValueError("west must be less than east")

        if self.ward_boundary:
            tolerance = 1e-6
            for longitude, latitude in self.ward_boundary.geometry.points():
                if not (
                    self.west - tolerance <= longitude <= self.east + tolerance
                    and self.south - tolerance <= latitude <= self.north + tolerance
                ):
                    raise ValueError("ward boundary must stay inside the selected scene bounds")

        return self
