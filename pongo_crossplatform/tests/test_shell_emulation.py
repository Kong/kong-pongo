from shell_emulation import ShellEmulator

def test_run_shell_command():
    emulator = ShellEmulator()
    output = emulator.run('echo HelloWorld')
    assert 'HelloWorld' in output
