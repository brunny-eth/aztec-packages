import { LogFn, createDebugOnlyLogger } from '@aztec/foundation/log';

import { join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { ReadableStream } from 'node:stream/web';
// eslint-disable-next-line import/no-extraneous-dependencies
import { Parse } from 'tar';

import { Filemanager } from './filemanager.js';
import { NoirGitDependencyConfig, NoirLocalDependencyConfig } from './package-config.js';

/**
 * Noir Dependency Resolver
 */
export class NoirDependencyResolver {
  #libs = new Map<string, string>();
  #fm: Filemanager;
  #log: LogFn;

  constructor(fm: Filemanager) {
    this.#fm = fm;
    this.#log = createDebugOnlyLogger('noir:dependency-resolver');
  }

  /**
   * Resolves a dependency.
   * @param pkgLocation - Location of the package
   * @param name - Name of the dependency
   * @param dependency - Dependency to resolve
   */
  public async add(
    pkgLocation: string,
    name: string,
    dependency: NoirGitDependencyConfig | NoirLocalDependencyConfig,
  ): Promise<void> {
    const path =
      'git' in dependency ? await this.#fetchRemoteDependency(dependency) : resolve(pkgLocation, dependency.path);
    this.#libs.set(name, path);
  }

  /**
   * Gets the names of the crates in this dependency list
   */
  public getCrateNames() {
    return [...this.#libs.keys()];
  }

  /**
   * Looks up a dependency
   * @param sourceId - The source being resolved
   * @returns The path to the resolved file
   */
  public resolve(sourceId: string): string | null {
    const [lib, ...path] = sourceId.split('/').filter(x => x);
    if (this.#libs.has(lib)) {
      return join(this.#libs.get(lib)!, 'src', ...path);
    } else {
      return null;
    }
  }

  async #fetchRemoteDependency(dependency: NoirGitDependencyConfig): Promise<string> {
    const archivePath = await this.#fetchTarFromGithub(dependency);
    const libPath = await this.#extractTar(dependency, archivePath);
    return libPath;
  }

  async #extractTar(dependency: NoirGitDependencyConfig, archivePath: string): Promise<string> {
    const gitUrl = new URL(dependency.git);
    const extractLocation = join('libs', gitUrl.pathname.replaceAll('/', '_') + '@' + (dependency.tag ?? 'HEAD'));
    const packagePath = join(extractLocation, dependency.directory ?? '');

    // TODO check contents before reusing old results
    if (await this.#fm.hasEntry(packagePath)) {
      return packagePath;
    }

    const filter = dependency.directory
      ? (path: string) => {
          const pathWithoutArchiveName = stripSegments(path, 1);
          return pathWithoutArchiveName.startsWith(dependency.directory!);
        }
      : () => true;

    const tarParser = new Parse({
      filter: filter,
      onentry: async entry => {
        // just save files
        if (entry.type === 'File') {
          this.#log(`inflating file ${entry.path}`);
          // there's no `strip: 1` with the parser
          await this.#fm.writeFile(join(extractLocation, stripSegments(entry.path, 1)), Readable.from(entry));
        } else {
          entry.resume();
        }
      },
    });

    const archive = this.#fm.readFileSync(archivePath, 'binary');
    await finished(Readable.from(archive).pipe(tarParser));

    return packagePath;
  }

  async #fetchTarFromGithub(dependency: Pick<NoirGitDependencyConfig, 'git' | 'tag'>): Promise<string> {
    // TODO support actual git hosts
    if (!dependency.git.startsWith('https://github.com')) {
      throw new Error('Only github dependencies are supported');
    }

    const url = new URL(`${dependency.git}/archive/${dependency.tag ?? 'HEAD'}.tar.gz`);
    const localArchivePath = join('archives', url.pathname.replaceAll('/', '_'));

    // TODO should check signature before accepting any file
    if (await this.#fm.hasEntry(localArchivePath)) {
      this.#log('using cached archive', { url: url.href, path: localArchivePath });
      return localArchivePath;
    }

    const response = await fetch(url, {
      method: 'GET',
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }

    await this.#fm.writeFile(localArchivePath, Readable.fromWeb(response.body as ReadableStream));
    return localArchivePath;
  }
}

/**
 * Strips the first n segments from a path
 */
function stripSegments(path: string, count: number): string {
  const segments = path.split(sep).filter(Boolean);
  return segments.slice(count).join(sep);
}
