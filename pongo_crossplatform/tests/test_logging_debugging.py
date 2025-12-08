from pongo_crossplatform.scripts.logging_debugging import LoggingManager

def test_logging_manager():
    manager = LoggingManager(log_level="DEBUG")
    manager.setup()
    manager.debug("Debug message")
    manager.info("Info message")
    manager.warning("Warning message")
    manager.error("Error message")
