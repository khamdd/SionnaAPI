from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.schemas.requests import OptimizationGuardrail, OptimizationVariable


class ImpactStudyOptimizationPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["disabled", "if_objectives_fail"] = "disabled"
    tilt_step: float = Field(default=2.0, gt=0, le=20, allow_inf_nan=False)
    power_step: float = Field(default=2.0, gt=0, le=20, allow_inf_nan=False)
    azimuth_step: float = Field(default=30.0, gt=0, le=180, allow_inf_nan=False)
    max_candidates: int = Field(default=300, ge=1, le=5000)
    eligible_antenna_ids: list[str] | None = Field(default=None, min_length=1)
    max_tilt_change: float | None = Field(default=None, gt=0, le=20, allow_inf_nan=False)
    max_power_change: float | None = Field(default=None, gt=0, le=20, allow_inf_nan=False)
    max_azimuth_change: float | None = Field(default=None, gt=0, le=180, allow_inf_nan=False)
    max_changed_antennas: int | None = Field(default=None, ge=1, le=10)
    prevent_total_power_increase: bool = False
    guardrails: list[OptimizationGuardrail] = Field(default_factory=list, max_length=4)
    variables: list[OptimizationVariable] = Field(
        default_factory=lambda: [
            OptimizationVariable(field="tilt"),
            OptimizationVariable(field="tx_power"),
            OptimizationVariable(field="azimuth"),
        ],
        min_length=1,
        max_length=3,
    )

    @model_validator(mode="after")
    def require_unique_variables(self):
        fields = [variable.field for variable in self.variables]
        if len(fields) != len(set(fields)):
            raise ValueError("optimization variables must be unique")
        guardrail_metrics = [guardrail.metric for guardrail in self.guardrails]
        if len(guardrail_metrics) != len(set(guardrail_metrics)):
            raise ValueError("optimization guardrails must use unique metrics")
        return self


class ImpactStudyCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    baseline_configuration_id: UUID
    candidate_configuration_id: UUID
    optimization_policy: ImpactStudyOptimizationPolicy = Field(
        default_factory=ImpactStudyOptimizationPolicy
    )

    @model_validator(mode="after")
    def require_different_versions(self):
        if self.baseline_configuration_id == self.candidate_configuration_id:
            raise ValueError("baseline and candidate configurations must be different")
        return self
