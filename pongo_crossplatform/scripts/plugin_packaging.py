import shutil
import os
from pathlib import Path
import zipfile
class PluginPackager:
	def __init__(self, plugin_dir):
		self.plugin_dir = plugin_dir
	def package(self, output_dir=None):
		if output_dir is None:
			output_dir = os.getcwd()
		archive_path = os.path.join(output_dir, 'plugin_package.zip')
		with zipfile.ZipFile(archive_path, 'w') as zipf:
			for root, _, files in os.walk(self.plugin_dir):
				for file in files:
					file_path = os.path.join(root, file)
					arcname = os.path.relpath(file_path, self.plugin_dir)
					zipf.write(file_path, arcname)
		return archive_path
# ...existing code from plugin_packaging.py...
