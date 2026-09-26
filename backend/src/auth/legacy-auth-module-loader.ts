import type { DynamicModule } from '@nestjs/common';

/** Load legacy auth code only in dev/test so its runtime imports stay out of production. */
export function legacyAuthModulesForRuntime(): DynamicModule[] {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test') return [];

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LegacyAuthModule } = require(
    './legacy-auth.module',
  ) as typeof import('./legacy-auth.module');
  return [LegacyAuthModule.forRuntime(nodeEnv)];
}
