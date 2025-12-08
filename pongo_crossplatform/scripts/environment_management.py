class EnvironmentManager:
	def __init__(self, env_vars):
		self.env_vars = env_vars
	def setup(self):
		import os
		for k, v in self.env_vars.items():
			os.environ[k] = v
# ...existing code from environment_management.py...
