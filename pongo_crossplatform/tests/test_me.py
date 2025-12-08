import os
import subprocess
from pathlib import Path
import sys
sys.path.append(str(Path(__file__).resolve().parent.parent))

def run_plugin_test(plugin_dir, kong_version="3.11.0.0"):
    # Set up environment for Kong version
    os.environ["KONG_VERSION"] = kong_version
    # Assume pongo CLI is replaced by Python scripts
    # 1. Copy plugin to a test location (simulate mounting in container)
    test_plugin_path = Path("../kong-plugin")
    if not test_plugin_path.exists():
        test_plugin_path.mkdir(parents=True, exist_ok=True)
    for file in Path(plugin_dir).iterdir():
        if file.is_file():
            dest = test_plugin_path / file.name
            dest.write_bytes(file.read_bytes())
    # Copy kong.yml if present
    kong_yml_src = Path(plugin_dir) / "kong.yml"
    kong_yml_dest = Path("../kong-plugin/kong.yml")
    if kong_yml_src.exists():
        kong_yml_dest.write_bytes(kong_yml_src.read_bytes())
    # 2. Assume Kong is already running (DB-less mode)
    print("Assuming Kong is already running. Running plugin test...")
    import time
    import requests
    # Wait for Kong to be ready
    for _ in range(10):
        try:
            r = requests.get("http://localhost:8000/?token=abc123", timeout=2)
            if r.status_code == 404 or r.status_code == 200:
                break
        except Exception:
            time.sleep(1)
    try:
        response = requests.get("http://localhost:8000/?token=abc123", timeout=5)
        if response.status_code in [200, 404]:
            token_header = response.headers.get("X-Plugin-Token")
            if token_header == "abc123":
                print("Plugin test PASSED: X-Plugin-Token header found.")
                result = True
            else:
                print("Plugin test FAILED: X-Plugin-Token header missing or incorrect.")
                result = False
        else:
            print(f"Plugin test FAILED: Unexpected status code {response.status_code}")
            result = False
    except Exception as e:
        print(f"Plugin test FAILED: Exception {e}")
        result = False
    print("Test complete.")
    return result

if __name__ == "__main__":
    for plugin_dir in [
        "pongo_crossplatform/tests/lua_plugins/low_plugin",
        "pongo_crossplatform/tests/lua_plugins/medium_plugin",
        "pongo_crossplatform/tests/lua_plugins/high_plugin"
    ]:
        print(f"\n=== Testing {plugin_dir} ===")
        success = run_plugin_test(plugin_dir)
        if success:
            print(f"{plugin_dir} test PASSED.")
        else:
            print(f"{plugin_dir} test FAILED.")
