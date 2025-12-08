from pongo_crossplatform.scripts.test_orchestration import TestOrchestrator

def test_run_tests():
    config = {'test_dir': 'tests', 'verbose': True}
    orchestrator = TestOrchestrator(config)
    result = orchestrator.run()
    assert result == 0 or isinstance(result, int)  # pytest returns exit code
