import {
  DestroyRef,
  Injector,
  type Signal,
  assertInInjectionContext,
  inject,
  linkedSignal,
  runInInjectionContext
} from '@angular/core';
import type { AnyActorRef, SnapshotFrom } from 'xstate';

/**
 * Subscribes to the snapshots of an existing actor and returns a readonly
 * Angular `Signal` of its current snapshot. The subscription is unsubscribed
 * automatically when the surrounding Angular injection context is destroyed.
 *
 * Useful for reacting to spawned child actors or to actors created elsewhere
 * (e.g. provided through a service).
 *
 * @example
 *
 * ```ts
 * const childSnapshot = fromActorRef(someSpawnedActor);
 * ```
 */
export function fromActorRef<TActor extends AnyActorRef>(
  actorRef: TActor
): Signal<SnapshotFrom<TActor>> {
  assertInInjectionContext(fromActorRef);
  const injector = inject(Injector);

  return runInInjectionContext(injector, () => {
    const destroyRef = inject(DestroyRef);
    const slice = linkedSignal(
      () => actorRef.getSnapshot() as SnapshotFrom<TActor>
    );

    const sub = actorRef.subscribe((s) => {
      slice.set(s as SnapshotFrom<TActor>);
    });

    destroyRef.onDestroy(() => {
      sub.unsubscribe();
    });

    return slice.asReadonly();
  });
}
