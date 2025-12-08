# Kong Pongo OS-Independent Plugin Validation Tool

## 0. Problem Statement
Kong plugin validation is complex, error-prone, and OS-dependent. Manual validation, environment setup, and plugin compliance checks are time-consuming and inconsistent across platforms. This tool automates and standardizes the validation of Kong Lua plugins, ensuring enterprise-grade quality, reporting, and OS independence.

## 1. Goal
- Automate validation of Kong Lua plugins for structure, lifecycle hooks, Kong variable usage, and compatibility
- Provide enterprise-grade logging, reporting, and workspace hygiene
- Ensure OS-independent setup and execution (Linux, MacOS, Windows)
- Enable concurrent plugin testing and tabular reporting
- Centralize configuration and streamline environment setup

## 2. Description
This tool is a modular, enterprise-ready Python automation suite for validating Kong Lua plugins. It sets up the required environment (Python, Lua, Luarocks), discovers plugins, validates them against Kong standards, and generates a detailed, tabular report. It features robust logging, config centralization, and workspace cleanup, making it suitable for CI/CD and enterprise use.

## 3. File System Overview & Purpose
| Path | Purpose |
|------|---------|
| `run.py` | Main automation script: orchestrates environment setup, plugin discovery, validation, reporting, logging |
| `config/config.json` | Centralized configuration: plugin directory, Kong version, report path |
| `config/codeql-config.yml` | CodeQL config for static analysis (optional, for security/code quality) |
| `config/requirements.txt` | Python dependencies for the tool |
| `kong-versions/` | Kong Gateway versioned directories (for Docker images, binaries, specs) |
| `logs/` | Stores enterprise-grade log files per run |
| `result/plugin_validation_report.json` | Final validation report in JSON format |
| `pongo_crossplatform/` | Main tool source code |
| `pongo_crossplatform/core/cli.py` | CLI entrypoint (Click-based, suppressed in final output) |
| `pongo_crossplatform/core/logging.py` | Logging setup and utilities |
| `pongo_crossplatform/modules/kong_plugin_validation.py` | Plugin validation logic |
| `pongo_crossplatform/modules/plugin_packaging.py` | Plugin packaging utilities |
| `pongo_crossplatform/scripts/` | Automation scripts for environment, config, orchestration |
| `pongo_crossplatform/tests/` | Unit tests and sample plugins for validation |

## 4. Script Table
| Script | Location | Purpose |
|--------|----------|---------|
| `run.py` | Root | Main entrypoint: setup, validate, report |
| `cli.py` | core/ | CLI interface (suppressed in final output) |
| `logging.py` | core/ | Enterprise logging setup |
| `kong_plugin_validation.py` | modules/ | Validates plugin structure, hooks, variables |
| `plugin_packaging.py` | modules/ | Handles plugin packaging logic |
| `cli_actions.py` | scripts/ | CLI actions for automation |
| `config_parsing.py` | scripts/ | Parses config files |
| `custom_ca.py` | scripts/ | Custom CA management |
| `dependency_orchestration.py` | scripts/ | Orchestrates dependencies (Lua, Luarocks) |
| `environment_management.py` | scripts/ | Manages environment setup |
| `install_kong_gateway_docker.py` | scripts/ | Installs Kong Gateway via Docker |
| `kong_plugin_validation.py` | scripts/ | Script-level plugin validation |
| `logging_debugging.py` | scripts/ | Debug logging utilities |
| `lua_integration.py` | scripts/ | Lua integration helpers |
| `plugin_packaging.py` | scripts/ | Script-level packaging |
| `shell_emulation.py` | scripts/ | Shell emulation for cross-platform support |
| `test_orchestration.py` | scripts/ | Orchestrates plugin tests |
| `legacy_shell_replacements/` | scripts/ | Replacements for legacy shell scripts |

## 5. Summary
This tool delivers a fully automated, OS-independent, enterprise-grade solution for Kong Lua plugin validation. It streamlines environment setup, plugin discovery, validation, and reporting, with robust logging and workspace hygiene. The modular design supports extensibility and integration into CI/CD pipelines.

## 6. How to Use
1. Clone the repository
2. Install Python 3.8+ and Docker
3. Run `pip install -r config/requirements.txt`
4. Execute `python3 run.py`
5. View the tabular report in the console and detailed logs in `logs/`
6. Review the JSON report in `result/plugin_validation_report.json`

## 7. Requirements & Dependencies
- Python 3.8+
- Docker (for Kong Gateway)
- Lua & Luarocks (auto-installed by tool)
- Python packages: click, tabulate, loguru, etc. (see `config/requirements.txt`)
- OS: Linux, MacOS, Windows (auto-detected)

## 8. Additional Features
- Enterprise-grade logging: logs to file and console with timestamps
- Concurrent plugin validation for speed
- Centralized config for easy customization
- Workspace cleanup and hygiene
- Extensible modular design
- CI/CD ready

## 9. Guide, Analysis & Description
This document serves as a comprehensive guide and analysis of the Kong Pongo OS-Independent Plugin Validation Tool. It details the problem solved, goals achieved, tool architecture, file and script purposes, usage instructions, requirements, and advanced features. The tool is designed for reliability, scalability, and ease of integration into enterprise workflows.
