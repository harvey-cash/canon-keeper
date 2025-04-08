# config.py

import os
from pathlib import Path

# Get the directory containing this config.py file.
# This assumes config.py lives directly in the 'server' directory alongside main.py.
_server_dir = Path(__file__).resolve().parent

# Define the resource base directory relative to the server directory.
RESOURCE_BASE_DIR = _server_dir / "resources"

# Print the determined path for verification during startup
print(f"Config: Determined RESOURCE_BASE_DIR = {RESOURCE_BASE_DIR}")

# Remove the previous dependency on src.file_io for this core path.
# src.file_io.resource_path is still useful in main.py for finding bundled web assets.