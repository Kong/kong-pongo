import os
import shutil
from pathlib import Path
from scripts.plugin_packaging import PluginPackager

def test_package_plugin(tmp_path):
    # Setup: create a dummy plugin directory
    plugin_dir = tmp_path / "dummy_plugin"
    plugin_dir.mkdir()
    (plugin_dir / "file.txt").write_text("test content")

    packager = PluginPackager(str(plugin_dir))
    archive_path = packager.package(output_dir=tmp_path)

    assert Path(archive_path).exists()
    # Cleanup
    shutil.rmtree(plugin_dir)
    os.remove(archive_path)
