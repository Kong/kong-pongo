import subprocess
import sys
from pathlib import Path

def install_kong_gateway(version="3.11.0.0", container_name="kong-gateway-test", network_name="kong-pongo-net"):
    image = f"kong/kong-gateway:{version}"
    print(f"Pulling Kong Gateway Docker image: {image}")
    subprocess.run(["docker", "pull", image], check=True)
    print(f"Creating Docker network: {network_name}")
    subprocess.run(["docker", "network", "create", network_name], check=False)
    print(f"Starting Kong Gateway container: {container_name}")
    # Mount only the plugin directory and kong.yml, not the full kong tree
    plugin_src = str(Path(sys.path[0]) / "pongo_crossplatform/tests/lua_plugins/medium_plugin")
    kong_yml = str(Path(sys.path[0]) / "pongo_crossplatform/tests/lua_plugins/medium_plugin/kong.yml")
    # Mount plugin directly into Kong's plugin path and kong.yml to /kong-plugin/kong.yml
    subprocess.run([
        "docker", "run", "-d",
        "--name", container_name,
        "--network", network_name,
        "-e", "KONG_DATABASE=off",
        "-e", "KONG_DECLARATIVE_CONFIG=/kong-plugin/kong.yml",
        "-e", "KONG_PLUGINS=bundled,medium-plugin",
        "-p", "8000:8000",
        "-p", "8001:8001",
        "-v", f"{plugin_src}:/usr/local/share/lua/5.1/kong/plugins/medium-plugin",
        "-v", f"{kong_yml}:/kong-plugin/kong.yml",
        image,
        "kong", "docker-start"
    ], check=True)
    print("Kong Gateway container started.")
    print("You can interact with Kong via ports 8000 (proxy) and 8001 (admin).")

if __name__ == "__main__":
    install_kong_gateway()
