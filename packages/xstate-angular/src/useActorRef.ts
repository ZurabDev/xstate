import {
  DestroyRef,
  Injector,
  assertInInjectionContext,
  inject,
  runInInjectionContext
} from '@angular/core';
import {
  type Actor,
  type ActorOptions,
  type AnyActorLogic,
  createActor
} from 'xstate';
import { registerInjector } from './injectorRegistry';

/**
 * Creates an XState actor from the given logic, starts it for the lifetime of
 * the current Angular injection context (component, directive, service), and
 * returns the actor reference.
 *
 * The function additionally registers the current Angular `Injector` against
 * the actor's `system`. Any actor logic running in the same actor tree
 * (invoked, spawned, or root) can then resolve Angular services via the
 * `fromPromiseInjectable` / `runInActorInjectionContext` helpers.
 *
 * If `logic` is a factory function (the result of `setupInjectable(...)`), it
 * is invoked in the current Angular injection context so the produced machine
 * may close over `inject(...)` results.
 *
 * @example
 *
 * ```ts
 * import { useActorRef, useSelector } from '@zurab/xstate-angular';
 * import { toggleMachine } from './toggle.machine';
 *
 * @Component({ ... })
 * export class TogglerComponent {
 *   private actor = useActorRef(toggleMachine);
 *   value = useSelector(this.actor, (s) => s.value);
 *   toggle = () => this.actor.send({ type: 'TOGGLE' });
 * }
 * ```
 */
export function useActorRef<TLogic extends AnyActorLogic>(
  logic: TLogic | (() => TLogic),
  options?: ActorOptions<TLogic>
): Actor<TLogic> {
  assertInInjectionContext(useActorRef);
  const injector = inject(Injector);
  const destroyRef = inject(DestroyRef);

  const resolvedLogic =
    typeof logic === 'function'
      ? runInInjectionContext(injector, logic as () => TLogic)
      : logic;

  const actor = createActor(resolvedLogic, options);

  // ⚠️ Register injector BEFORE start(): actor.start() invokes
  // logic.start() / getInitialSnapshot, which can synchronously kick off
  // invoked fromPromise creators expecting the injector to be available.
  registerInjector(actor.system, injector);
  actor.start();

  destroyRef.onDestroy(() => {
    actor.stop();
  });

  return actor;
}
