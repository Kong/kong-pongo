"""
Plugin packaging module for Pongo Cross-Platform Tool
"""
import shutil
from pathlib import Path
from typing import Optional

class PluginPackager:
    """
    Handles packaging and distribution of Kong plugins.
    """
    def __init__(self, plugin_dir: str):
        self.plugin_dir = Path(plugin_dir)

    def package(self, output_dir: Optional[str] = None) -> str:
        """
        Package the plugin for distribution.
        Args:
            output_dir (str): Directory to place packaged files.
        Returns:
            str: Path to packaged file.
        """
        if not self.plugin_dir.exists():
            raise FileNotFoundError(f"Plugin directory {self.plugin_dir} does not exist.")
        if output_dir is None:
            output_dir = self.plugin_dir.parent / "dist"
        else:
            output_dir = Path(output_dir)
        output_dir.mkdir(exist_ok=True)
        archive_name = output_dir / f"{self.plugin_dir.name}.zip"
        shutil.make_archive(str(archive_name.with_suffix('')), 'zip', str(self.plugin_dir))
        return str(archive_name)
