import subprocess
class ShellEmulator:
	def run(self, command):
		result = subprocess.run(command, shell=True, capture_output=True, text=True)
		return result.stdout.strip()
# ...existing code from shell_emulation.py...
