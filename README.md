# Canon Keeper (Working Title)

Canon Keeper is an application designed to process video recordings of Tabletop RPG (TTRPG) sessions (.MKV files). It extracts audio, facilitates transcription (integration with external services planned), and aims to provide tools for session analysis, helping players and GMs focus on the "in-universe" events.

This project is open source and welcomes contributions!

## Tech Stack

This project uses a client-server architecture, initially intended for local use.

**Backend:**

* **Language:** Python (3.10+)
* **Framework:** FastAPI (High-performance ASGI web framework)
* **Server:** Uvicorn (ASGI server to run FastAPI)
* **File Handling:** `python-multipart` (for uploads), direct `ffmpeg` calls (for audio extraction)
* **Environment:** Python `venv` for dependency isolation
* **Testing:** `pytest` with `httpx` and `pytest-asyncio`

**Frontend:**

* **Language:** TypeScript
* **Framework/Library:** React
* **Build Tool / Dev Server:** Vite (Fast, modern frontend tooling)
* **Styling:** Tailwind CSS (Utility-first CSS framework)
* **Environment:** Node.js (LTS recommended) managed via NVM
* **Testing:** Vitest + React Testing Library

**Code Quality & Tooling:**

* **Python Formatting:** Black
* **Python Linting:** Ruff
* **TS/JS Formatting:** Prettier
* **TS/JS Linting:** ESLint
* **Automation:** Pre-commit hooks (managed by `pre-commit`) to run checks before commits.
* **CI/CD:** GitHub Actions (Linting and testing workflows)

**External Dependencies:**

* **`ffmpeg`:** This application **requires** `ffmpeg` to be installed separately on your system and accessible via the command line (in your system's PATH) for audio extraction from MKV files.

## Getting Started: Development Environment Setup

Follow these steps carefully to set up your local development environment.

**1. Prerequisites:**

* **Git:** You need Git installed to clone the repository. ([Download Git](https://git-scm.com/))
* **Python:** Python version 3.10 or higher is required. Download from [python.org](https://www.python.org/) or use a version manager like `pyenv`. Verify with `python --version` (or `python3 --version`).
* **Node Version Manager (NVM):** Strongly recommended for managing Node.js versions.
  * For macOS/Linux: [nvm-sh/nvm](https://github.com/nvm-sh/nvm)
  * For Windows: [coreybutler/nvm-windows](https://github.com/coreybutler/nvm-windows) (Ensure you run terminals **as Administrator** when using NVM for Windows).
* **`ffmpeg`:** **Crucial external dependency.** You must install `ffmpeg` yourself. Installation methods vary greatly by operating system:
  * **macOS:** `brew install ffmpeg` (using Homebrew)
  * **Debian/Ubuntu Linux:** `sudo apt update && sudo apt install ffmpeg`
  * **Windows:** Download from [ffmpeg.org](https://ffmpeg.org/download.html) (select Windows builds), extract, and **manually add the `bin` directory** containing `ffmpeg.exe` to your system's PATH environment variable. Alternatively, use a package manager like Chocolatey (`choco install ffmpeg`).
  * Verify installation by running `ffmpeg -version` in your terminal. If the command is not found, the application's audio extraction will fail.

**2. Installation Steps:**

1. **Clone the Repository:**

    ```bash
    git clone <your-repository-url> # Replace with the actual repo URL
    cd canon-keeper # Or your repository's directory name
    ```

2. **Set up Node.js:**
    * Use NVM to install the latest Long-Term Support (LTS) version:

        ```bash
        nvm install lts
        nvm use lts
        ```

    * Verify the installation:

        ```bash
        node -v # Should show the LTS version (e.g., v20.x.x)
        npm -v
        ```

3. **Set up Python Virtual Environment:**
    * Create a virtual environment named `.venv`:

        ```bash
        python -m venv .venv
        ```

        *(Note: `.venv` is included in `.gitignore`)*
    * **Activate the virtual environment** (You MUST do this every time you work on the project in a new terminal session):
        * **Windows (Git Bash/WSL/Linux Subsystem):** `source .venv/bin/activate`
        * **Windows (CMD):** `.venv\Scripts\activate`
        * **Windows (PowerShell):** `.venv\Scripts\Activate.ps1` (You might need to adjust script execution policy: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process`)
        * **macOS/Linux:** `source .venv/bin/activate`
        * Your terminal prompt should change to indicate the active environment (e.g., `(.venv) ...`).

4. **Install Dependencies:**
    * **Python Dependencies** (ensure venv is active): Installs runtime *and* development requirements.

        ```bash
        pip install -r requirements.txt
