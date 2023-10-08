import { compile } from '@noir-lang/noir_wasm';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NoirCompilationArtifacts } from '../../noir_artifact.js';
import { NoirDependencyResolver } from './dependency-resolver.js';
import { Filemanager } from './filemanager.js';
import { NoirPackage } from './package.js';
import { initializeResolver } from './source-resolver.cjs';

/**
 * Noir Package Compiler
 */
export class NoirWasmContractCompiler {
  #projectPath: string;
  public constructor(projectPath: string) {
    this.#projectPath = projectPath;
  }

  /**
   * Compiles the project.
   */
  public async compile(): Promise<NoirCompilationArtifacts[]> {
    const noirPackage = await NoirPackage.new(this.#projectPath);

    if (noirPackage.getType() !== 'contract') {
      throw new Error('This is not a contract project');
    }

    const cacheRoot = process.env.XDG_CACHE_HOME ?? join(process.env.HOME ?? '', '.cache');
    const filemanager = new Filemanager(join(cacheRoot, 'noir_wasm'));
    const dependencyResolver = new NoirDependencyResolver(filemanager);

    for (const [name, config] of Object.entries(noirPackage.getDependencies())) {
      await dependencyResolver.add(noirPackage.getPackagePath(), name, config);
    }

    initializeResolver((sourceId: any) => {
      try {
        const libFile = dependencyResolver.resolve(sourceId);
        return filemanager.readFileSync(libFile ?? sourceId, 'utf-8');
      } catch (err) {
        return '';
      }
    });

    /* eslint-disable camelcase */
    const res = await compile({
      entry_point: noirPackage.getEntryPointPath(),
      optional_dependencies_set: dependencyResolver.getCrateNames(),
      contracts: true,
    });
    /* eslint-enable camelcase */

    mkdirSync(join(this.#projectPath, 'target'), { recursive: true });
    writeFileSync(join(this.#projectPath, 'target', res.name + '.json'), JSON.stringify(res, null, 2));

    return [
      {
        contract: {
          backend: '',
          functions: res.functions,
          name: res.name,
        },
      },
    ];
  }
}
