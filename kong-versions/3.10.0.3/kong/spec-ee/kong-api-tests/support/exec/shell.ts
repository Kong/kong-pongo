  import { spawn } from 'child_process';
  
  export const runSpawnCommand = async (shellCommand: string): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    console.log('[spawn shell] Running:', shellCommand);

    const child = spawn(shellCommand, {
      stdio: 'inherit',
      shell: true // Important: enables full shell execution
    });
   
    child.on('close', (code, signal) => {
      if (signal) {
        reject(new Error(`Process killed by signal: ${signal}`));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code: ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start process: ${err instanceof Error ? err.message : String(err)}`));
    });

   });
  }