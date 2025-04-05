# Canon Keeper

Canon Keeper processes video recordings of Tabletop RPG (TTRPG) sessions.
It extracts audio, transcribes, generates recaps, and generally helps players and GMs maintain focus on the "in-universe" series of events.

## Requirements

- Install [Python: v3.13.2](https://www.python.org/downloads/release/python-3132/)
    - Create a virtual environment named `.venv`:

        ```bash
        python -m venv .venv
        ```
    - Activate it (every session)

        ```bash
        .venv\Scripts\activate
        ```
    - Install python packages
        ```bash
        pip install -r requirements.txt
        ```

- Install [ffmpeg: v2025-03-31-git-35c091f4b7](https://www.gyan.dev/ffmpeg/builds/) (Once extracted, add /bin folder to system PATH environment variable)
- Install Node Version Manager [NVM](https://github.com/coreybutler/nvm-windows) for managing Node.js versions.
    - Install NodeJS:

    ```bash
        nvm install lts
        nvm use lts
    ```
    - Install package dependencies:
    ```bash
        cd client
        npm install
    ```

## Usage

- Launch backend server:
    ```bash
    cd server
    uvicorn main:app
    ```
- Launch frontend server:
    ```bash
    cd client
    npm run dev
    ```

## Tech Stack

**Backend:**

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
