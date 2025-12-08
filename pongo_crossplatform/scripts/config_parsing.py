import yaml
import configparser
class ConfigParser:
	def __init__(self, config_path):
		self.config_path = config_path
	def parse(self):
		if self.config_path.endswith('.yaml') or self.config_path.endswith('.yml'):
			with open(self.config_path, 'r') as f:
				return yaml.safe_load(f)
		elif self.config_path.endswith('.ini'):
			parser = configparser.ConfigParser()
			parser.read(self.config_path)
			return {section: dict(parser.items(section)) for section in parser.sections()}
		return {}
# ...existing code from config_parsing.py...
