import { mkdirp } from 'fs-extra';
import { createWriteStream, readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

/**
 * A file manager that writes file to a specific directory but reads globally.
 */
export class Filemanager {
  dataDir: string;

  public constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  /**
   * Saves a file to the data directory.
   * @param name - File to save
   * @param stream - File contents
   */
  public async writeFile(name: string, stream: Readable): Promise<void> {
    if (isAbsolute(name)) {
      throw new Error("can't check absolute path");
    }

    const path = this.#getPath(name);
    await mkdirp(dirname(path));
    await finished(stream.pipe(createWriteStream(path)));
  }

  /**
   * Reads a file from the disk and returns a buffer
   * @param name - File to read
   * @param encoding - Binary encoding
   */
  public readFileSync(name: string, encoding: 'binary'): Buffer;

  /**
   * Reads a file from the disk and returns a string
   * @param name - File to read
   * @param encoding - Encoding to use
   */
  public readFileSync(name: string, encoding: 'utf-8'): string;

  /**
   * Reads a file from the disk
   * @param name - File to read
   * @param encoding - Encoding to use
   */
  public readFileSync(name: string, encoding: 'utf-8' | 'binary'): Buffer | string {
    return readFileSync(this.#getPath(name), encoding);
  }

  /**
   * Checks if a file exists and is accessible
   * @param name - File to check
   */
  public async hasEntry(name: string): Promise<boolean> {
    try {
      // TODO check access modes?
      await access(this.#getPath(name));
      return true;
    } catch {
      return false;
    }
  }

  #getPath(name: string) {
    return isAbsolute(name) ? name : join(this.dataDir, name);
  }
}
