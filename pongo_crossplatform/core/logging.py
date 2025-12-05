"""
Centralized logging manager for Pongo Cross-Platform Tool
"""
from loguru import logger

class LoggingManager:
    def __init__(self, log_level: str = "INFO"):
        self.log_level = log_level

    def setup(self):
        logger.remove()
        logger.add(lambda msg: print(msg, end=""), level=self.log_level)
        logger.info(f"Logging initialized at level: {self.log_level}")

    def debug(self, message: str):
        logger.debug(message)

    def info(self, message: str):
        logger.info(message)

    def warning(self, message: str):
        logger.warning(message)

    def error(self, message: str):
        logger.error(message)
