# resource_manager.py

import io
import json
import os
import re
import shutil
import uuid
import typing
from pathlib import Path

# Use typing.TYPE_CHECKING to avoid circular imports for type hints if needed,
# but FastAPI UploadFile is likely okay as it's a standard type.
from fastapi import UploadFile

from resource_model import (
    ResourceType, ResourceMetadata,
    ResourceNotFoundError, ResourceSaveError, InvalidResourceIdError, InvalidResourceTypeError
)

FILENAME_SEPARATOR = "__"

class ResourceManager:
    def __init__(self, base_dir: Path):
        if not isinstance(base_dir, Path):
            base_dir = Path(base_dir)
        self.base_dir = base_dir.resolve() # Use absolute path
        self._ensure_directories()
        print(f"ResourceManager initialized. Base directory: {self.base_dir}")

    def _ensure_directories(self):
        """Creates base and subdirectories if they don't exist."""
        try:
            self.base_dir.mkdir(parents=True, exist_ok=True)
            for resource_type in ResourceType:
                self._get_resource_dir(resource_type).mkdir(parents=True, exist_ok=True)
        except OSError as e:
            print(f"Error creating resource directories under {self.base_dir}: {e}")
            raise ResourceSaveError(f"Could not create resource directories: {e}") from e

    def _get_resource_dir(self, resource_type: ResourceType) -> Path:
        """Gets the directory path for a given resource type."""
        return self.base_dir / resource_type.value

    def _sanitize_filename_part(self, name_part: str) -> str:
        """Removes potentially problematic characters for filename hints."""
        name_part = re.sub(r'[\\/*?:"<>|\x00-\x1f]', '', name_part) # Remove forbidden chars
        name_part = re.sub(r'\s+', '_', name_part) # Replace whitespace
        name_part = name_part.replace(FILENAME_SEPARATOR, '_') # Avoid separator collision
        return name_part[:100] # Limit length

    def _validate_resource_id(self, resource_id: str):
        """Raises InvalidResourceIdError if format is invalid."""
        if not resource_id or ".." in resource_id or "/" in resource_id or "\\" in resource_id:
             raise InvalidResourceIdError(f"Invalid resource ID format detected.")
        try:
             # Check if it's a valid UUID format string
             uuid.UUID(resource_id)
        except ValueError:
             raise InvalidResourceIdError(f"Resource ID is not a valid UUID: {resource_id}")

    def _construct_stored_filename(self, resource_id: str, sanitized_hint: str, extension: str) -> str:
         """Constructs the filename used for storage (uuid__hint.ext)."""
         # Ensure extension starts with a dot
         if extension and not extension.startswith('.'):
             extension = f".{extension}"
         # Ensure hint is not empty after sanitization
         hint_to_use = sanitized_hint if sanitized_hint else "file"
         return f"{resource_id}{FILENAME_SEPARATOR}{hint_to_use}{extension}"

    def _parse_stored_filename(self, filename: str) -> tuple[str, str]:
        """Parses stored filename into (UUID, original_hint_with_extension)."""
        if FILENAME_SEPARATOR not in filename:
             raise ValueError(f"Filename '{filename}' doesn't match expected format 'uuid{FILENAME_SEPARATOR}hint.ext'")
        id_part, hint_with_ext = filename.split(FILENAME_SEPARATOR, 1)
        # Basic validation on parsed ID part
        try:
            uuid.UUID(id_part)
        except ValueError:
            raise ValueError(f"Parsed ID '{id_part}' from filename '{filename}' is not a valid UUID.")
        return id_part, hint_with_ext

    def _find_resource_file(self, resource_id: str, resource_type: ResourceType) -> tuple[Path, str]:
        """Finds the file path and returns (absolute_path, stored_filename). Handles validation."""
        self._validate_resource_id(resource_id) # Check ID format first
        resource_dir = self._get_resource_dir(resource_type)
        pattern = f"{resource_id}{FILENAME_SEPARATOR}*"
        matches = list(resource_dir.glob(pattern))

        if not matches:
            raise ResourceNotFoundError(f"Resource '{resource_id}' of type '{resource_type.value}' not found.")
        if len(matches) > 1:
             # This shouldn't happen with UUIDs but log if it does
             print(f"Warning: Multiple files found for resource ID {resource_id} in {resource_dir}. Using first match: {matches[0]}")

        file_path = matches[0].resolve() # Use absolute path
        # Final check: ensure the found file is within the intended resource directory
        if self.base_dir not in file_path.parents:
             raise SecurityError(f"Resolved path '{file_path}' is outside the base resource directory '{self.base_dir}'.")

        return file_path, file_path.name

    async def save_uploaded_file(self, file: UploadFile, resource_type: ResourceType) -> ResourceMetadata:
        """Saves an uploaded file, returns its metadata."""
        resource_id = str(uuid.uuid4())
        # Use provided filename, fallback if empty
        original_name = file.filename if file.filename else f"upload_{resource_id}"
        sanitized_hint_part = self._sanitize_filename_part(Path(original_name).stem)
        extension = Path(original_name).suffix.lower()
        stored_filename = self._construct_stored_filename(resource_id, sanitized_hint_part, extension)
        file_path = self._get_resource_dir(resource_type) / stored_filename

        metadata = ResourceMetadata(
            id=resource_id,
            original_name=original_name,
            type=resource_type,
            stored_filename=stored_filename
        )

        try:
            # Use async file writing if possible, or read then write
            content = await file.read()
            with open(file_path, "wb") as buffer:
                buffer.write(content)
            print(f"Saved uploaded file: {file_path}")
        except IOError as e:
            print(f"IOError saving uploaded file {original_name} as {stored_filename}: {e}")
            # Attempt cleanup of partial file
            if file_path.exists():
                try: file_path.unlink()
                except OSError: pass
            raise ResourceSaveError(f"Failed to write uploaded file '{original_name}'. Check permissions and disk space.") from e
        except Exception as e:
             print(f"Unexpected error saving uploaded file {original_name} as {stored_filename}: {e}")
             if file_path.exists():
                 try: file_path.unlink()
                 except OSError: pass
             raise ResourceSaveError(f"An unexpected error occurred while saving '{original_name}'.") from e
        finally:
            # Ensure file handle is closed, though UploadFile often handles this
            try:
                 await file.close()
            except Exception:
                 pass # Ignore errors during close

        return metadata

    def save_generated_data(self, data: bytes | str | dict | io.BytesIO, resource_type: ResourceType, input_original_name: str, output_suffix: str, extension: str) -> ResourceMetadata:
        """Saves generated data (bytes, string, dict, BytesIO), returns metadata."""
        resource_id = str(uuid.uuid4())
        base_name = Path(input_original_name).stem
        derived_original_name = f"{base_name}{output_suffix}.{extension.lstrip('.')}"
        sanitized_hint_part = self._sanitize_filename_part(f"{base_name}{output_suffix}")
        full_extension = f".{extension.lstrip('.')}"
        stored_filename = self._construct_stored_filename(resource_id, sanitized_hint_part, full_extension)
        file_path = self._get_resource_dir(resource_type) / stored_filename

        metadata = ResourceMetadata(
            id=resource_id,
            original_name=derived_original_name,
            type=resource_type,
            stored_filename=stored_filename
        )

        try:
            mode = "w" if isinstance(data, (str, dict)) else "wb"
            encoding = "utf-8" if mode == "w" else None
            with open(file_path, mode, encoding=encoding) as f:
                if isinstance(data, dict):
                    json.dump(data, f, indent=4)
                elif isinstance(data, str):
                    f.write(data)
                elif isinstance(data, bytes):
                    f.write(data)
                elif isinstance(data, io.BytesIO):
                     data.seek(0) # Reset stream pointer
                     shutil.copyfileobj(data, f) # Efficiently copy stream
                else:
                    # Should not happen with type hints, but safeguard
                    raise TypeError(f"Unsupported data type for saving: {type(data)}")
            print(f"Saved generated data: {file_path}")
        except (IOError, TypeError) as e:
            print(f"Error saving generated data resource {derived_original_name} as {stored_filename}: {e}")
            if file_path.exists():
                try: file_path.unlink()
                except OSError: pass
            raise ResourceSaveError(f"Failed to save generated resource '{derived_original_name}'.") from e
        except Exception as e:
             print(f"Unexpected error saving generated data {derived_original_name} as {stored_filename}: {e}")
             if file_path.exists():
                 try: file_path.unlink()
                 except OSError: pass
             raise ResourceSaveError(f"An unexpected error occurred while saving generated data '{derived_original_name}'.") from e

        return metadata

    def load_bytes(self, resource_id: str, resource_type: ResourceType) -> io.BytesIO:
        """Loads resource content as BytesIO."""
        file_path, _ = self._find_resource_file(resource_id, resource_type)
        try:
            with open(file_path, "rb") as f:
                return io.BytesIO(f.read())
        except IOError as e:
            raise ResourceNotFoundError(f"Error reading resource file {file_path.name}: {e}") from e

    def load_text(self, resource_id: str, resource_type: ResourceType) -> str:
        """Loads resource content as text."""
        file_path, _ = self._find_resource_file(resource_id, resource_type)
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
        except IOError as e:
             raise ResourceNotFoundError(f"Error reading resource file {file_path.name}: {e}") from e
        except UnicodeDecodeError as e:
            raise InvalidResourceTypeError(f"Resource {resource_id} is not valid UTF-8 text: {e}") from e

    def load_json(self, resource_id: str, resource_type: ResourceType) -> dict:
        """Loads resource content as JSON (dict)."""
        file_path, _ = self._find_resource_file(resource_id, resource_type)
        try:
             with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except IOError as e:
             raise ResourceNotFoundError(f"Error reading resource file {file_path.name}: {e}") from e
        except json.JSONDecodeError as e:
            raise InvalidResourceTypeError(f"Resource {resource_id} is not valid JSON: {e}") from e

    def get_resource_path(self, resource_id: str, resource_type: ResourceType) -> Path:
         """Returns the full, resolved path to the resource file."""
         file_path, _ = self._find_resource_file(resource_id, resource_type)
         return file_path

    def get_resource_metadata(self, resource_id: str, resource_type: ResourceType) -> ResourceMetadata:
        """Retrieves metadata for a resource without loading its content."""
        file_path, stored_filename = self._find_resource_file(resource_id, resource_type)
        # Reconstruct metadata by parsing the filename found on disk
        try:
            parsed_id, original_hint_with_ext = self._parse_stored_filename(stored_filename)
            if parsed_id != resource_id:
                # Sanity check - should not happen if _find_resource_file is correct
                raise ResourceNotFoundError(f"ID mismatch: Found '{parsed_id}' when searching for '{resource_id}'.")

            # Use the parsed hint from the filename as the 'original_name' for the metadata object.
            # This reflects the name stored, derived from either upload or generation process.
            return ResourceMetadata(
                id=resource_id,
                original_name=original_hint_with_ext,
                type=resource_type,
                stored_filename=stored_filename
            )
        except ValueError as e: # Catch parsing errors
             raise ResourceNotFoundError(f"Could not parse metadata from filename '{stored_filename}': {e}") from e


    def list_resources(self) -> list[ResourceMetadata]:
        """Lists metadata for all available resources."""
        all_metadata = []
        for resource_type in ResourceType:
            resource_dir = self._get_resource_dir(resource_type)
            if not resource_dir.is_dir(): # Skip if directory doesn't exist
                continue
            try:
                # Glob for files matching the UUID__hint.ext pattern
                for file_path in resource_dir.glob(f"*{FILENAME_SEPARATOR}*"):
                    if file_path.is_file():
                        try:
                            stored_filename = file_path.name
                            resource_id, original_hint_with_ext = self._parse_stored_filename(stored_filename)
                            # No need to validate UUID again here, _parse does basic check

                            metadata = ResourceMetadata(
                                id=resource_id,
                                original_name=original_hint_with_ext, # Use parsed hint
                                type=resource_type,
                                stored_filename=stored_filename
                            )
                            all_metadata.append(metadata)
                        except ValueError as e: # Catch parsing errors from _parse_stored_filename
                            print(f"Skipping file with unexpected format '{file_path.name}': {e}")
                        except Exception as e:
                            # Catch other unexpected errors during processing of a single file
                            print(f"Error processing file {file_path} for listing: {e}")
            except Exception as e:
                 # Catch errors related to listing the directory itself
                 print(f"Error listing resources in {resource_dir}: {e}")
                 # Continue to the next resource type

        # Sort consistently by type, then original name
        all_metadata.sort(key=lambda x: (x.type.value, x.original_name))
        return all_metadata

    def delete_resource(self, resource_id: str, resource_type: ResourceType) -> None:
        """Deletes the physical file for a resource."""
        file_path, stored_filename = self._find_resource_file(resource_id, resource_type)
        try:
            file_path.unlink()
            print(f"Deleted resource file: {file_path}")
        except OSError as e:
            print(f"Error deleting resource file {file_path}: {e}")
            # Raise as ResourceSaveError as it's a failure in modifying stored resources
            raise ResourceSaveError(f"Failed to delete resource file '{stored_filename}'. Check permissions.") from e