import { reactive } from 'vue';
import { useExtension, type UpstreamRenewalStatus, type UpstreamService } from '../composables/useExtension';
import { sessionLifetime } from './session-lifetime';

const flights = new Map<string, { token: string; epoch: number; promise: Promise<UpstreamRenewalStatus> }>();

/** Services for which the extension reached a page requiring user interaction. */
export const upstreamRecoveryState = reactive<Record<UpstreamService, boolean>>({ kulon: false, siap: false });

export function resetUpstreamRecoveryState(): void {
  upstreamRecoveryState.kulon = false;
  upstreamRecoveryState.siap = false;
}

/** Concurrent reads share one service recovery, fenced against logout and login replacement. */
export function recoverUpstreamSession(service: UpstreamService, interactive = false): Promise<UpstreamRenewalStatus> {
  const token = localStorage.getItem('sso_token');
  const epoch = sessionLifetime.epoch();
  if (!token || !sessionLifetime.isCurrent(epoch)) return Promise.resolve('cancelled');
  const key = `${service}:${interactive}`;
  const existing = flights.get(key);
  if (existing?.token === token && existing.epoch === epoch) return existing.promise;
  const promise = useExtension().renewSession(service, token, interactive).then((result) => {
    if (!sessionLifetime.isCurrent(epoch) || localStorage.getItem('sso_token') !== token) return 'cancelled';
    if (result === 'interaction-required') upstreamRecoveryState[service] = true;
    if (result === 'recovered') upstreamRecoveryState[service] = false;
    return result;
  });
  flights.set(key, { token, epoch, promise });
  void promise.finally(() => {
    if (flights.get(key)?.promise === promise) flights.delete(key);
  });
  return promise;
}
