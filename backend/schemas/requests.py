from typing import List, Literal, Tuple

from pydantic import BaseModel, ConfigDict, Field, model_validator

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

    metric: Literal[
        "uncovered_area_percent",
        "covered_area_percent",
        "overlap_area_percent",
        "average_overlap_count",
    ]
    operator: Literal["<", ">", "<=", ">=", "="]
    target: float = Field(ge=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_target_range(self):
        limit = 10 if self.metric == "average_overlap_count" else 100
        if self.target > limit:
            raise ValueError(f"Target must not exceed {limit}")
        return self


class OptimizationVariable(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: Literal["tilt", "tx_power", "azimuth"]
    scope: Literal["enabled_antennas"] = "enabled_antennas"


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

    objectives: List[OptimizationObjective] = Field(
        min_length=1,
        max_length=2,
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

    @model_validator(mode="after")
    def validate_unique_objective_metrics(self):
        antenna_ids = [antenna.id for antenna in self.base_request.antennas]
        if len(antenna_ids) != len(set(antenna_ids)):
            raise ValueError("Optimization antennas must have unique IDs")
        metrics = [
            objective.metric
            for objective in self.objectives
        ]
        if len(metrics) != len(set(metrics)):
            raise ValueError("optimization objectives must use unique metrics")
        return self


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


class SceneBoundsRequest(BaseModel):
    name: str | None = Field(
        default=None,
        max_length=80,
    )

    fixed_antennas: List[AntennaConfig] = Field(
        default_factory=list,
    )

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

        return self
