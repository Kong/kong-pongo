from cli_actions import PongoCLI

def test_cli_package(monkeypatch):
    # Simulate CLI call for packaging
    cli = PongoCLI()
    monkeypatch.setattr('plugin_packaging.PluginPackager.package', lambda self, output_dir=None: '/tmp/dummy.zip')
    # Would use CliRunner from click.testing for full CLI test
    assert hasattr(cli, 'run')
