/**
 * config.command.ts — registers `migit config` for repository settings.
 */

import type { Command } from 'commander';
import { Repository } from '../core/repository.js';
import { MiGitError } from '../utils/errors.js';
import { getConfigValue, parseConfigKey, setConfigValue } from '../core/config-store.js';
import { withHistoryAction } from '../cli/with-history.js';

export function registerConfigCommand(program: Command): void {
  program
    .command('config [key] [value]')
    .description('Get or set repository configuration (user.name, user.email, ai.model, …)')
    .option('-l, --list', 'print full config.json')
    .action(
      withHistoryAction('config', async (key: string | undefined, value: string | undefined, options: { list?: boolean }) => {
      const repo = Repository.open();
      repo.assertInitialized();

      if (options.list) {
        const config = await repo.configStore.load();
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      if (!key) {
        throw new MiGitError('Usage: migit config <key> [value]  or  migit config --list');
      }

      const configKey = parseConfigKey(key);

      if (value === undefined) {
        const config = await repo.configStore.load();
        console.log(getConfigValue(config, configKey));
        return;
      }

      const config = await repo.configStore.load();
      const updated = setConfigValue(config, configKey, value);
      await repo.configStore.save(updated);
      console.log(`${configKey}=${getConfigValue(updated, configKey)}`);
    }),
    );
}
