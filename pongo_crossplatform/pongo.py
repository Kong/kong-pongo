
#!/usr/bin/env python3
"""
Main entrypoint for Pongo Cross-Platform Tool
Delegates to the unified CLI in core/cli.py
"""
from pongo_crossplatform.core.cli import cli

if __name__ == '__main__':
    cli()
