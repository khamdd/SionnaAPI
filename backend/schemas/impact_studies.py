from uuid import UUID

from pydantic import BaseModel, ConfigDict, model_validator


class ImpactStudyCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    baseline_configuration_id: UUID
    candidate_configuration_id: UUID

    @model_validator(mode="after")
    def require_different_versions(self):
        if self.baseline_configuration_id == self.candidate_configuration_id:
            raise ValueError("baseline and candidate configurations must be different")
        return self
