import { type Injector, runInInjectionContext } from '@angular/core';
import type { ActorSystem } from 'xstate';

type AnyActorSystem = ActorSystem<any>;

const registry = new WeakMap<AnyActorSystem, Injector>();

export function registerInjector(
  system: AnyActorSystem,
  injector: Injector
): void {
  registry.set(system, injector);
}

export function getInjector(system: AnyActorSystem): Injector | undefined {
  return registry.get(system);
}

export function runInActorInjectionContext<T>(
  system: AnyActorSystem,
  fn: () => T
): T {
  const injector = registry.get(system);
  if (!injector) {
    throw new Error(
      '@zurab/xstate-angular: no Angular Injector registered for this actor system. Did you create the actor with useActorRef() / useMachine()?'
    );
  }
  return runInInjectionContext(injector, fn);
}
