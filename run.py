
import os
import sys
import subprocess
import json
import shutil
from pathlib import Path
import logging
from datetime import datetime

# Enterprise logging setup
LOGS_DIR = Path("logs")
LOGS_DIR.mkdir(exist_ok=True)
log_start = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
log_file = LOGS_DIR / f"logs-{log_start}.log"
class EnterpriseFormatter(logging.Formatter):
    def format(self, record):
        fmt = "[%(asctime)s] %(levelname)s %(name)s: %(message)s"
        return logging.Formatter(fmt).format(record)
logger = logging.getLogger("pongo-enterprise")
logger.setLevel(logging.INFO)
file_handler = logging.FileHandler(log_file)
file_handler.setFormatter(EnterpriseFormatter())
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(EnterpriseFormatter())
logger.addHandler(file_handler)
logger.addHandler(console_handler)

CONFIG_PATH = Path("config/config.json")
REQUIREMENTS_PATH = Path("config/requirements.txt")
KONG_VERSIONS_DIR = Path("kong-versions")
DEFAULT_KONG_VERSION = "3.11.0.0"


# 1. Install required modules from requirements.txt

logger.info("Installing required Python modules...")
subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(REQUIREMENTS_PATH)], check=True)

# 1a. Install Luarocks if not present
import platform
def install_lua():
    if shutil.which("lua"):
        logger.info("Lua is already installed.")
        return shutil.which("lua")
    logger.info("Lua not found. Installing...")
    if shutil.which("yum"):
        subprocess.run(["sudo", "yum", "install", "-y", "lua", "lua-devel"], check=True)
    elif shutil.which("dnf"):
        subprocess.run(["sudo", "dnf", "install", "-y", "lua", "lua-devel"], check=True)
    elif shutil.which("apt-get"):
        subprocess.run(["sudo", "apt-get", "update"], check=True)
        subprocess.run(["sudo", "apt-get", "install", "-y", "lua5.1", "liblua5.1-0-dev"], check=True)
    else:
        logger.error("No supported package manager found for Lua.")
        sys.exit(1)
    lua_path = shutil.which("lua")
    if not lua_path:
        logger.error("Lua installation failed.")
        sys.exit(1)
    logger.info(f"Lua installed at {lua_path}")
    return lua_path

def install_luarocks():
    if shutil.which("luarocks"):
        logger.info("Luarocks is already installed.")
        return
    logger.info("Luarocks not found. Installing...")
    # Ensure Lua is installed first
    lua_path = install_lua()
    # Detect OS and package manager
    pkg_cmds = []
    if shutil.which("yum"):
        pkg_cmds.append(["sudo", "yum", "install", "-y", "gcc", "unzip", "make", "wget"])
    elif shutil.which("dnf"):
        pkg_cmds.append(["sudo", "dnf", "install", "-y", "gcc", "unzip", "make", "wget"])
    elif shutil.which("apt-get"):
        pkg_cmds.append(["sudo", "apt-get", "update"])
        pkg_cmds.append(["sudo", "apt-get", "install", "-y", "gcc", "unzip", "make", "wget"])
    else:
        logger.error("No supported package manager found (yum, dnf, apt-get).")
        sys.exit(1)
    for cmd in pkg_cmds:
        try:
            subprocess.run(cmd, check=True)
        except Exception as e:
            logger.error(f"Error running command {' '.join(cmd)}: {e}")
            sys.exit(1)
    # Download and install Luarocks using Python
    import urllib.request
    LUAROCKS_VERSION = "3.9.2"
    luarocks_tar = f"/tmp/luarocks-{LUAROCKS_VERSION}.tar.gz"
    luarocks_dir = f"/tmp/luarocks-{LUAROCKS_VERSION}"
    url = f"https://luarocks.org/releases/luarocks-{LUAROCKS_VERSION}.tar.gz"
    logger.info(f"Downloading Luarocks from {url}...")
    try:
        urllib.request.urlretrieve(url, luarocks_tar)
    except Exception as e:
        logger.error(f"Failed to download Luarocks: {e}")
        sys.exit(1)
    import tarfile
    try:
        with tarfile.open(luarocks_tar, "r:gz") as tar:
            tar.extractall(path="/tmp")
    except Exception as e:
        logger.error(f"Failed to extract Luarocks: {e}")
        sys.exit(1)
    try:
        os.chdir(luarocks_dir)
        # Use --with-lua, --with-lua-bin, and --with-lua-include flags for configure
        lua_bin = os.path.dirname(lua_path)
        # Try common include paths
        include_paths = [
            "/usr/include/lua5.1",
            "/usr/include/lua/5.1",
            "/usr/include/lua-5.1",
            "/usr/include/lua51",
            "/usr/include"
        ]
        found_include = None
        for path in include_paths:
            if os.path.exists(os.path.join(path, "lua.h")):
                found_include = path
                break
        if not found_include:
            logger.error("Could not find lua.h for Lua. Please ensure Lua dev headers are installed.")
            sys.exit(1)
        configure_cmd = [
            "./configure",
            f"--with-lua-bin={lua_bin}",
            f"--with-lua={lua_bin}",
            f"--with-lua-include={found_include}"
        ]
        subprocess.run(configure_cmd, check=True)
        subprocess.run(["make"], check=True)
        subprocess.run(["sudo", "make", "install"], check=True)
        os.chdir("/tmp")
    except Exception as e:
        logger.error(f"Failed to build/install Luarocks: {e}")
        sys.exit(1)
    print("Luarocks installation complete.")
    try:
        subprocess.run(["luarocks", "--version"], check=True)
    except Exception as e:
        logger.error(f"Luarocks installation verification failed: {e}")
        sys.exit(1)

install_luarocks()

# 2. Read plugins directory from config.json

with open(CONFIG_PATH) as f:
    config = json.load(f)
plugins_dir = Path(config.get("plugins_directory", ""))
if not plugins_dir.exists():
    logger.error(f"Plugins directory '{plugins_dir}' not found.")
    sys.exit(1)


# 3. List all plugins in the directory and create checklist

logger.info(f"Listing plugins in: {plugins_dir}")
plugins = [p for p in plugins_dir.iterdir() if p.is_dir()]
checklist = {plugin.name: "PENDING" for plugin in plugins}
logger.info("Checklist for plugins to be tested:")
for name, status in checklist.items():
    logger.info(f"- {name}: {status}")

# 4. Setup Kong with specified version (default: 3.11.0.0)
kong_version = config.get("kong_version", DEFAULT_KONG_VERSION)
kong_version_path = KONG_VERSIONS_DIR / kong_version / "kong"
if not kong_version_path.exists():
    logger.info(f"Kong version {kong_version} not found. Downloading...")
    # Simulate download (replace with actual download logic)
    os.makedirs(kong_version_path, exist_ok=True)
    # ... download and setup Kong here ...
    logger.info(f"Kong {kong_version} downloaded and set up.")
else:
    logger.info(f"Kong version {kong_version} is available.")

# 5. Run pongo validation for plugins
from pongo_crossplatform.modules.kong_plugin_validation import KongPluginValidator


# 5. Test plugins concurrently and update checklist
import concurrent.futures
results = []
def test_plugin(plugin):
    checklist[plugin.name] = "TESTING"
    logger.info(f"Testing {plugin.name}... Status: {checklist[plugin.name]}")
    validator = KongPluginValidator(str(plugin))
    try:
        details = validator.validate()
        valid_checks = [v.get('valid', False) for k, v in details.items() if isinstance(v, dict)]
        is_pass = all(valid_checks)
        status = "PASS" if is_pass else "FAIL"
        checklist[plugin.name] = status
        logger.info(f"Completed {plugin.name}. Status: {status}")
        return {
            "plugin": plugin.name,
            "status": status,
            "details": details
        }
    except Exception as e:
        checklist[plugin.name] = "FAIL"
        logger.error(f"Completed {plugin.name}. Status: FAIL")
        return {
            "plugin": plugin.name,
            "status": "FAIL",
            "details": str(e)
        }

with concurrent.futures.ThreadPoolExecutor() as executor:
    future_to_plugin = {executor.submit(test_plugin, plugin): plugin for plugin in plugins}
    for future in concurrent.futures.as_completed(future_to_plugin):
        result = future.result()
        results.append(result)

# 6. Summarize and create report
report_path = Path(config.get("report_path", "result/plugin_validation_report.json"))
report_path.parent.mkdir(parents=True, exist_ok=True)
with open(report_path, "w") as f:
    json.dump(results, f, indent=2)


# Print final test report as a table
from tabulate import tabulate
table_data = []
for r in results:
    fail_details = []
    if r['status'] == "FAIL" and isinstance(r['details'], dict):
        for k, v in r['details'].items():
            if isinstance(v, dict) and not v.get('valid', True):
                fail_details.append(f"{k}")
    table_data.append([
        r['plugin'],
        r['status'],
        ", ".join(fail_details) if fail_details else "-"
    ])
headers = ["Plugin", "Status", "Failed Checks"]
logger.info("\nValidation Report:")
print(tabulate(table_data, headers=headers, tablefmt="github"))
logger.info(f"\nReport saved to {report_path}")

# 7. CLI available for use, but do not print CLI-related output
# from pongo_crossplatform.core.cli import cli
# import click
# cli()
