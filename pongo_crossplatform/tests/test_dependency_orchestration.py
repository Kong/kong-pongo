from scripts.dependency_orchestration import DependencyManager

def test_start_stop_dependencies():
    config = {
        "postgres": {"version": "13"},
        "redis": {"version": "6.2.6"},
        "cassandra": {"version": "3.11"}
    }
    manager = DependencyManager(config)
    started = manager.start()
    assert set(started) == set(config.keys())
    manager.stop()
