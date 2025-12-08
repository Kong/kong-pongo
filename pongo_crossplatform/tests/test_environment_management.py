import os
from pongo_crossplatform.scripts.environment_management import EnvironmentManager

def test_setup_environment():
    env_vars = {"TEST_ENV_VAR": "test_value"}
    manager = EnvironmentManager(env_vars)
    manager.setup()
    assert os.environ["TEST_ENV_VAR"] == "test_value"
    del os.environ["TEST_ENV_VAR"]
