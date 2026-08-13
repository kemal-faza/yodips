import { OnModuleDestroy } from '@nestjs/common';

export abstract class DataCache implements OnModuleDestroy {
  abstract get<T>(key: string): Promise<T | null>;
  abstract set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  abstract del(key: string): Promise<void>;
  abstract onModuleDestroy(): Promise<void>;
}