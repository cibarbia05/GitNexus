import { beforeAll, describe, expect, it } from 'vitest';
import { emptyParseCache, loadParseCache, saveParseCache } from '../../src/storage/parse-cache.js';
import { TEST_PARSE_IDENTITY } from '../helpers/cache-identity.js';
import { createTempDirPool } from '../helpers/temp-dir-pool.js';
import {
  getRelationships,
  runPipelineFromRepo,
  writeFixtureRepo,
  type PipelineResult,
} from './resolvers/helpers.js';

const dirs = createTempDirPool('gn-csharp-indexed-array-');

describe('C# indexed array parameters', () => {
  let cold: PipelineResult;
  let warm: PipelineResult;

  beforeAll(async () => {
    const repo = dirs.dir();
    const storage = dirs.dir();
    writeFixtureRepo(repo, {
      'ArrayParameters.cs': `
class User { public void Save() {} }
class Bucket<T> { public void Save() {} }
namespace Other { class @dynamic { public void Save() {} } }
class Caller {
    void Typed(User[] repos) { repos[0].Save(); }
    void Dynamic(dynamic[] repos) { repos[0].Save(); }
    void Multidimensional(Bucket<User>[,] repos) { repos[0, 0].Save(); }
}
`,
    });

    const coldCache = emptyParseCache(TEST_PARSE_IDENTITY, { writeStoragePath: storage });
    const options = { skipGraphPhases: true, workerPoolSize: 1 };
    cold = await runPipelineFromRepo(repo, () => {}, { ...options, parseCache: coldCache });
    await saveParseCache(storage, coldCache);
    const warmCache = await loadParseCache(storage, TEST_PARSE_IDENTITY, storage);
    warm = await runPipelineFromRepo(repo, () => {}, { ...options, parseCache: warmCache });
  }, 120_000);

  it('reuses the cached parse on a second run', () => {
    expect(cold.usedWorkerPool).toBe(true);
    expect(cold.reparsedFileCount).toBe(1);
    expect(warm.usedWorkerPool).toBe(false);
    expect(warm.parseCacheHitFileCount).toBe(1);
  });

  it('links the indexed call to the exact element method', () => {
    for (const result of [cold, warm]) {
      const targets = getRelationships(result, 'CALLS')
        .filter((call) => call.source === 'Typed')
        .map((call) => call.rel.targetId);

      expect(targets).toEqual(['Method:ArrayParameters.cs:User.Save#0']);
    }
  });

  it('leaves dynamic and unsupported multidimensional indexing unresolved', () => {
    for (const result of [cold, warm]) {
      const calls = getRelationships(result, 'CALLS').filter(
        (call) => call.source === 'Dynamic' || call.source === 'Multidimensional',
      );

      expect(calls).toEqual([]);
    }
  });
});
