# resource_model.py

import uuid
from enum import Enum
from pathlib import Path
from pydantic import BaseModel, Field

class ResourceType(Enum):
    VIDEO = "video"
    AUDIO = "audio"
    SNIPPET = "snippet" # For speaker identification audio snippets
    JSON_TRANSCRIPT = "json_transcript"
    JSON_SPEAKER_MAP = "json_speaker_map"
    TEXT_SESSION = "text_session"
    TEXT_RECAP = "text_recap"
    TEXT_SUMMARY = "text_summary"
    TEXT_PROMPT = "text_prompt" # For recap/summary prompts

class ResourceMetadata(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    original_name: str # User-facing name (uploaded filename or derived name)
    type: ResourceType # Store as Enum member
    stored_filename: str # Actual filename on disk (e.g., uuid__hint.ext)

    # REMOVED Config class:
    # class Config:
    #    use_enum_values = True

# --- Custom Exceptions ---
# (Exceptions remain the same)
class ResourceError(Exception):
    """Base class for resource-related errors."""
    pass

class ResourceNotFoundError(ResourceError):
    """Raised when a resource file cannot be found."""
    pass

class ResourceSaveError(ResourceError):
    """Raised when saving a resource fails."""
    pass

class InvalidResourceIdError(ValueError, ResourceError):
    """Raised for invalid resource ID format (inherits ValueError for some compatibility)."""
    pass

class InvalidResourceTypeError(ValueError, ResourceError):
    """Raised for invalid resource type or content mismatch."""
    pass