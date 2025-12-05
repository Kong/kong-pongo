# Pongo Cross-Platform Tool

## Overview

Pongo Cross-Platform is an enterprise-grade, platform-independent tool for developing, packaging, validating, and testing Kong custom Lua plugins (Kong 3.11+). It is written in Python, fully modular, and follows best practices for extensibility and maintainability.

## Features
- **Plugin Packaging**: Easily package Kong plugins for distribution.
- **Plugin Validation**: Validate directory structure, lifecycle hooks, Kong variable usage, version compatibility, and functionality coverage for Kong plugins.
- **Dependency Orchestration**: Manage and simulate dependencies (Postgres, Redis, Cassandra, etc.) for plugin testing.
- **Custom CA Handling**: Manage custom CA certificates for test environments.
- **Environment Management**: Set and manage environment variables for test and build processes.
- **Logging & Debugging**: Centralized, configurable logging for all modules.
- **Unified CLI**: All features accessible via a single, extensible CLI using `click`.
- **Test Orchestration**: Run and report on plugin and integration tests.
- **Lua Integration**: Run and validate Lua scripts directly.
- **Config Parsing**: Parse YAML/INI config files for flexible workflows.
- **Shell Emulation**: Run shell commands in a cross-platform way.

## Usage

### Installation
- Requires Python 3.8+
- Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### CLI Commands
- Package a plugin:
   ```bash
   python -m core.cli package /path/to/plugin
   ```
- Validate a plugin:
   ```bash
   python -m core.cli validate /path/to/plugin
   ```
- See all commands:
   ```bash
   python -m core.cli --help
   ```

## Project Structure
- `core/` — CLI entrypoint and logging
- `modules/` — All feature modules (packaging, validation, dependencies, etc.)
- `tests/` — Unit and integration tests
- `ARCHITECTURE.md` — Design and best practices
- `todo_list.md` — Task tracking and progress

## Extending the Tool
- Add new modules to `modules/` and register them in the CLI.
- Follow OOP, type hints, and docstring conventions.
- Add tests for all new features.

## Platform Independence
- All file and process operations are abstracted for Windows, macOS, and Linux compatibility.
- No Docker or OS-specific dependencies required.

## Contributing
- See `ARCHITECTURE.md` for design guidelines.
- Run tests with `pytest` before submitting changes.

---

For more details, see the code and documentation in each module.
# Pongo Cross-Platform Rewrite

This directory will contain the new, OS-independent version of the `kong-pongo` tool. The goal is to support Linux, macOS, and Windows natively, without requiring WSL or emulation.

## Migration Plan

1. **Language**: Python 3 (for portability and packaging)
2. **Features to Port**:
   - All CLI actions (`build`, `run`, `lint`, `pack`, etc.)
   - Dependency management (Postgres, Cassandra, Redis, Squid, grpcbin, custom)
   - Environment setup and teardown
   - Logging and debugging utilities
   - Custom CA and license handling
   - CI integration
3. **Packaging**:
   - Use PyInstaller to create standalone binaries for Windows, macOS, and Linux
   - Provide pip install option for Python users
4. **Testing**:
   - Add GitHub Actions workflows for all platforms
5. **Documentation**:
   - Update usage instructions for all platforms

## Next Steps
- Scaffold the main CLI entrypoint
- Port core actions from `pongo.sh` to Python
- Abstract OS-specific logic
- Add platform detection and compatibility checks

---

This is the starting point for the rewrite. All new code will be placed here and iteratively ported from the original shell scripts.