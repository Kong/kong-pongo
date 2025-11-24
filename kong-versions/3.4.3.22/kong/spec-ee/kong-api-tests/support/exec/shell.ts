import { spawn } from 'child_process';

interface RunSpawnCommandOptions {
  print?: boolean;
}

export const runSpawnCommand = async (shellCommand: string, options: RunSpawnCommandOptions = {}): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    const { print = true } = options;

    if (print) {
      console.log('[spawn shell] Running:', shellCommand);
    }

    const child = spawn(shellCommand, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'], // stdin ignored, stdout/stderr piped
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      if (print) process.stdout.write(text); // print output in real-time
      stdout += text; // collect stdout
    });

    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      process.stderr.write(text); // print error output in real-time
      stderr += text; // collect stderr
    });

    child.on('close', (code, signal) => {
      if (signal) {
        reject(new Error(`Process killed by signal: ${signal}`));
      } else if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Process exited with code: ${code}, stderr: ${stderr.trim()}`));
      }
    });

    child.on('error', err => {
      reject(new Error(`Failed to start process: ${err instanceof Error ? err.message : String(err)}`));
    });
  });
};
