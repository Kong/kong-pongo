import * as fs from 'fs';
import * as path from 'path';


/**
 * Reads the target file and returns its contents
 * @returns {string}
 */
export const getTargetFileContent = (filename: string) => {
  const file = path.resolve(process.cwd(), filename);

  if (fs.existsSync(file)) {
    return fs.readFileSync(file, 'utf8');
  } else {
    console.error(`Couldn't read the given file at ${file}`);
  }
}

/**
 * Reads a binary file and returns its contents as a Buffer
 * @param filename Path to the binary file
 * @returns Buffer containing the file data
 */
export const getBinaryFileContent = (filename: string): Buffer => {
  const file = path.resolve(process.cwd(), filename);

  if (fs.existsSync(file)) {
    return fs.readFileSync(file);  // No encoding specified = returns Buffer
  } else {
    throw new Error(`Couldn't read the binary file at ${file}`);
  }
}

/**
 * Create a file with the given content
 */
export const createFileWithContent = (filename, content) => {
  const file = path.resolve(process.cwd(), filename);

  fs.writeFileSync(file, content);
}

/**
 * Delete the target file
 */
export const deleteTargetFile = (filename) => {
  const file = path.resolve(process.cwd(), filename);

  try {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`\nSuccessfully removed target file: ${file.split('/').pop()}`);
    }
  } catch (error) {
    console.error('Something went wrong while removing the file', error);
  }
}

/**
 * Resolves a path to a file in the support/data directory
 * @param relativePath Path relative to the support/data directory
 * @returns Fully resolved path to the file
 */
export function getDataFilePath(relativePath: string): string {
    // Start from the current directory
    let currentDir = __dirname;
    
    // Go up the directory tree until we find package.json
    while (!fs.existsSync(path.join(currentDir, 'package.json'))) {
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            // We've reached the root of the filesystem without finding package.json
            throw new Error('Could not find project root (package.json not found)');
        }
        currentDir = parentDir;
    }
    
    // Now currentDir is the directory containing package.json (project root)
    const dataBasePath = path.join(currentDir, 'support', 'data');
    
    return path.join(dataBasePath, relativePath);
}