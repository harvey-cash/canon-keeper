# server/build_server.py
import os
import platform
import subprocess
import sys

print("--- Starting Server Build Script ---")

# --- Configuration ---
VENV_NAME = ".venv"
OUTPUT_NAME = "CanonKeeper"
ENTRY_SCRIPT = "main.py"  # Relative to SERVER_DIR

# --- Determine Paths ---
SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SERVER_DIR)  # Go one level up for root
VENV_DIR = os.path.join(PROJECT_ROOT, VENV_NAME)  # venv is in root

print(f"Project root directory: {PROJECT_ROOT}")
print(f"Server directory: {SERVER_DIR}")
print(f"Expected venv directory: {VENV_DIR}")

# Determine Python executable path within the ROOT virtual environment
if platform.system() == "Windows":
    python_exe = os.path.join(VENV_DIR, "Scripts", "python.exe")
    path_separator = ";"
else:  # Linux/macOS
    python_exe = os.path.join(VENV_DIR, "bin", "python")
    path_separator = ":"

print(f"Expected Python executable (from root venv): {python_exe}")

# Check if the virtual environment's Python exists
if not os.path.exists(python_exe):
    print(f"\nERROR: Root Python executable not found at '{python_exe}'.")
    print(
        f"Please ensure the virtual environment '{VENV_NAME}' \
        exists in the project root '{PROJECT_ROOT}'"
    )
    print("and contains the necessary packages (including 'pyinstaller').")
    print(
        f"You might need to run: python -m venv {VENV_NAME} && <activate> && \
            pip install -r requirements.txt (in the root directory)"
    )
    sys.exit(1)

# --- Prepare PyInstaller Command ---
# Use the virtual environment's Python to run PyInstaller module
pyinstaller_command = [
    python_exe,  # Use python from root/.venv
    "-m",
    "PyInstaller",
    "--name", OUTPUT_NAME,
    # --add-data paths are relative to the CWD set in subprocess.run (SERVER_DIR)
    "--add-data", f"web_content{path_separator}web_content",
    "--add-data", f"src{path_separator}src",
    "--onedir",
    "--clean",
    "-y", # Overwrite any existing build files
    "--icon", "./web_content/favicon.ico", 
    # "--windowed", # Optional
    ENTRY_SCRIPT,  # Entry script relative to CWD (SERVER_DIR)
]

print("\nPyInstaller Command Prepared:")
print(" ".join(f'"{arg}"' if " " in arg else arg for arg in pyinstaller_command))
# Note: CWD for execution will be SERVER_DIR
print(f"\nRunning PyInstaller (CWD will be set to: {SERVER_DIR})...")


# --- Execute PyInstaller ---
# Run the command, setting the Current Working Directory to SERVER_DIR
try:
    process = subprocess.run(
        pyinstaller_command,
        cwd=SERVER_DIR,  # <--- IMPORTANT: Run PyInstaller AS IF we are in server dir
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    print("\n--- PyInstaller stdout ---")
    print(process.stdout)
    print("\n--- PyInstaller build successful ---")
    print(f"Executable created in '{os.path.join(SERVER_DIR, 'dist')}'")

except subprocess.CalledProcessError as e:
    print("\n--- PYINSTALLER FAILED ---")
    # ... (error handling as before) ...
    print(f"Exit code: {e.returncode}")
    print("\n--- PyInstaller stdout ---")
    print(e.stdout)
    print("\n--- PyInstaller stderr ---")
    print(e.stderr)
    sys.exit(e.returncode)
except FileNotFoundError:
    print(
        f"\nERROR: Could not run command. Is '{python_exe}' a valid Python \
            executable in the root venv?"
    )
    sys.exit(1)
except Exception as e:
    print(f"\nAn unexpected error occurred during PyInstaller execution: {e}")
    sys.exit(1)

# --- Script Success ---
print("\n--- Server Build Script Finished Successfully ---")
sys.exit(0)
