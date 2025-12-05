"""
Unified CLI entrypoint for Pongo Cross-Platform Tool
Uses click for modular subcommands
"""
import click
from modules.plugin_packaging import PluginPackager
from modules.kong_plugin_validation import KongPluginValidator
# ... import other modules as needed

@click.group()
def cli():
    """Pongo CLI group."""
    pass

@cli.command()
@click.argument('plugin_dir')
@click.option('--output-dir', default=None, help='Output directory for package')
def package(plugin_dir, output_dir):
    """Package a Kong plugin directory."""
    packager = PluginPackager(plugin_dir)
    archive = packager.package(output_dir=output_dir)
    click.echo(f"Packaged plugin at {archive}")

@cli.command()
@click.argument('plugin_dir')
def validate(plugin_dir):
    """Validate a Kong custom Lua plugin for Kong 3.11+."""
    validator = KongPluginValidator(plugin_dir)
    results = validator.validate()
    for key, value in results.items():
        click.echo(f"{key}: {value}")

if __name__ == '__main__':
    cli()
